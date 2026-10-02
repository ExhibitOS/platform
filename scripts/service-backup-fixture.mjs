// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { sha256, Storage } from "../packages/storage/dist/index.js";
import { Oex } from "../apps/api/dist/oex.js";
import { createFreezeFixture } from "./freeze-fixture.mjs";

/** All public metadata rows, compared privately through table hashes rather than secret-bearing diffs. */
export async function metadataSnapshot(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(value => value.tablename);
  const result = {};
  for (const table of tables) {
    assert(/^[a-z_]+$/.test(table));
    const rows = (await pool.query(`SELECT to_jsonb(t)::text AS value FROM public."${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(value => value.value);
    result[table] = { count: rows.length, sha256: sha256(Buffer.from(JSON.stringify(rows))) };
  }
  return result;
}

/** Enumerates the entire isolated backend, including orphan namespaces absent from tenants. */
export async function completeObjectSnapshot(blobs) {
  const keys = [];
  if (blobs.root) {
    const walk = async prefix => {
      for (const entry of await readdir(`${blobs.root}${prefix ? `/${prefix}` : ""}`, { withFileTypes: true })) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert(!entry.isSymbolicLink(), "Fixture blob root must not contain symlinks");
        if (entry.isDirectory()) await walk(key); else if (entry.isFile()) { assert(!entry.name.startsWith("."), "No incomplete fixture filesystem writer"); keys.push(key); }
      }
    };
    await walk("");
  } else {
    let token;
    do {
      const response = await blobs.client.send(new ListObjectsV2Command({ Bucket: blobs.bucket, ...(token ? { ContinuationToken: token } : {}) }));
      keys.push(...(response.Contents ?? []).map(value => value.Key)); token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
  }
  const result = [];
  for (const key of keys.sort()) { const bytes = await blobs.get(key); result.push({ key, bytes: bytes.length, sha256: sha256(bytes) }); }
  return result;
}

/** Actual HTTP approval/publication/freeze/OEX flows provide a nonempty restoration corpus. */
export async function createServiceCorpus(pool, blobs, freeze) {
  const fixture = await createFreezeFixture(pool, { blobs, origin: freeze.origin, appOptions: { freeze } });
  const { actors, expected, request, json, path, saved, tenant } = fixture;
  const archive = (await expected(request(actors.artist, "POST", `${path}/oex/export`, {}, { "if-match": saved.etag }), 200)).rawPayload;
  const frozen = await json(request(actors.artist, "POST", `${path}/freezes`, { requestId: randomUUID() }, { "if-match": saved.etag }), 201);
  const oldGrant = await json(request(actors.artist, "POST", `${path}/freezes/${frozen.id}/offline`, { seconds: 300 }));
  assert.equal((await json(request(actors.artist, "GET", `${path}/ready`))).status, "READY");
  const publication = await json(request(actors.artist, "POST", `${path}/publications`, { requestId: randomUUID() }, { "if-match": saved.etag }), 201);
  const worker = new Oex(pool, blobs), jobs = [];
  const submit = async (bytes, queue) => {
    const job = await json(request(actors.artist, "POST", "/oex/imports", { requestId: randomUUID(), bytes: bytes.length, sha256: sha256(bytes) }), 201);
    await expected(request(actors.artist, "PUT", `/oex/imports/${job.id}/bytes`, bytes), 200);
    if (queue) await expected(request(actors.artist, "POST", `/oex/imports/${job.id}/complete`, {}), 200);
    jobs.push(job.id); return job;
  };
  const completed = await submit(archive, true); await worker.run(completed.id);
  const restored = await json(request(actors.artist, "GET", `/oex/imports/${completed.id}`)); assert.equal(restored.state, "complete");
  const queued = await submit(archive, true), uploading = await submit(archive, false);
  const invalid = await submit(Buffer.from("Synthetic rejected OEX retains its failed staging receipt"), true); await worker.run(invalid.id);
  assert.equal((await json(request(actors.artist, "GET", `/oex/imports/${invalid.id}`))).state, "failed");
  const storage = new Storage(pool, blobs), trashBytes = Buffer.from("Synthetic retained trash source bytes");
  const trashSource = `${tenant}/quarantine/service-backup-trash`;
  await blobs.put(trashSource, trashBytes);
  const archived = await storage.reconcile({ tenantId: tenant, userId: actors.admin.userId }, true); assert(archived.includes(trashSource));
  const orphanKey = `${tenant}/quarantine/service-backup-orphan`, unlinkedKey = "synthetic-unlinked-namespace/backup/orphan";
  await blobs.put(orphanKey, Buffer.from("Synthetic unreferenced source retained by administrative backup"));
  await blobs.put(unlinkedKey, Buffer.from("Synthetic unknown-tenant namespace must not be silently discarded"));
  return { ...fixture, pool, archive, frozen, oldGrant, publication, completed: restored, queued, uploading, failed: invalid, jobs, trashSource, orphanKey, unlinkedKey };
}

/** Kills an actual API creation only after all declared owned bytes exist, leaving a durable future-lease receipt. */
export async function addInterruptedFreeze(corpus, database, freezeInput, s3) {
  const { app, expected, json, request, actors, completed, blobs } = corpus;
  assert(app);
  const path = `/studio/exhibitions/${completed.result.exhibitionId}`, latest = await json(request(actors.artist, "GET", path));
  const requestId = randomUUID(), applicationName = `synthetic-backup-freeze-${requestId}`, pool = corpus.pool;
  const blocker = await pool.connect(), lock = 1820703;
  await blocker.query("SELECT pg_advisory_lock($1)", [lock]);
  await pool.query(`CREATE FUNCTION synthetic_service_backup_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER synthetic_service_backup_pause BEFORE INSERT ON exhibition_freezes FOR EACH ROW EXECUTE FUNCTION synthetic_service_backup_pause()");
  const child = spawn(process.execPath, [new URL("./service-backup-worker.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  let error = ""; child.stderr.on("data", part => { error += part.toString(); });
  child.stdin.end(JSON.stringify({ database: { ...database, application_name: applicationName }, freeze: freezeInput, ...(s3 ? { s3 } : { blobRoot: blobs.root }),
    cookie: actors.artist.cookie, csrfToken: actors.artist.csrfToken, url: `/api/v1/tenants/${corpus.tenant}${path}/freezes`, etag: latest.etag, requestId }));
  let pending;
  try {
    for (let attempt = 0; ; attempt++) {
      if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE 'INSERT INTO exhibition_freezes%'", [applicationName])).rowCount) break;
      assert.equal(child.exitCode, null, error); if (attempt >= 300) throw Error("Actual pending freeze fixture did not reach transaction barrier");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    pending = (await pool.query("SELECT id,state,object_keys FROM freeze_requests WHERE tenant_id=$1 AND request_id=$2", [corpus.tenant, requestId])).rows[0];
    assert.equal(pending.state, "creating"); assert(pending.object_keys.length > 1);
    for (const key of pending.object_keys) assert((await blobs.get(key)).length > 0);
    child.kill("SIGKILL"); assert.equal((await exited).signal, "SIGKILL");
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    await blocker.query("SELECT pg_advisory_unlock($1)", [lock]); blocker.release();
    await pool.query("DROP TRIGGER synthetic_service_backup_pause ON exhibition_freezes"); await pool.query("DROP FUNCTION synthetic_service_backup_pause()");
  }
  await expected(request(actors.artist, "GET", path), 200);
  return { ...pending, requestId, exhibitionId: completed.result.exhibitionId, etag: latest.etag };
}
