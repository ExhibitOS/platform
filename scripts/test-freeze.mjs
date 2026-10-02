// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID, verify } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { validateOex } from "@exhibitos/spec";
import { verifyFreezeBundle } from "@exhibitos/studio-contract";
import { migrate, sha256 } from "../packages/storage/dist/index.js";
import { createFreezeFixture } from "./freeze-fixture.mjs";
import { exportedEntries } from "./oex-test-zip.mjs";
import { runFreezeBrowser, runStudioFreezeBrowser } from "./freeze-browser.mjs";
import { runPortableFreeze } from "./freeze-portable.mjs";

// Independent canonical serializer verifies signatures without accepting an embedded trust key.
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const checks = [], name = `exhibitos-freeze-test-${randomUUID()}`, password = randomBytes(24).toString("hex");
const run = (...args) => execFileSync(process.env.DOCKER_BIN ?? "docker", args, { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const directory = await realpath(await mkdtemp(`${tmpdir()}/exhibitos-freeze-report-`)), test = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
let pool, fixture, started = false;
try {
  const image = JSON.parse(await readFile(new URL("../database/images.json", import.meta.url))).postgres;
  run("run", "-d", "--name", name, "--label", `exhibitos.freeze.test=${name}`, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, image); started = true;
  pool = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "postgres", statement_timeout: 10000 });
  for (let attempt = 0; ; attempt++) { try { await pool.query("SELECT 1"); break; } catch (error) { if (attempt >= 90) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); } }
  await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname, "009_oex.sql");
  const previousMigrations = (await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")).rows;
  await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname);
  await test("freeze migration adds one schema while preserving every prior checksum", async () => {
    assert.equal(previousMigrations.length, 9);
    assert.deepEqual((await pool.query("SELECT name,sha256 FROM schema_migrations WHERE name<'010' ORDER BY name")).rows, previousMigrations);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 10);
  });
  const { privateKey } = generateKeyPairSync("ed25519"), keyFile = `${directory}/synthetic-signing-key.json`;
  const trustedKey = createPublicKey(privateKey);
  await writeFile(keyFile, JSON.stringify({ name: "exhibitos-freeze-ed25519", schemaVersion: "1.0.0-draft.1", privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") }), { mode: 0o600 });
  const { loadFreezeConfig } = await import("../apps/api/dist/freeze.js");
  const runtimeRoot = new URL("../apps/web/dist/", import.meta.url).pathname;
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve)); const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve)); const origin = `http://127.0.0.1:${port}`;
  await chmod(keyFile, 0o644);
  await test("signing configuration rejects exposed private key permissions", async () => {
    await assert.rejects(loadFreezeConfig({ runtimeRoot, signingKeyFile: keyFile, origin }));
  });
  await chmod(keyFile, 0o600);
  const config = await loadFreezeConfig({ runtimeRoot, signingKeyFile: keyFile, origin });
  const staticAssets = new Set(await readdir(`${runtimeRoot}/assets`));
  fixture = await createFreezeFixture(pool, { origin, appOptions: { freeze: config }, configureApp: app => {
    for (const path of ["/studio", "/cms", "/offline"]) app.get(path, async (_request, reply) => reply.type("text/html").send(await readFile(`${runtimeRoot}/index.html`)));
    for (const [path, mime] of [["freeze-runtime.json", "application/json"], ["studio-sw.js", "text/javascript"], ["THIRD_PARTY_NOTICES.txt", "text/plain"]]) app.get(`/${path}`, async (_request, reply) => reply.type(mime).send(await readFile(`${runtimeRoot}/${path}`)));
    app.get("/assets/:file", async (req, reply) => {
      const file = req.params.file; if (!staticAssets.has(file) || !/^[-\w.]+$/.test(file)) return reply.code(404).send();
      return reply.type(file.endsWith(".js") ? "application/javascript" : "text/css").send(await readFile(`${runtimeRoot}/assets/${file}`));
    });
  } });
  const { actors, request, expected, json, path, saved, draft, bytesByAsset } = fixture;
  const freezePath = `${path}/freezes`, create = requestId => request(actors.artist, "POST", freezePath, { requestId }, { "if-match": saved.etag });
  await test("freeze creation enforces exact revision owner tenant session and CSRF on the server", async () => {
    await expected(request(null, "POST", freezePath, { requestId: randomUUID() }, { "if-match": saved.etag }), 401);
    for (const actor of [actors.other, actors.viewer, actors.curator]) await expected(request(actor, "POST", freezePath, { requestId: randomUUID() }, { "if-match": saved.etag }), 403);
    await expected(request(actors.artist, "POST", freezePath, { requestId: randomUUID() }, { "if-match": saved.etag, "x-csrf-token": "invalid" }), 403);
    await expected(request(actors.artist, "POST", freezePath, { requestId: randomUUID() }, { "if-match": `"studio-r1-${"0".repeat(64)}"` }), 412);
  });
  const requestId = randomUUID(), summary = await json(create(requestId), 201), frozenPath = `${freezePath}/${summary.id}`;
  await test("freeze creates an immutable private receipt without publishing and retry retains identity", async () => {
    assert.deepEqual(await json(create(requestId), 201), summary);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM studio_publications")).rows[0].n, 0);
    assert.equal(summary.manifest.source.exhibitionId, draft.exhibitionId);
    assert.equal(summary.manifest.source.etag, saved.etag);
    assert.equal(summary.manifestSha256, sha256(Buffer.from(canonical(summary.manifest))));
  });
  const bundle = await json(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }));
  await test("real signed offline package contains exact approved GLB PNG PCM and retained actual browser runtime", async () => {
    const publicBytes = trustedKey.export({ format: "der", type: "spki" });
    assert.equal(bundle.manifest.authority.keyId, sha256(publicBytes));
    assert.equal(bundle.manifest.authority.publicKey, publicBytes.toString("base64"));
    assert.equal(verify(null, Buffer.from(canonical(bundle.manifest)), trustedKey, Buffer.from(bundle.signature, "base64")), true);
    assert.equal(verify(null, Buffer.from(canonical(bundle.authorization.grant)), trustedKey, Buffer.from(bundle.authorization.signature, "base64")), true);
    const archive = Buffer.from(bundle.oex, "base64");
    assert.equal(archive.length, bundle.manifest.oex.bytes); assert.equal(sha256(archive), bundle.manifest.oex.sha256);
    assert.equal((await validateOex(archive)).valid, true);
    assert.deepEqual(exportedEntries(archive).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), [...bytesByAsset.values()].map(sha256).sort());
    assert(bundle.manifest.runtime.files.some(file => file.path === "index.html"));
    assert(bundle.manifest.runtime.files.some(file => file.path.endsWith(".js") && file.path.startsWith("assets/")));
    for (const file of bundle.manifest.runtime.files) {
      const embedded = bundle.runtimeFiles.find(value => value.path === file.path); assert(embedded, file.path);
      const bytes = Buffer.from(embedded.data, "base64"); assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256);
      assert.deepEqual(bytes, await readFile(`${runtimeRoot}/${file.path}`));
    }
    const grant = bundle.authorization.grant;
    assert.equal(grant.freezeId, summary.id); assert.equal(grant.manifestSha256, summary.manifestSha256);
    assert(Date.parse(grant.expiresAt) > Date.parse(grant.issuedAt)); assert(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) <= 300000);
  });
  await test("consumer rejects self-established trust tampered signatures missing or corrupt bytes duplicate runtime unknown format expiry and clock rollback", async () => {
    const bytes = Buffer.from(JSON.stringify(bundle)), trustedKeys = [sha256(trustedKey.export({ format: "der", type: "spki" }))];
    assert.equal((await verifyFreezeBundle(bytes, { trustedKeys })).bundle.manifest.id, summary.id);
    await assert.rejects(verifyFreezeBundle(bytes, { trustedKeys: [] }), /FREEZE_AUTHORITY_UNTRUSTED/);
    const mutation = change => { const copy = structuredClone(bundle); change(copy); return Buffer.from(JSON.stringify(copy)); };
    for (const [label, change, error] of [
      ["manifest signature", value => { value.signature = Buffer.alloc(64).toString("base64"); }, /FREEZE_SIGNATURE_INVALID/],
      ["grant signature", value => { value.authorization.signature = Buffer.alloc(64).toString("base64"); }, /OFFLINE_GRANT_INVALID/],
      ["manifest title identity", value => { value.manifest.source.exhibitionHash = "0".repeat(64); }, /FREEZE_SIGNATURE_INVALID/],
      ["missing runtime", value => { value.runtimeFiles.pop(); }, /FREEZE_RUNTIME_INTEGRITY/],
      ["duplicate runtime", value => { value.runtimeFiles[1] = value.runtimeFiles[0]; }, /FREEZE_RUNTIME_INTEGRITY/],
      ["runtime byte corruption", value => { const data = Buffer.from(value.runtimeFiles[0].data, "base64"); data[0] ^= 1; value.runtimeFiles[0].data = data.toString("base64"); }, /FREEZE_RUNTIME_INTEGRITY/],
      ["OEX byte corruption", value => { const data = Buffer.from(value.oex, "base64"); data[0] ^= 1; value.oex = data.toString("base64"); }, /FREEZE_OEX_INTEGRITY/],
      ["unknown bundle version", value => { value.schemaVersion = "9.0.0"; }, /FREEZE_VERSION_UNSUPPORTED/],
      ["unknown OEX format", value => { value.manifest.formats.oex = "9.0.0"; }, /FREEZE_FORMAT_UNSUPPORTED/],
      ["runtime traversal", value => { value.manifest.runtime.files[0].path = "../outside.js"; }, /FREEZE_RUNTIME_INVALID/],
      ["foreign grant", value => { value.authorization.grant.tenantId = randomUUID(); }, /OFFLINE_GRANT_INVALID/],
    ]) await assert.rejects(verifyFreezeBundle(mutation(change), { trustedKeys }), error, label);
    await assert.rejects(verifyFreezeBundle(bytes, { trustedKeys, now: Date.parse(bundle.authorization.grant.expiresAt) }), /OFFLINE_GRANT_EXPIRED/);
    await assert.rejects(verifyFreezeBundle(bytes, { trustedKeys, now: Date.parse(bundle.authorization.grant.issuedAt) - 1 }), /OFFLINE_CLOCK_ROLLBACK/);
  });
  await test("freeze bytes and historical scene remain immutable after a new draft revision is saved", async () => {
    const edited = structuredClone(draft); edited.editVersion++; edited.updatedAt = new Date().toISOString(); edited.candidate.title = "Synthetic next revision after immutable freeze";
    await json(request(actors.artist, "PUT", path, { draft: edited, requestId: randomUUID() }, { "if-match": saved.etag }));
    const historical = await json(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }));
    assert.deepEqual(historical.manifest, bundle.manifest); assert.equal(historical.signature, bundle.signature);
    assert.equal(historical.oex, bundle.oex); assert.deepEqual(historical.runtimeFiles, bundle.runtimeFiles);
    const restored = JSON.parse(exportedEntries(Buffer.from(historical.oex, "base64")).find(([name]) => name === "exhibition.json")[1]);
    assert.equal(restored.title, draft.candidate.title); assert.notEqual(restored.title, edited.candidate.title);
    assert.equal((await json(request(actors.artist, "GET", path))).draft.candidate.title, edited.candidate.title);
    await assert.rejects(pool.query("UPDATE exhibition_freezes SET source_snapshot='{}' WHERE id=$1", [summary.id]), /immutable revision/);
    await assert.rejects(pool.query("DELETE FROM exhibition_freezes WHERE id=$1", [summary.id]), /immutable revision/);
  });
  await test("freeze status downloads checks and grant renewal reject foreign actor tenant and CSRF", async () => {
    for (const actor of [actors.other, actors.viewer, actors.curator, fixture.destinationActor]) {
      for (const [method, suffix, payload] of [["GET", "", undefined], ["GET", "/check", undefined], ["POST", "/offline", { seconds: 300 }], ["POST", "/authorize", { seconds: 300 }], ["POST", "/revoke", {}], ["POST", "/restore", {}]])
        await expected(request(actor, method, `${frozenPath}${suffix}`, payload, {}, fixture.tenant), 403);
    }
    for (const suffix of ["offline", "authorize", "revoke", "restore"]) await expected(request(actors.artist, "POST", `${frozenPath}/${suffix}`, suffix === "offline" || suffix === "authorize" ? { seconds: 300 } : {}, { "x-csrf-token": "invalid" }), 403);
    for (const seconds of [0, -1, 28801, 1.5]) await expected(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds }), 400);
  });
  await test("current display export and expired rights deny new offline grants without mutating previous immutable bytes", async () => {
    const asset = fixture.works[0].primaryAssetId;
    const row = (await pool.query("SELECT r.id,r.metadata FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.tenant_id=$1 AND a.id=$2", [fixture.tenant, asset])).rows[0];
    for (const changed of [{ ...row.metadata, permissions: { ...row.metadata.permissions, display: false } }, { ...row.metadata, permissions: { ...row.metadata.permissions, export: false } }, { ...row.metadata, expiresAt: "2000-01-01T00:00:00Z" }]) {
      await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [fixture.tenant, row.id, changed]);
      try {
        for (const [method, suffix, payload] of [["GET", "/check", undefined], ["POST", "/offline", { seconds: 300 }], ["POST", "/authorize", { seconds: 300 }]]) await expected(request(actors.artist, method, `${frozenPath}${suffix}`, payload), 403);
      } finally { await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [fixture.tenant, row.id, row.metadata]); }
    }
    assert.equal((await json(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }))).oex, bundle.oex);
  });
  await test("freeze revocation denies new grants and restoration preserves signed manifest runtime and OEX identity", async () => {
    await expected(request(actors.artist, "POST", `${frozenPath}/revoke`, {}), 200);
    await expected(request(actors.artist, "GET", `${frozenPath}/check`), 403);
    await expected(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }), 403);
    await expected(request(actors.artist, "POST", `${frozenPath}/restore`, {}), 200);
    const restored = await json(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }));
    assert.deepEqual(restored.manifest, bundle.manifest); assert.equal(restored.signature, bundle.signature); assert.equal(restored.oex, bundle.oex);
  });
  await test("real renewed offline authorization is capped by both current rights and authenticated session deadlines", async () => {
    const right = (await pool.query("SELECT r.id,r.metadata FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.tenant_id=$1 AND a.id=$2", [fixture.tenant, fixture.works[0].primaryAssetId])).rows[0];
    const session = (await pool.query("SELECT id,expires_at FROM auth_sessions WHERE tenant_id=$1 AND csrf_token=$2", [fixture.tenant, actors.artist.csrfToken])).rows[0];
    const rightsDeadline = new Date(Date.now() + 120000).toISOString(), sessionDeadline = new Date(Date.now() + 60000).toISOString();
    await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [fixture.tenant, right.id, { ...right.metadata, expiresAt: rightsDeadline }]);
    try {
      const rightsGrant = await json(request(actors.artist, "POST", `${frozenPath}/authorize`, { seconds: 28800 }));
      assert.equal(rightsGrant.grant.expiresAt, rightsDeadline);
      await pool.query("UPDATE auth_sessions SET expires_at=$2 WHERE id=$1", [session.id, sessionDeadline]);
      const sessionGrant = await json(request(actors.artist, "POST", `${frozenPath}/authorize`, { seconds: 28800 }));
      assert.equal(sessionGrant.grant.expiresAt, sessionDeadline);
      await pool.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [session.id]);
      await expected(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 300 }), 401);
    } finally {
      await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [fixture.tenant, right.id, right.metadata]);
      await pool.query("UPDATE auth_sessions SET expires_at=$2 WHERE id=$1", [session.id, session.expires_at]);
    }
  });
  await test("actual SIGKILL after durable byte inventory rolls back incomplete freeze and retry retains prior freezes and source", async () => {
    const { Freezes } = await import("../apps/api/dist/freeze.js"), recovery = new Freezes(pool, fixture.blobs, config);
    const latest = await json(request(actors.artist, "GET", path)), crashRequest = randomUUID(), applicationName = `synthetic-freeze-kill-${crashRequest}`;
    const originalFreezes = (await pool.query("SELECT id,manifest_sha256 FROM exhibition_freezes ORDER BY id")).rows;
    const blocker = await pool.connect(), lock = 1820702;
    await blocker.query("SELECT pg_advisory_lock($1)", [lock]);
    await pool.query(`CREATE FUNCTION synthetic_freeze_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER synthetic_freeze_pause BEFORE INSERT ON exhibition_freezes FOR EACH ROW EXECUTE FUNCTION synthetic_freeze_pause()");
    const child = spawn(process.execPath, [new URL("./freeze-test-worker.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
    let childError = ""; child.stderr.on("data", part => { childError += part.toString(); });
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.stdin.end(JSON.stringify({ database: { host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "postgres", application_name: applicationName },
      runtimeRoot, signingKeyFile: keyFile, origin, blobRoot: fixture.blobs.root, cookie: actors.artist.cookie, csrfToken: actors.artist.csrfToken,
      url: `/api/v1/tenants/${fixture.tenant}${freezePath}`, etag: latest.etag, requestId: crashRequest }));
    let interrupted;
    try {
      for (let attempt = 0; ; attempt++) {
        const paused = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE 'INSERT INTO exhibition_freezes%'", [applicationName])).rowCount;
        if (paused) break;
        assert.equal(child.exitCode, null, childError); if (attempt >= 300) throw Error("Actual freeze worker never reached transaction pause");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      interrupted = (await pool.query("SELECT id,state,object_keys FROM freeze_requests WHERE tenant_id=$1 AND request_id=$2", [fixture.tenant, crashRequest])).rows[0];
      assert.equal(interrupted.state, "creating"); assert(interrupted.object_keys.length > 1);
      for (const key of interrupted.object_keys) assert((await fixture.blobs.get(key)).length > 0);
      assert.deepEqual((await pool.query("SELECT id,manifest_sha256 FROM exhibition_freezes ORDER BY id")).rows, originalFreezes);
      child.kill("SIGKILL"); assert.equal((await exited).signal, "SIGKILL");
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      await blocker.query("SELECT pg_advisory_unlock($1)", [lock]); blocker.release();
      await pool.query("DROP TRIGGER synthetic_freeze_pause ON exhibition_freezes"); await pool.query("DROP FUNCTION synthetic_freeze_pause()");
    }
    await pool.query("UPDATE freeze_requests SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [interrupted.id]);
    assert.equal(await recovery.recover(), true);
    for (const key of interrupted.object_keys) await assert.rejects(fixture.blobs.get(key), /ENOENT/);
    const restored = await json(request(actors.artist, "POST", freezePath, { requestId: crashRequest }, { "if-match": latest.etag }), 201);
    assert.equal(restored.id, interrupted.id); assert.equal((await pool.query("SELECT attempts FROM freeze_requests WHERE id=$1", [interrupted.id])).rows[0].attempts, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM exhibition_freezes WHERE id=$1", [restored.id])).rows[0].n, 1);
    assert.deepEqual((await pool.query("SELECT id,manifest_sha256 FROM exhibition_freezes WHERE id<>$1 ORDER BY id", [restored.id])).rows, originalFreezes);
    assert.deepEqual((await json(request(actors.artist, "GET", path))).draft, latest.draft);
  });
  let changedRuntimeBundle;
  await test("a separately changed verified runtime image creates a distinct freeze while previous signed runtime bytes remain reconstructible", async () => {
    const changedRoot = await realpath(await mkdtemp(`${tmpdir()}/exhibitos-freeze-next-runtime-`));
    for (const file of bundle.runtimeFiles) {
      const target = `${changedRoot}/${file.path}`; await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true }); await writeFile(target, Buffer.from(file.data, "base64"));
    }
    const descriptor = JSON.parse(await readFile(`${changedRoot}/freeze-runtime.json`, "utf8"));
    const changedFile = descriptor.files.find(file => /^assets\/index-.*\.js$/.test(file.path)); assert(changedFile);
    const bytes = Buffer.concat([await readFile(`${changedRoot}/${changedFile.path}`), Buffer.from("\n/* Synthetic independent runtime-image variation. */\n")]);
    await writeFile(`${changedRoot}/${changedFile.path}`, bytes); changedFile.bytes = bytes.length; changedFile.sha256 = sha256(bytes);
    descriptor.coreDigest = sha256(Buffer.from(canonical(descriptor.files))); await writeFile(`${changedRoot}/freeze-runtime.json`, JSON.stringify(descriptor));
    const nextConfig = await loadFreezeConfig({ runtimeRoot: changedRoot, signingKeyFile: keyFile, origin });
    const { buildApp } = await import("../apps/api/dist/app.js"), nextApp = buildApp({ pool, blobs: fixture.blobs, freeze: nextConfig, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
    const next = (method, path, payload, extra = {}) => nextApp.inject({ method, url: `/api/v1/tenants/${fixture.tenant}${path}`, headers: { ...fixture.headers, cookie: actors.artist.cookie, "x-csrf-token": actors.artist.csrfToken, ...extra }, ...(payload === undefined ? {} : { payload }) });
    try {
      const latest = await json(request(actors.artist, "GET", path));
      const created = await json(next("POST", freezePath, { requestId: randomUUID() }, { "if-match": latest.etag }), 201);
      changedRuntimeBundle = await json(next("POST", `${freezePath}/${created.id}/offline`, { seconds: 300 }));
      assert.notEqual(created.manifest.runtime.coreDigest, bundle.manifest.runtime.coreDigest);
      assert.notEqual(created.manifest.runtime.imageDigest, bundle.manifest.runtime.imageDigest);
      await verifyFreezeBundle(Buffer.from(JSON.stringify(changedRuntimeBundle)), { trustedKeys: [sha256(trustedKey.export({ format: "der", type: "spki" }))] });
      const old = await json(next("POST", `${frozenPath}/offline`, { seconds: 300 }));
      assert.deepEqual(old.manifest, bundle.manifest); assert.equal(old.signature, bundle.signature); assert.equal(old.oex, bundle.oex); assert.deepEqual(old.runtimeFiles, bundle.runtimeFiles);
    } finally { await nextApp.close(); }
  });
  await fixture.app.listen({ host: "127.0.0.1", port });
  const { Oex } = await import("../apps/api/dist/oex.js"), oex = new Oex(pool, fixture.blobs);
  const studioReport = await runStudioFreezeBrowser({ origin, tenantId: fixture.tenant, subject: fixture.subject, password: fixture.password,
    archive: Buffer.from(bundle.oex, "base64"), keyId: bundle.manifest.authority.keyId, workImport: () => oex.runNext(),
    publicationCount: async () => (await pool.query("SELECT count(*)::int AS n FROM studio_publications")).rows[0].n });
  checks.push(...studioReport.checks);
  const browserReport = await runFreezeBrowser({ origin, tenantId: fixture.tenant, subject: fixture.subject, password: fixture.password, bundle,
    otherSubject: "synthetic.oex.other",
    changedRuntimeBundle,
    revoke: () => expected(request(actors.artist, "POST", `${frozenPath}/revoke`, {}), 200),
    restore: () => expected(request(actors.artist, "POST", `${frozenPath}/restore`, {}), 200) });
  checks.push(...browserReport.checks);
  const portableReport = await runPortableFreeze({ bundle, shortBundle: () => json(request(actors.artist, "POST", `${frozenPath}/offline`, { seconds: 12 })) });
  checks.push(...portableReport.checks);
  await writeFile(`${directory}/synthetic.oef`, JSON.stringify(bundle));
  const report = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), checks, studioReport: studioReport.reportPath, browserReport: browserReport.reportPath, portableReport: portableReport.reportPath, checkedAt: new Date().toISOString(), scope: "Actual isolated PostgreSQL, Ed25519, approved synthetic GLB/PNG/PCM and browser build; no original data", reportPath: `${directory}/freeze-run.json` };
  await writeFile(report.reportPath, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
} finally {
  await fixture?.app.close().catch(() => {}); await pool?.end().catch(() => {});
  if (started) run("rm", "-f", name);
}
