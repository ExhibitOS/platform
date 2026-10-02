// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { verifyFreezeBundle } from "@exhibitos/studio-contract";
import { collectServiceInventory, createServiceBackup, FileBlobStore, migrate, restoreServiceBackup, sha256, Storage, verifyServiceBackup } from "../packages/storage/dist/index.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Freezes, loadFreezeConfig, loadFreezeRuntime } from "../apps/api/dist/freeze.js";
import { Oex } from "../apps/api/dist/oex.js";
import { addInterruptedFreeze, completeObjectSnapshot, createServiceCorpus, metadataSnapshot } from "./service-backup-fixture.mjs";
import { IsolatedBackends } from "./service-backup-adapters.mjs";

const directory = await realpath(await mkdtemp(`${tmpdir()}/exhibitos-service-backup-report-`));
const images = JSON.parse(await readFile(new URL("../database/images.json", import.meta.url))), backends = new IsolatedBackends(images);
const migrationDirectory = new URL("../database/migrations/", import.meta.url).pathname, runtimeRoot = new URL("../apps/web/dist/", import.meta.url).pathname;
const checks = [], results = [], applications = [], confidential = [], encryptionKey = randomBytes(32);
const test = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const snapshot = store => client => collectServiceInventory(client, store, { migrationDirectory });
async function inventory(pool, store, options = {}) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock_shared(82002)"); const value = await collectServiceInventory(client, store, { migrationDirectory, ...options }); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function uniqueOrigin() { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return `http://127.0.0.1:${port}`; }
async function fixtureSigning(path) {
  const { privateKey } = generateKeyPairSync("ed25519"), secret = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"); confidential.push(secret);
  await writeFile(path, JSON.stringify({ name: "exhibitos-freeze-ed25519", schemaVersion: "1.0.0-draft.1", privateKey: secret }), { mode: 0o600 });
  return sha256(createPublicKey(privateKey).export({ format: "der", type: "spki" }));
}
function launchCli(args, environment) {
  const child = spawn(process.execPath, [new URL("./service-backup.mjs", import.meta.url).pathname, ...args], { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => { for (const secret of confidential) assert.equal(output.includes(secret), false, "Operator logs must not expose credential or configuration values"); resolve({ code, signal, output }); }); });
  return { child, exited };
}
async function runCli(args, environment) { const value = await launchCli(args, environment).exited; assert.equal(value.code, 0, value.output); return value; }
try {
  for (const kind of ["file", "s3"]) {
    const root = `${directory}/${kind}`; await mkdir(root, { mode: 0o700 });
    const source = await backends.postgres(`${kind}-source`), target = await backends.postgres(`${kind}-target`); confidential.push(source.password, target.password);
    await migrate(source.pool, migrationDirectory);
    const s3 = kind === "s3" ? await backends.s3() : null;
    const sourceStore = s3?.store ?? new FileBlobStore(`${root}/source-blobs`); if (!s3) await mkdir(sourceStore.root, { mode: 0o700 }); else confidential.push(s3.config.client.credentials.secretAccessKey);
    const keyFile = `${root}/source-signing-key.json`, keyId = await fixtureSigning(keyFile), origin = await uniqueOrigin();
    const freezeInput = { runtimeRoot, signingKeyFile: keyFile, origin }, freeze = await loadFreezeConfig(freezeInput), corpus = await createServiceCorpus(source.pool, sourceStore, freeze); applications.push(corpus.app);
    const pending = await addInterruptedFreeze(corpus, source.database, freezeInput, s3?.config);
    await source.pool.query("CREATE TABLE synthetic_backup_numbers(id bigint PRIMARY KEY, value numeric(30,0) NOT NULL)");
    await source.pool.query("INSERT INTO synthetic_backup_numbers VALUES(9007199254740992,9007199254740992),(9007199254740993,9007199254740993)");
    await source.pool.query("INSERT INTO synthetic_backup_numbers SELECT n::bigint,n::numeric FROM generate_series(1,40001) AS n");
    const loadedRuntime = await loadFreezeRuntime(runtimeRoot), runtime = loadedRuntime.runtime, runtimeFiles = loadedRuntime.files;
    const configSecret = `synthetic-protected-configuration-${randomUUID()}`; confidential.push(configSecret);
    const configuration = new Map([["signing-key.json", await readFile(keyFile)], ["private-configuration.json", Buffer.from(JSON.stringify({ origin, sentinel: configSecret }))]]);
    const backupKeyFile = `${root}/backup-encryption-key.bin`, privateConfigFile = `${root}/source-configuration.json`; await writeFile(backupKeyFile, encryptionKey, { mode: 0o600 }); await writeFile(privateConfigFile, configuration.get("private-configuration.json"), { mode: 0o600 });
    const cliEnvironment = { DATABASE_URL: `postgresql://postgres:${encodeURIComponent(source.password)}@127.0.0.1:${source.database.port}/postgres`, BACKUP_POSTGRES_CONTAINER: source.name, FREEZE_RUNTIME_ROOT: runtimeRoot,
      BACKUP_CONFIGURATION_FILES: JSON.stringify({ "signing-key.json": keyFile, "private-configuration.json": privateConfigFile }),
      ...(s3 ? { BACKUP_BLOB_BACKEND: "s3", S3_ENDPOINT: s3.config.client.endpoint, S3_BUCKET: s3.config.bucket, S3_FORCE_PATH_STYLE: "1", AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: s3.config.client.credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: s3.config.client.credentials.secretAccessKey } : { BLOB_ROOT: sourceStore.root }) };
    const backupOptions = { pool: source.pool, store: sourceStore, encryptionKey, snapshot: snapshot(sourceStore), runtime: { metadata: runtime, files: runtimeFiles }, configuration };
    const dump = (path, snapshotId) => { assert.match(snapshotId, /^[0-9A-Fa-f-]+$/); return backends.pgFile(source, path, "dump", snapshotId); };
    await test(`${kind}: exact all-row inventory and large PostgreSQL numbers include required blobs and unknown orphan namespaces`, async () => {
      const value = await inventory(source.pool, sourceStore); assert.deepEqual(value.issues, []); assert(value.objects.some(item => item.key === corpus.unlinkedKey && !item.referenced));
      assert.equal(value.tables.find(item => item.name === "synthetic_backup_numbers").rowCount, 40003);
      const before = value.tables.find(item => item.name === "synthetic_backup_numbers").sha256;
      await source.pool.query("UPDATE synthetic_backup_numbers SET value=9007199254740992 WHERE id=9007199254740993");
      assert.notEqual((await inventory(source.pool, sourceStore)).tables.find(item => item.name === "synthetic_backup_numbers").sha256, before);
      await source.pool.query("UPDATE synthetic_backup_numbers SET value=9007199254740993 WHERE id=9007199254740993");
      assert.equal((await inventory(source.pool, sourceStore)).tables.find(item => item.name === "synthetic_backup_numbers").sha256, before);
      const tenantInventory = await inventory(source.pool, sourceStore, { tenantId: corpus.tenant }); assert.deepEqual(tenantInventory.issues, []); assert.equal(tenantInventory.schemaDigest, undefined); assert.deepEqual(tenantInventory.tables, []);
    });
    await test(`${kind}: real authenticated API writer blocks on maintenance while exact exported PG snapshot is dumped`, async () => {
      let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
      const saving = createServiceBackup({ ...backupOptions, destination: `${root}/maintenance-backup`, dump: async (path, token) => { entered(); await gate; await dump(path, token); } });
      await started;
      let completed = false, responseStatus; const writer = corpus.request(corpus.actors.artist, "POST", "/cms/artists", { name: "Synthetic legitimate post-backup boundary writer", bio: "Synthetic maintenance boundary" }).then(response => { completed = true; responseStatus = response.statusCode; return response; });
      try {
        for (let attempt = 0; ; attempt++) { const waiting = await source.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=82002 AND mode='ShareLock' AND NOT granted"); if (waiting.rowCount) break; if (completed) throw Error(`Actual API writer completed before maintenance release HTTP ${responseStatus}`); if (attempt > 120) throw Error("Actual API writer never waited on maintenance"); await new Promise(resolve => setTimeout(resolve, 25)); }
        assert.equal(completed, false);
      } finally { release(); }
      assert.equal((await saving).status, "complete"); await corpus.expected(writer, 201);
    });
    await test(`${kind}: missing actual committed object refuses backup and source is restored byte-identically`, async () => {
      const value = await inventory(source.pool, sourceStore), required = value.references.find(item => item.required && item.expectedSha256), bytes = await sourceStore.get(required.key), rows = await metadataSnapshot(source.pool);
      await sourceStore.remove(required.key);
      try { await assert.rejects(createServiceBackup({ ...backupOptions, destination: `${root}/missing-object-backup`, dump })); }
      finally { await sourceStore.put(required.key, bytes); }
      assert.deepEqual(await metadataSnapshot(source.pool), rows); assert.equal(sha256(await sourceStore.get(required.key)), sha256(bytes)); assert.deepEqual((await inventory(source.pool, sourceStore)).issues, []);
    });
    await test(`${kind}: actual operator CLI creates and verifies encrypted archive without logging private values`, async () => {
      const cliArchive = `${root}/cli-created-backup`;
      await runCli(["create", "--key-file", backupKeyFile, "--destination", cliArchive, "--quiesced"], cliEnvironment);
      await runCli(["verify", "--key-file", backupKeyFile, "--source", cliArchive, "--destination", `${root}/cli-verified-private`], {});
    });
    await test(`${kind}: SIGKILL during actual CLI inventory leaves an incomplete archive that cannot restore and preserves source`, async () => {
      const rows = await metadataSnapshot(source.pool), objects = await completeObjectSnapshot(sourceStore), blocker = await source.pool.connect(), interruptedArchive = `${root}/cli-interrupted-backup`;
      await blocker.query("BEGIN"); await blocker.query("LOCK synthetic_backup_numbers IN ACCESS EXCLUSIVE MODE");
      const running = launchCli(["create", "--key-file", backupKeyFile, "--destination", interruptedArchive, "--quiesced"], cliEnvironment);
      try {
        for (let attempt = 0; ; attempt++) {
          const paused = await source.pool.query("SELECT 1 FROM pg_locks WHERE locktype='relation' AND relation='synthetic_backup_numbers'::regclass AND NOT granted");
          if (paused.rowCount) break; assert.equal(running.child.exitCode, null); if (attempt > 200) throw Error("Actual CLI backup did not reach inventory barrier"); await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(JSON.parse(await readFile(`${interruptedArchive}/writing.json`, "utf8")).status, "writing");
        running.child.kill("SIGKILL"); assert.equal((await running.exited).signal, "SIGKILL");
      } finally { if (running.child.exitCode === null && running.child.signalCode === null) { running.child.kill("SIGKILL"); await running.exited; } await blocker.query("ROLLBACK"); blocker.release(); }
      await assert.rejects(readFile(`${interruptedArchive}/complete.json`));
      const rejected = await launchCli(["verify", "--key-file", backupKeyFile, "--source", interruptedArchive, "--destination", `${root}/cli-interrupted-verify`], {}).exited; assert.equal(rejected.code, 1);
      assert.deepEqual(await metadataSnapshot(source.pool), rows); assert.deepEqual(await completeObjectSnapshot(sourceStore), objects);
      const lockCheck = await source.pool.connect(); try { assert.equal((await lockCheck.query("SELECT pg_try_advisory_lock(82002) AS acquired")).rows[0].acquired, true); await lockCheck.query("SELECT pg_advisory_unlock(82002)"); } finally { lockCheck.release(); }
    });
    const originalRows = await metadataSnapshot(source.pool), originalObjects = await completeObjectSnapshot(sourceStore), originalInventory = await inventory(source.pool, sourceStore);
    const archive = `${root}/complete-backup`; let receipt, verified;
    await test(`${kind}: encrypted consistent archive authenticates every metadata object runtime and protected configuration`, async () => {
      receipt = await createServiceBackup({ ...backupOptions, destination: archive, dump }); assert.equal(receipt.status, "complete"); assert.equal(receipt.objectCount, originalObjects.length);
      verified = await verifyServiceBackup({ source: archive, encryptionKey, destination: `${root}/verify-private` });
      assert.equal(sha256(Buffer.from(JSON.stringify(await metadataSnapshot(source.pool)))), sha256(Buffer.from(JSON.stringify(originalRows)))); assert.deepEqual(await completeObjectSnapshot(sourceStore), originalObjects);
      assert.equal((await stat(archive)).mode & 0o777, 0o700);
      const privateBytes = Buffer.from(configSecret), keyBytes = Buffer.from(JSON.parse(await readFile(keyFile, "utf8")).privateKey);
      async function scan(path) { const { readdir } = await import("node:fs/promises"); for (const entry of await readdir(path, { withFileTypes: true })) { if (entry.isDirectory()) await scan(`${path}/${entry.name}`); else { const bytes = await readFile(`${path}/${entry.name}`); assert.equal(bytes.includes(privateBytes), false); assert.equal(bytes.includes(keyBytes), false); } } }
      await scan(archive);
    });
    await test(`${kind}: wrong encryption key and corrupted authenticated bytes fail closed`, async () => {
      await assert.rejects(verifyServiceBackup({ source: archive, encryptionKey: randomBytes(32), destination: `${root}/verify-wrong-key` }));
      const damaged = `${root}/corrupted-backup`; await cp(archive, damaged, { recursive: true });
      const { readdir } = await import("node:fs/promises"); const candidates = [];
      const walk = async path => { for (const item of await readdir(path, { withFileTypes: true })) { if (item.isDirectory()) await walk(`${path}/${item.name}`); else candidates.push(`${path}/${item.name}`); } }; await walk(damaged);
      const encrypted = candidates.find(path => path.endsWith(".gcm") && path.includes("/files/")); assert(encrypted, "Encrypted backup file must be discoverable"); const bytes = await readFile(encrypted); bytes[Math.floor(bytes.length / 2)] ^= 1; await writeFile(encrypted, bytes);
      await assert.rejects(verifyServiceBackup({ source: damaged, encryptionKey, destination: `${root}/verify-corrupted` }));
    });
    await test(`${kind}: missing encrypted archive object refuses verification without activating restored state`, async () => {
      const missing = `${root}/missing-backup-file`; await cp(archive, missing, { recursive: true });
      const descriptor = verified.manifest.files.find(item => item.role === "object"); assert(descriptor);
      await rename(`${missing}/${descriptor.path}`, `${root}/removed-fixture-ciphertext.gcm`);
      await assert.rejects(verifyServiceBackup({ source: missing, encryptionKey, destination: `${root}/verify-missing-file` }));
    });
    await test(`${kind}: nonempty destination database and blob target refuse restoration without modifying sentinels`, async () => {
      const refused = await backends.postgres(`${kind}-nonempty`), store = new FileBlobStore(`${root}/nonempty-blobs`); await mkdir(store.root, { mode: 0o700 });
      await refused.pool.query("CREATE TABLE synthetic_do_not_overwrite(value text)"); await refused.pool.query("INSERT INTO synthetic_do_not_overwrite VALUES('preserve')"); await store.put("synthetic-sentinel/backup/preserve", Buffer.from("preserve"));
      const rows = await metadataSnapshot(refused.pool), objects = await completeObjectSnapshot(store);
      await assert.rejects(restoreServiceBackup({ pool: refused.pool, store, source: archive, encryptionKey, destination: `${root}/nonempty-restore`, snapshot: snapshot(store), restore: path => backends.pgFile(refused, path, "restore") }));
      assert.deepEqual(await metadataSnapshot(refused.pool), rows); assert.deepEqual(await completeObjectSnapshot(store), objects);
    });
    await test(`${kind}: empty database with nonempty blob backend is also rejected without modifying bytes`, async () => {
      const refused = await backends.postgres(`${kind}-blob-nonempty`), store = new FileBlobStore(`${root}/blob-only-nonempty`); await mkdir(store.root, { mode: 0o700 }); await store.put("synthetic-sentinel/backup/blob-only", Buffer.from("preserve"));
      const objects = await completeObjectSnapshot(store);
      await assert.rejects(restoreServiceBackup({ pool: refused.pool, store, source: archive, encryptionKey, destination: `${root}/blob-only-restore`, snapshot: snapshot(store), restore: path => backends.pgFile(refused, path, "restore") }));
      assert.deepEqual(await metadataSnapshot(refused.pool), {}); assert.deepEqual(await completeObjectSnapshot(store), objects);
    });
    await test(`${kind}: incompatible local migration checksum refuses restored candidate activation`, async () => {
      const refused = await backends.postgres(`${kind}-schema-mismatch`), store = new FileBlobStore(`${root}/schema-blobs`); await mkdir(store.root, { mode: 0o700 });
      const alteredMigrations = `${root}/altered-migrations`; await cp(migrationDirectory, alteredMigrations, { recursive: true });
      await writeFile(`${alteredMigrations}/010_freeze.sql`, "-- synthetic incompatible migration fixture\n");
      await assert.rejects(restoreServiceBackup({ pool: refused.pool, store, source: archive, encryptionKey, destination: `${root}/schema-restore`, snapshot: client => collectServiceInventory(client, store, { migrationDirectory: alteredMigrations }), restore: path => backends.pgFile(refused, path, "restore") }));
      await assert.rejects(readFile(`${root}/schema-restore/restored.json`)); await assert.rejects(readFile(`${root}/schema-restore/configuration/signing-key.json`));
      assert.deepEqual(await metadataSnapshot(source.pool), originalRows); assert.deepEqual(await completeObjectSnapshot(sourceStore), originalObjects);
    });
    await corpus.app.close(); await source.pool.end(); backends.stop(source.name);
    if (s3) backends.stop(s3.name); else await rename(sourceStore.root, `${root}/stopped-source-blobs`);
    await rename(keyFile, `${root}/stopped-source-signing-key.json`);
    await test(`${kind}: original service database object store and signing-key path are unavailable before restoration`, async () => {
      const inaccessible = new Pool({ ...source.database, connectionTimeoutMillis: 1000 }); try { await assert.rejects(inaccessible.query("SELECT 1")); } finally { await inaccessible.end(); }
      await assert.rejects(sourceStore.get(originalObjects[0].key)); await assert.rejects(readFile(keyFile));
    });
    const destinationStore = new FileBlobStore(`${root}/restored-blobs`); await mkdir(destinationStore.root, { mode: 0o700 });
    const restoredDirectory = `${root}/restore-workspace`; let restored;
    await test(`${kind}: fresh database and fresh blob root reconstruct every row object hash and schema from encrypted backup alone`, async () => {
      await runCli(["restore", "--key-file", backupKeyFile, "--source", archive, "--destination", restoredDirectory, "--quiesced", "--fresh-destination"], { DATABASE_URL: `postgresql://postgres:${encodeURIComponent(target.password)}@127.0.0.1:${target.database.port}/postgres`, BACKUP_POSTGRES_CONTAINER: target.name, BLOB_ROOT: destinationStore.root });
      restored = JSON.parse(await readFile(`${restoredDirectory}/restored.json`, "utf8")); assert.equal(restored.status, "complete");
      assert.deepEqual(await metadataSnapshot(target.pool), originalRows); assert.deepEqual(await completeObjectSnapshot(destinationStore), originalObjects);
      const actual = await inventory(target.pool, destinationStore); assert.deepEqual(actual.issues, []); assert.equal(actual.schemaDigest, originalInventory.schemaDigest); assert.deepEqual(actual.tables, originalInventory.tables);
    });
    // Restoration material paths are prescribed by the backup core and hold no dependencies on the stopped source.
    const restoredFreeze = await loadFreezeConfig({ runtimeRoot: `${restoredDirectory}/runtime`, signingKeyFile: `${restoredDirectory}/configuration/signing-key.json`, origin });
    const api = buildApp({ pool: target.pool, blobs: destinationStore, freeze: restoredFreeze, auth: { mode: "local", origin, bindHost: "127.0.0.1" } }); applications.push(api);
    await api.listen({ host: "127.0.0.1", port: Number(new URL(origin).port) });
    const actualRequest = async (actor, method, path, body, extra = {}) => {
      const response = await fetch(`${origin}/api/v1/tenants/${corpus.tenant}${path}`, { method, headers: { origin, ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrfToken } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const bytes = Buffer.from(await response.arrayBuffer()); return { status: response.status, bytes, value: () => JSON.parse(bytes) };
    };
    await test(`${kind}: restored actual network API retains tenant session publication media and old signed freeze authority`, async () => {
      const actor = corpus.actors.artist;
      const current = await actualRequest(actor, "GET", `${corpus.path}/freezes/${corpus.frozen.id}`); assert.equal(current.status, 200); assert.deepEqual(current.value().manifest, corpus.frozen.manifest);
      const offline = await actualRequest(actor, "POST", `${corpus.path}/freezes/${corpus.frozen.id}/offline`, { seconds: 300 }); assert.equal(offline.status, 200);
      const bundle = offline.value(); assert.equal(bundle.oex, corpus.oldGrant.oex); assert.deepEqual(bundle.runtimeFiles, corpus.oldGrant.runtimeFiles); assert.equal(bundle.signature, corpus.oldGrant.signature);
      assert.equal((await verifyFreezeBundle(offline.bytes, { trustedKeys: [keyId] })).bundle.manifest.id, corpus.frozen.id);
      const pubRows = (await target.pool.query("SELECT object_key,sha256 FROM publication_assets UNION ALL SELECT object_key,sha256 FROM publication_media")).rows; assert(pubRows.length >= 3); for (const item of pubRows) assert.equal(sha256(await destinationStore.get(item.object_key)), item.sha256);
      const foreign = await actualRequest(corpus.destinationActor, "GET", `${corpus.path}/freezes/${corpus.frozen.id}`); assert([401, 403, 404].includes(foreign.status));
      const viewer = await actualRequest(corpus.actors.viewer, "POST", `${corpus.path}/freezes/${corpus.frozen.id}/offline`, { seconds: 300 }); assert.equal(viewer.status, 403);
    });
    await test(`${kind}: restored administrative integrity endpoint is read-only tenant scoped and denies lower roles`, async () => {
      const before = await metadataSnapshot(target.pool), response = await actualRequest(corpus.actors.admin, "GET", "/integrity"); assert.equal(response.status, 200); const value = response.value();
      assert.equal(value.healthy, true); assert.deepEqual(value.issues, []); assert.equal(value.tenantId, corpus.tenant); assert.equal(value.schemaDigest, undefined); assert.equal(value.tables, undefined); assert.equal(value.migrations, undefined);
      assert(value.objects.every(item => item.key.startsWith(`${corpus.tenant}/`))); assert(!response.bytes.includes(Buffer.from(corpus.unlinkedKey))); assert(value.rights.total > 0); assert(value.summary.orphans >= 2);
      assert.deepEqual(await metadataSnapshot(target.pool), before);
      for (const actor of [corpus.actors.artist, corpus.actors.viewer, corpus.actors.curator, corpus.destinationActor]) assert([401, 403].includes((await actualRequest(actor, "GET", "/integrity")).status));
      assert.equal((await actualRequest(null, "GET", "/integrity")).status, 401);
    });
    await test(`${kind}: restored complete queued uploading failed and interrupted receipts resume using only retained owned bytes`, async () => {
      const worker = new Oex(target.pool, destinationStore);
      const completed = await actualRequest(corpus.actors.artist, "GET", `/oex/imports/${corpus.completed.id}`); assert.deepEqual(completed.value(), corpus.completed);
      await worker.run(corpus.queued.id); assert.equal((await actualRequest(corpus.actors.artist, "GET", `/oex/imports/${corpus.queued.id}`)).value().state, "complete");
      assert.equal((await actualRequest(corpus.actors.artist, "POST", `/oex/imports/${corpus.uploading.id}/complete`, {})).status, 200); await worker.run(corpus.uploading.id); assert.equal((await actualRequest(corpus.actors.artist, "GET", `/oex/imports/${corpus.uploading.id}`)).value().state, "complete");
      assert.equal((await actualRequest(corpus.actors.artist, "GET", `/oex/imports/${corpus.failed.id}`)).value().state, "failed");
      await target.pool.query("UPDATE freeze_requests SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [pending.id]); assert.equal(await new Freezes(target.pool, destinationStore, restoredFreeze).recover(), true);
      for (const key of pending.object_keys) await assert.rejects(destinationStore.get(key));
      const retried = await actualRequest(corpus.actors.artist, "POST", `/studio/exhibitions/${pending.exhibitionId}/freezes`, { requestId: pending.requestId }, { "if-match": pending.etag }); assert.equal(retried.status, 201); assert.equal(retried.value().id, pending.id);
      assert.equal((await target.pool.query("SELECT attempts FROM freeze_requests WHERE id=$1", [pending.id])).rows[0].attempts, 2);
      assert.equal((await actualRequest(corpus.actors.artist, "GET", `${corpus.path}/freezes/${corpus.frozen.id}`)).value().manifestSha256, corpus.frozen.manifestSha256);
    });
    await test(`${kind}: restored trash can be explicitly recovered and unreferenced namespace bytes remain intact`, async () => {
      const manifests = (await destinationStore.list(`${corpus.tenant}/trash`)).filter(key => key.endsWith(".json"));
      const selected = [];
      for (const key of manifests) if (JSON.parse((await destinationStore.get(key)).toString()).key === corpus.trashSource) selected.push(key);
      assert.equal(selected.length, 1); await new Storage(target.pool, destinationStore).restoreOrphan({ tenantId: corpus.tenant, userId: corpus.actors.admin.userId }, selected[0]);
      assert.equal((await destinationStore.get(corpus.trashSource)).toString(), "Synthetic retained trash source bytes");
      for (const key of [corpus.orphanKey, corpus.unlinkedKey]) assert.equal(sha256(await destinationStore.get(key)), originalObjects.find(item => item.key === key).sha256);
      assert.deepEqual((await inventory(target.pool, destinationStore)).issues, []);
    });
    await api.close();
    results.push({ adapter: kind, archive, receipt, restored, tableCount: Object.keys(originalRows).length, rowCount: Object.values(originalRows).reduce((sum, value) => sum + value.count, 0), objectCount: originalObjects.length, objectBytes: originalObjects.reduce((sum, value) => sum + value.bytes, 0), sourceUnavailable: true, pendingFreezeRecovered: true, verifiedManifest: verified.manifest.id });
  }
  const report = { name: "exhibitos-service-backup-actual-test", version: "1.0.0-draft.1", passed: true, at: new Date().toISOString(), checks, images, results, limits: ["Only synthetic isolated containers and new directories", "S3 source qualified against pinned S3Mock, destination FileBlobStore", "No real user data or production destructive changes", "Raw privileged writers require operator quiescence outside API maintenance protocol"] };
  const encoded = JSON.stringify(report, null, 2); for (const value of confidential) assert.equal(encoded.includes(value), false);
  await writeFile(`${directory}/service-backup-run.json`, encoded, { mode: 0o600 }); console.log(`Actual service backup checks ${checks.length} PASS; report ${directory}/service-backup-run.json`);
} finally { for (const app of applications) await app.close().catch(() => {}); await backends.close(); }
