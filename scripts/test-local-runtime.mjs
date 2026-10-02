// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createLocalProxy } from "./local-runtime.mjs";
import { packageLocalRuntime } from "./package-local-runtime.mjs";
import { loadViewerFixtures } from "./viewer-fixtures.mjs";

const directory = await realpath(await mkdtemp(`${tmpdir()}/exhibitos-local-runtime-`)), checks = [], engine = process.env.CONTAINER_ENGINE ?? "docker";
const run = args => execFileSync(engine, args, { encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const test = async (title, action) => { await action(); checks.push(title); console.log(`PASS ${title}`); };
async function listen(server, port = 0) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); return server.address().port; }
async function stop(server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
const http = (port, path, headers = {}, body) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, method: body === undefined ? "GET" : "POST", path, headers }, response => { const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.once("end", () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks), headers: response.headers })); }); req.once("error", reject); req.end(body);
});
const web = `${directory}/proxy-web`; await mkdir(`${web}/assets`, { recursive: true });
await writeFile(`${web}/index.html`, "<!doctype html><title>Synthetic proxy</title>"); await writeFile(`${web}/assets/good.js`, "/* synthetic */"); await writeFile(`${directory}/hidden.txt`, "synthetic-private-content"); await symlink(`${directory}/hidden.txt`, `${web}/assets/linked.js`);
let received;
const upstream = createServer((req, reply) => { const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { received = { headers: req.headers, body: Buffer.concat(chunks) }; reply.setHeader("content-type", "application/json"); reply.end('{"accepted":true}'); }); });
const upstreamPort = await listen(upstream), proxy = await createLocalProxy({ webRoot: web, origin: "http://127.0.0.1:13200", apiPort: upstreamPort }), proxyPort = await listen(proxy);
try {
  await test("actual HTTP proxy serves only closed static routes and rejects traversal symlinks secret paths wrong Host and methods", async () => {
    for (const path of ["/", "/studio", "/cms", "/offline", "/assets/good.js"]) assert.equal((await http(proxyPort, path, { host: "127.0.0.1:13200" })).status, 200);
    for (const path of ["/.env", "/package.json", "/operations/AGENTS.md", "/assets/linked.js"]) assert.equal((await http(proxyPort, path, { host: "127.0.0.1:13200" })).status, 404);
    assert.equal((await http(proxyPort, "/%2e%2e/hidden.txt", { host: "127.0.0.1:13200" })).status, 400); assert.equal((await http(proxyPort, "/", { host: "attacker.invalid" })).status, 403); assert.equal((await http(proxyPort, "/studio", { host: "127.0.0.1:13200" }, "x")).status, 405);
  });
  await test("actual HTTP streaming proxy preserves browser Host Origin cookie CSRF and excludes spoofed forwarding headers", async () => {
    const payload = randomBytes(16384), result = await http(proxyPort, "/api/v1/synthetic", { host: "127.0.0.1:13200", origin: "http://127.0.0.1:13200", cookie: "synthetic=private", "x-csrf-token": "synthetic-csrf", "x-forwarded-host": "attacker.invalid", forwarded: "host=attacker.invalid", "content-type": "application/octet-stream" }, payload);
    assert.equal(result.status, 200); assert.deepEqual(received.body, payload); assert.equal(received.headers.host, "127.0.0.1:13200"); assert.equal(received.headers.origin, "http://127.0.0.1:13200"); assert.equal(received.headers.cookie, "synthetic=private"); assert.equal(received.headers["x-csrf-token"], "synthetic-csrf"); assert.equal(received.headers.forwarded, undefined); assert.equal(received.headers["x-forwarded-host"], undefined);
    assert.equal((await http(proxyPort, "/api/v1/synthetic", { host: "127.0.0.1:13200", "content-length": 66 * 1024 * 1024 }, "")).status, 413);
  });
} finally { await stop(proxy); await stop(upstream); }
if (process.env.EXHIBITOS_PROXY_ONLY === "1") { console.log(`Actual proxy checks ${checks.length} PASS`); process.exit(0); }
const reserved = createTcpServer(); await listen(reserved, 13200); await stop(reserved);
const bundle = await packageLocalRuntime(`${directory}/artifact`, { engine }), manifest = bundle.manifest;
const postgresPassword = randomBytes(24).toString("hex"), adminPassword = `${randomBytes(24).toString("hex")}Aa1`, tenantId = randomUUID();
const environmentFile = `${directory}/artifact/runtime.env`, compose = ["compose", "--env-file", environmentFile, "--file", `${bundle.directory}/compose.yaml`, "--project-name", manifest.projectName];
await writeFile(environmentFile, `EXHIBITOS_PORT=13200\nPOSTGRES_PASSWORD=${postgresPassword}\nDATABASE_URL=postgresql://exhibitos:${postgresPassword}@database:5432/exhibitos\nADMIN_SUBJECT=synthetic-local-admin\nADMIN_PASSWORD=${adminPassword}\nTENANT_ID=${tenantId}\n`, { mode: 0o600 });
let started = false, artifact, asset, cookie, csrf, authority;
const origin = manifest.openUrl, sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function api(method, path, body, expected = 200, extra = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { origin, ...(cookie ? { cookie, "x-csrf-token": csrf } : {}), ...(body === undefined ? {} : { "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json" }), ...extra }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
  assert.equal(response.status, expected, `Actual runtime HTTP ${method} ${path} status`); return response;
}
try {
  await test("real image tar and Compose manifest match hashes private named volumes loopback ports and pruned nonroot image", async () => {
    assert.equal(sha256(await readFile(`${bundle.directory}/compose.yaml`)), manifest.composeSha256); const image = manifest.images.find(item => item.archive); assert.equal(sha256(await readFile(`${bundle.directory}/${image.archive.path}`)), image.archive.sha256);
    run(["load", "--input", `${bundle.directory}/platform-image.tar`]); assert.equal(run(["image", "inspect", "--format", "{{.Id}}", image.reference]), image.reference);
    assert.equal(run(["image", "inspect", "--format", "{{.Config.User}}", image.reference]), "node");
    run(["run", "--rm", "--entrypoint", "node", image.reference, "-e", "const f=require('node:fs');for(const p of['.local','operations','capture-ios','.env','node_modules/typescript','node_modules/vite'])if(f.existsSync(p))process.exit(1);if(!f.existsSync('apps/web/dist/THIRD_PARTY_NOTICES.txt'))process.exit(2)"]);
    const resolved = JSON.parse(run([...compose, "config", "--format", "json"])); assert.equal(resolved.services.platform.ports[0].host_ip, "127.0.0.1"); assert.equal(Number(resolved.services.platform.ports[0].published), 13200); assert.equal(resolved.services.database.ports, undefined);
    for (const service of Object.values(resolved.services)) for (const volume of service.volumes ?? []) assert.equal(volume.type, "volume");
    for (const secret of [postgresPassword, adminPassword]) { assert.equal(JSON.stringify(manifest).includes(secret), false); assert.equal((await readFile(`${bundle.directory}/compose.yaml`, "utf8")).includes(secret), false); }
  });
  await test("actual Compose applies migrations bootstraps once serves production Studio notices and current readiness", async () => {
    started = true; run([...compose, "up", "--detach"]);
    for (let attempt = 0; ; attempt++) {
      try { const response = await fetch(`${origin}/api/v1/readiness`); if (response.ok && (await response.json()).ready) break; } catch { /* Newly started listener is not yet available. */ }
      const platform = run([...compose, "ps", "--all", "--quiet", "platform"]); assert.equal(Number(run(["inspect", "--format", "{{.RestartCount}}", platform])), 0, "Actual platform exited before readiness");
      if (attempt >= 240) throw Error("Actual local runtime readiness deadline exceeded"); await new Promise(resolve => setTimeout(resolve, 250));
    }
    const platform = run([...compose, "ps", "--all", "--quiet", "platform"]);
    for (let attempt = 0; run(["inspect", "--format", "{{.State.Health.Status}}", platform]) !== "healthy"; attempt++) { if (attempt >= 90) throw Error("Actual runtime container health check did not become healthy"); await new Promise(resolve => setTimeout(resolve, 250)); }
    const ready = await (await api("GET", "/api/v1/readiness")).json(); assert.equal(ready.ready, true); assert.equal(ready.protocolVersion, "1"); assert.equal(ready.platformVersion, "0.1.0"); assert.deepEqual(ready.services.map(item => item.name).sort(), ["api", "database", "platform", "storage", "web"]); assert(ready.services.every(item => item.status === "ready"));
    assert((await (await api("GET", "/studio")).text()).includes("<html")); assert((await (await api("GET", "/THIRD_PARTY_NOTICES.txt")).text()).includes("three.js authors"));
    const login = await api("POST", "/api/v1/auth/login", { subject: "synthetic-local-admin", password: adminPassword, tenantId }); cookie = login.headers.get("set-cookie").split(";")[0]; csrf = (await (await api("GET", "/api/v1/auth/session")).json()).csrfToken;
    authority = (await (await api("GET", "/api/v1/freeze/authority")).json()).authority;
    const count = run([...compose, "exec", "--no-TTY", "database", "psql", "-U", "exhibitos", "-d", "exhibitos", "-At", "-c", "SELECT count(*) FROM schema_migrations"]); assert.equal(count, "10");
  });
  await test("actual proxy auth rejects invalid CSRF Origin wrong Host and unauthenticated tenant metadata", async () => {
    await api("POST", `/api/v1/tenants/${tenantId}/cms/artists`, { name: "denied", bio: "synthetic" }, 403, { "x-csrf-token": "invalid" }); await api("POST", `/api/v1/tenants/${tenantId}/cms/artists`, { name: "denied", bio: "synthetic" }, 403, { origin: "http://attacker.invalid" }); assert.equal((await http(13200, "/api/v1/auth/session", { host: "attacker.invalid", cookie })).status, 403);
    assert.equal((await fetch(`${origin}/api/v1/tenants/${tenantId}/cms/artists`)).status, 401);
  });
  await test("actual local import worker approves synthetic GLB with persistent private object bytes", async () => {
    const prefix = `/api/v1/tenants/${tenantId}`, artist = await (await api("POST", `${prefix}/cms/artists`, { name: "Synthetic local runtime artist", bio: "Independent public image fixture" }, 201)).json();
    const rights = { holder: "Synthetic runtime owner", ownership: "owner", licenseId: "CC0-1.0", permissions: { display: true, download: true, export: true, commercial: false }, creditLine: "Synthetic runtime test" };
    artifact = await (await api("POST", `${prefix}/cms/artworks`, { artistId: artist.id, title: "Synthetic persistent sculpture", description: "Local runtime smoke fixture", medium: "Synthetic GLB", creationYear: 2026, dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, rights, provenance: { source: "human-authored", sourceUnits: "m", scaleApplied: true, notes: "Synthetic authored bytes" } }, 201)).json();
    const bytes = loadViewerFixtures().find(item => item.type === "sculpture").bytes;
    const job = await (await api("POST", `${prefix}/imports`, { artworkId: artifact.id, idempotencyKey: randomUUID(), mime: "model/gltf-binary", sha256: sha256(bytes), bytes: bytes.length, scaleMeters: 1, rights }, 201)).json(); await api("PUT", `${prefix}/imports/${job.id}/bytes`, bytes); await api("POST", `${prefix}/imports/${job.id}/complete`);
    for (let attempt = 0; ; attempt++) { const result = await (await api("GET", `${prefix}/imports/${job.id}`)).json(); if (result.state === "approved") { asset = { id: result.assetId, bytes }; break; } assert.notEqual(result.state, "failed"); if (attempt > 90) throw Error("Actual local import worker did not finish"); await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.equal(sha256(Buffer.from(await (await api("GET", `${prefix}/assets/${asset.id}/bytes`)).arrayBuffer())), sha256(bytes));
  });
  await test("actual stop and restart preserve CMS metadata object hashes signing authority account and session", async () => {
    run([...compose, "stop"]); await assert.rejects(fetch(`${origin}/api/v1/readiness`)); run([...compose, "start", "--wait", "--wait-timeout", "240"]);
    assert.equal((await (await api("GET", "/api/v1/readiness")).json()).ready, true); assert.equal((await (await api("GET", `/api/v1/tenants/${tenantId}/cms/artworks/${artifact.id}`)).json()).metadata.title, artifact.metadata.title);
    assert.equal(sha256(Buffer.from(await (await api("GET", `/api/v1/tenants/${tenantId}/assets/${asset.id}/bytes`)).arrayBuffer())), sha256(asset.bytes)); assert.deepEqual((await (await api("GET", "/api/v1/freeze/authority")).json()).authority, authority);
    assert.equal(run([...compose, "exec", "--no-TTY", "database", "psql", "-U", "exhibitos", "-d", "exhibitos", "-At", "-c", "SELECT count(*) FROM auth_credentials"]), "1");
    const logs = run([...compose, "logs", "--no-color"]); for (const secret of [postgresPassword, adminPassword, cookie, csrf]) assert.equal(logs.includes(secret), false);
  });
  const report = { schemaVersion: "1.0.0-draft.1", passed: true, checks, manifest, engineVersion: run(["version", "--format", "{{.Server.Version}}"]), architecture: run(["image", "inspect", "--format", "{{.Architecture}}", manifest.images[0].reference]), limits: ["Only synthetic owned Docker resources", "No Windows/Podman or signed downloadable release qualification", "Port13200 local HTTP only"] };
  await writeFile(`${directory}/local-runtime-run.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(`Actual local runtime checks ${checks.length} PASS; report ${directory}/local-runtime-run.json`);
} catch (error) {
  if (started) { const logs = run([...compose, "logs", "--no-color"]); for (const secret of [postgresPassword, adminPassword]) assert.equal(logs.includes(secret), false); await writeFile(`${directory}/failed-container-logs.txt`, logs, { mode: 0o600 }); console.log(`Private synthetic failure diagnostics: ${directory}/failed-container-logs.txt`); }
  throw error;
} finally {
  if (started) { const configuration = JSON.parse(run([...compose, "config", "--format", "json"])); run([...compose, "down"]); for (const volume of Object.values(configuration.volumes)) { assert.equal(run(["volume", "inspect", "--format", '{{index .Labels "com.exhibitos.bundle"}}', volume.name]), manifest.bundleId); run(["volume", "rm", volume.name]); } }
}
