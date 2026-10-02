// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, request as httpRequest } from "node:http";
import { constants } from "node:fs";
import { open, mkdir, lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { Transform } from "node:stream";
import { Pool } from "pg";
import { FileBlobStore, migrate } from "../packages/storage/dist/index.js";
import { bootstrap, config } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { loadFreezeConfig } from "../apps/api/dist/freeze.js";
import { Imports } from "../apps/api/dist/imports.js";

const MAX_BODY = 65 * 1024 * 1024;
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);
const mime = path => path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".js") || path.endsWith(".mjs") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
async function safeStatic(root, path) {
  let current = root;
  for (const segment of path.split("/")) { current = join(current, segment); if ((await lstat(current)).isSymbolicLink()) throw Error("STATIC_PATH_INVALID"); }
  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const details = await file.stat(); if (!details.isFile() || details.size > 16 * 1024 * 1024) { await file.close(); throw Error("STATIC_FILE_INVALID"); }
  return file;
}
export async function createLocalProxy({ webRoot, origin, apiPort = 3000 }) {
  const root = await realpath(webRoot), allowed = new Set(["index.html", "studio-sw.js", "freeze-runtime.json", "THIRD_PARTY_NOTICES.txt", "offline-server.mjs"]);
  for (const name of await readdir(join(root, "assets"))) if (/^[-\w.]+\.(?:js|css)$/.test(name)) allowed.add(`assets/${name}`);
  const expectedHost = new URL(origin).host;
  const server = createServer(async (req, reply) => {
    const deny = status => { reply.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" }); reply.end(JSON.stringify({ code: status === 404 ? "NOT_FOUND" : "REQUEST_DENIED" })); };
    if (req.headers.host !== expectedHost) { req.resume(); deny(403); return; }
    let pathname;
    try { pathname = decodeURIComponent((req.url ?? "").split("?")[0]); } catch { deny(400); return; }
    if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some(value => value === "." || value === "..")) { deny(400); return; }
    if (pathname.startsWith("/api/")) {
      if (!/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(req.method ?? "")) { deny(405); return; }
      if (req.headers["content-length"] !== undefined && (!/^\d+$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > MAX_BODY)) { req.resume(); deny(413); return; }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !hop.has(name)));
      const upstream = httpRequest({ hostname: "127.0.0.1", port: apiPort, method: req.method, path: req.url, headers }, response => {
        reply.writeHead(response.statusCode ?? 502, Object.fromEntries(Object.entries(response.headers).filter(([name]) => !hop.has(name)))); response.once("error", () => reply.destroy()); response.pipe(reply);
      });
      let bytes = 0;
      const bounded = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > MAX_BODY) done(Error("BODY_LIMIT")); else done(null, chunk); } });
      bounded.once("error", () => { upstream.destroy(); if (!reply.headersSent) deny(413); req.resume(); });
      upstream.once("error", () => { if (!reply.headersSent) deny(502); else reply.destroy(); });
      req.once("aborted", () => upstream.destroy()); req.once("error", () => upstream.destroy()); reply.once("close", () => { if (!reply.writableFinished) upstream.destroy(); });
      req.pipe(bounded).pipe(upstream); return;
    }
    if (!new Set(["GET", "HEAD"]).has(req.method)) { req.resume(); deny(405); return; }
    const path = ["/", "/studio", "/cms", "/offline"].includes(pathname) || /^\/p\/[a-f0-9-]{36}$/.test(pathname) ? "index.html" : pathname.slice(1);
    if (!allowed.has(path)) { deny(404); return; }
    let file;
    try {
      file = await safeStatic(root, path); reply.writeHead(200, { "content-type": mime(path), "x-content-type-options": "nosniff", "cache-control": "no-store", "content-length": (await file.stat()).size });
      if (req.method === "HEAD") { reply.end(); await file.close(); }
      else { const stream = file.createReadStream(); stream.once("error", () => reply.destroy()); reply.once("close", () => { if (!reply.writableFinished) stream.destroy(); }); stream.pipe(reply); }
    } catch { await file?.close().catch(() => {}); if (!reply.headersSent) deny(404); else reply.destroy(); }
  });
  server.headersTimeout = 15000; server.requestTimeout = 120000; server.keepAliveTimeout = 5000; return server;
}
async function signingKey(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 }); const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077)) throw Error("CONFIG_DIRECTORY_INVALID");
  const path = join(directory, "freeze-signing-key.json");
  try {
    const file = await open(path, "wx", 0o600);
    try { const { privateKey } = generateKeyPairSync("ed25519"); await file.writeFile(JSON.stringify({ name: "exhibitos-freeze-ed25519", schemaVersion: "1.0.0-draft.1", privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") })); await file.sync(); } finally { await file.close(); }
  } catch (error) { if (error.code !== "EEXIST") throw error; }
  return path;
}
export async function startLocalRuntime(environment = process.env) {
  const port = Number(environment.EXHIBITOS_PORT ?? 13200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !environment.DATABASE_URL || !/^[a-f0-9-]{36}$/.test(environment.TENANT_ID ?? "") || !environment.ADMIN_SUBJECT || !environment.ADMIN_PASSWORD) throw Error("LOCAL_CONFIGURATION_INVALID");
  const origin = `http://127.0.0.1:${port}`;
  if (environment.AUTH_ORIGIN !== undefined && environment.AUTH_ORIGIN !== origin) throw Error("LOCAL_ORIGIN_INVALID");
  const webRoot = new URL("../apps/web/dist/", import.meta.url).pathname, migrationDirectory = new URL("../database/migrations/", import.meta.url).pathname;
  const blobRoot = resolve(environment.BLOB_ROOT ?? "/data/blobs"), configRoot = resolve(environment.CONFIG_ROOT ?? "/data/config");
  const pool = new Pool({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 }); let app, proxy, stage = "MIGRATIONS";
  try {
    await migrate(pool, migrationDirectory);
    stage = "BOOTSTRAP";
    if (!(await pool.query("SELECT 1 FROM auth_credentials LIMIT 1")).rowCount) await bootstrap(pool, environment.TENANT_ID, environment.ADMIN_SUBJECT, environment.ADMIN_PASSWORD);
    stage = "STORAGE"; await mkdir(blobRoot, { recursive: true, mode: 0o700 });
    stage = "SIGNING_KEY";
    const keyFile = await signingKey(configRoot), freeze = await loadFreezeConfig({ runtimeRoot: webRoot, signingKeyFile: keyFile, origin });
    stage = "API"; const blobs = new FileBlobStore(blobRoot);
    app = buildApp({ pool, blobs, auth: config({ mode: "local", origin, bindHost: "127.0.0.1" }), freeze, oexWorker: true, lifecycle: { migrationDirectory, webRoot, blobRoot } });
    await app.listen({ host: "127.0.0.1", port: 3000 });
    stage = "WEB_PROXY"; proxy = await createLocalProxy({ webRoot, origin }); await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(8080, "0.0.0.0", resolve); });
    const importer = new Imports(pool, blobs); let stopping = false, timer, running, failures = 0, closed;
    const tick = async () => { try { await importer.work(); failures = 0; } catch { console.error("Local import worker failed; pending jobs remain recoverable."); if (++failures >= 5) { stopping = true; process.exitCode = 1; setImmediate(() => { void close(); }); } } finally { if (!stopping) { timer = setTimeout(() => { running = tick(); }, 1000); timer.unref(); } } };
    running = tick();
    const close = () => closed ??= (async () => { stopping = true; clearTimeout(timer); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await running; await app.close(); await pool.end(); })();
    return { app, proxy, pool, origin, close };
  } catch { proxy?.closeAllConnections(); proxy?.close(); await app?.close().catch(() => {}); await pool.end(); throw Error(`LOCAL_RUNTIME_START_FAILED_${stage}`); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const runtime = await startLocalRuntime(); console.info("ExhibitOS local runtime started."); for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await runtime.close(); }); }
  catch (error) { console.error(/^LOCAL_[A-Z_]+$/.test(error.message) ? error.message : "LOCAL_RUNTIME_START_FAILED"); process.exitCode = 1; }
}
