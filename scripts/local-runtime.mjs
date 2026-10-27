// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, request as httpRequest } from "node:http";
import { constants } from "node:fs";
import { open, mkdir, lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { Transform } from "node:stream";
import { Pool } from "pg";
import { FileBlobStore, migrate } from "../packages/storage/dist/index.js";
import { openLocalWorkspace, validateLocalWorkspace } from "../apps/api/dist/local-workspace.js";
import { readNativeWorkspaceChannel } from "./native-workspace-channel.mjs";
import { bootstrap, config } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { loadFreezeConfig } from "../apps/api/dist/freeze.js";
import { Imports } from "../apps/api/dist/imports.js";

import {FLOOR_TEXTURE_FILES,SURFACE_TEXTURE_FILES} from "@exhibitos/studio-contract";

const MAX_BODY = 65 * 1024 * 1024;
// Native execution has no container port mapping. Bind both listeners to
// loopback explicitly; the original container profile retains its exact ports.
export function localRuntimeNetwork(environment) {
  const mode = environment.EXHIBITOS_RUNTIME_MODE ?? "container";
  if (!["container", "native"].includes(mode)) throw Error("LOCAL_RUNTIME_MODE_INVALID");
  const port = Number(environment.EXHIBITOS_PORT ?? 13200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("LOCAL_CONFIGURATION_INVALID");
  if (mode === "container") return { mode, port, apiPort: 3000, proxyPort: 8080, proxyHost: "0.0.0.0" };
  const apiPort = Number(environment.EXHIBITOS_API_PORT ?? 13201);
  if (String(port) !== String(environment.EXHIBITOS_PORT ?? 13200)
      || String(apiPort) !== String(environment.EXHIBITOS_API_PORT ?? 13201)
      || !Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 || apiPort === port) {
    throw Error("LOCAL_CONFIGURATION_INVALID");
  }
  return { mode, port, apiPort, proxyPort: port, proxyHost: "127.0.0.1" };
}
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);
const mime = path => path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".js") || path.endsWith(".mjs") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : [...FLOOR_TEXTURE_FILES,...SURFACE_TEXTURE_FILES].some(file=>file.path===path) ? "image/png" : "text/plain; charset=utf-8";
async function safeStatic(root, path) {
  let current = root;
  for (const segment of path.split("/")) { current = join(current, segment); if ((await lstat(current)).isSymbolicLink()) throw Error("STATIC_PATH_INVALID"); }
  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const details = await file.stat(); if (!details.isFile() || details.size > 16 * 1024 * 1024) { await file.close(); throw Error("STATIC_FILE_INVALID"); }
  return file;
}
export async function createLocalProxy({ webRoot, origin, apiPort = 3000 }) {
  const root = await realpath(webRoot), allowed = new Set(["basis/basis_transcoder.js", "basis/basis_transcoder.wasm", "basis/exhibitos-basis-worker.js","index.html", "native-viewport.html", "studio-sw.js", "freeze-runtime.json", "THIRD_PARTY_NOTICES.txt", "offline-server.mjs"]);
  for(const file of [...FLOOR_TEXTURE_FILES,...SURFACE_TEXTURE_FILES])allowed.add(file.path);
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
      file = await safeStatic(root, path); reply.writeHead(200, { ...(path === "native-viewport.html" ? {"content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "referrer-policy":"no-referrer"} : {}), ...(path === "basis/exhibitos-basis-worker.js" ? {"content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'"} : {}), "content-type": path.endsWith(".wasm")?"application/wasm":mime(path), "x-content-type-options": "nosniff", "cache-control": "public, max-age=0, must-revalidate", "content-length": (await file.stat()).size });
      if (req.method === "HEAD") { reply.end(); await file.close(); }
      else { const stream = file.createReadStream(); stream.once("error", () => reply.destroy()); reply.once("close", () => { if (!reply.writableFinished) stream.destroy(); }); stream.pipe(reply); }
    } catch { await file?.close().catch(() => {}); if (!reply.headersSent) deny(404); else reply.destroy(); }
  });
  // Preserve the existing publication protocol behind the same bounded proxy.
  // Both public Host and configured client Origin remain checked by the API.
  const upgraded = new Set();
  server.on("upgrade", (req, socket, head) => {
    const reject = code => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (req.headers.host !== expectedHost || !/^\/api\/v1\/publications\/[a-f0-9-]{36}\/(?:presence|opening)$/.test(req.url ?? "") || req.headers.upgrade?.toLowerCase() !== "websocket") { reject(403); return; }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !hop.has(name)));
    delete headers["sec-websocket-extensions"];headers.connection="Upgrade";headers.upgrade="websocket";
    const upstream=httpRequest({hostname:"127.0.0.1",port:apiPort,path:req.url,headers});
    socket.on("error",()=>upstream.destroy());
    upstream.on("error",()=>{if(!socket.destroyed)reject(502);});
    upstream.on("response",response=>{response.resume();reject(response.statusCode===403?403:502);});
    upstream.on("upgrade",(response,remote,remoteHead)=>{
      if(response.statusCode!==101){remote.destroy();reject(502);return;}
      const accepted=response.headers["sec-websocket-accept"];
      if(typeof accepted!=="string"||!/^[a-zA-Z0-9+/]{27}=$/.test(accepted)){remote.destroy();reject(502);return;}
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accepted}\r\n\r\n`);
      upgraded.add(socket);upgraded.add(remote);
      for(const item of [socket,remote])item.on("close",()=>{upgraded.delete(item);socket.destroy();remote.destroy();});
      remote.on("error",()=>socket.destroy());
      if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);
      socket.pipe(remote);remote.pipe(socket);
    });
    upstream.end();
  });
  server.closeUpgradedConnections=()=>{for(const socket of upgraded)socket.destroy();};
  server.on("close",()=>server.closeUpgradedConnections());
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
export async function startLocalRuntime(environment = process.env, privateWorkspace) {
  const { port, apiPort, proxyPort, proxyHost } = localRuntimeNetwork(environment);
  const personal = environment.EXHIBITOS_AUTHORING_MODE === "personal";
  if (environment.EXHIBITOS_AUTHORING_MODE !== undefined && !personal) throw Error("LOCAL_AUTHORING_MODE_INVALID");
  if (personal) {
    validateLocalWorkspace(privateWorkspace, environment.EXHIBITOS_RUNTIME_MODE);
    if (privateWorkspace.tenantId !== environment.TENANT_ID || environment.ADMIN_SUBJECT !== undefined || environment.ADMIN_PASSWORD !== undefined) throw Error("LOCAL_WORKSPACE_CONFIGURATION_INVALID");
  } else if (privateWorkspace !== undefined) throw Error("LOCAL_WORKSPACE_CHANNEL_INVALID");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !environment.DATABASE_URL || !/^[a-f0-9-]{36}$/.test(environment.TENANT_ID ?? "") || (!personal && (!environment.ADMIN_SUBJECT || !environment.ADMIN_PASSWORD))) throw Error("LOCAL_CONFIGURATION_INVALID");
  const origin = `http://127.0.0.1:${port}`;
  if (environment.AUTH_ORIGIN !== undefined && environment.AUTH_ORIGIN !== origin) throw Error("LOCAL_ORIGIN_INVALID");
  const webRoot = fileURLToPath(new URL("../apps/web/dist/", import.meta.url)), migrationDirectory = fileURLToPath(new URL("../database/migrations/", import.meta.url));
  const blobRoot = resolve(environment.BLOB_ROOT ?? "/data/blobs"), configRoot = resolve(environment.CONFIG_ROOT ?? "/data/config");
  const pool = new Pool({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  // pg-pool already removes the failed idle client. Handle its separate error event
  // so readiness can report unavailable without an uncaught process exception.
  pool.on("error", () => { console.error("Local database connection became unavailable; pending jobs remain recoverable."); });
  let app, proxy, stage = "MIGRATIONS";
  try {
    await migrate(pool, migrationDirectory);
    stage = "BOOTSTRAP";
    if (personal) await openLocalWorkspace(pool, privateWorkspace, environment.EXHIBITOS_RUNTIME_MODE);
    else {
      if ((await pool.query("SELECT 1 FROM local_workspaces LIMIT 1")).rowCount) throw Error("LOCAL_WORKSPACE_ACCOUNT_MODE_REFUSED");
      if (!(await pool.query("SELECT 1 FROM auth_credentials LIMIT 1")).rowCount) await bootstrap(pool, environment.TENANT_ID, environment.ADMIN_SUBJECT, environment.ADMIN_PASSWORD);
    }
    stage = "STORAGE"; await mkdir(blobRoot, { recursive: true, mode: 0o700 });
    stage = "SIGNING_KEY";
    const keyFile = await signingKey(configRoot), freeze = await loadFreezeConfig({ runtimeRoot: webRoot, signingKeyFile: keyFile, origin });
    stage = "API"; const blobs = new FileBlobStore(blobRoot);
    app = buildApp({ pool, blobs, auth: config({ mode: "local", origin, bindHost: "127.0.0.1" }), freeze, oexWorker: true, lifecycle: { migrationDirectory, webRoot, blobRoot } });
    await app.listen({ host: "127.0.0.1", port: apiPort });
    stage = "WEB_PROXY"; proxy = await createLocalProxy({ webRoot, origin, apiPort }); await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(proxyPort, proxyHost, resolve); });
    const importer = new Imports(pool, blobs); let stopping = false, timer, running, failures = 0, closed;
    const tick = async () => { try { await importer.work(); failures = 0; } catch { console.error("Local import worker failed; pending jobs remain recoverable."); if (++failures >= 5) { stopping = true; process.exitCode = 1; setImmediate(() => { void close(); }); } } finally { if (!stopping) { timer = setTimeout(() => { running = tick(); }, 1000); timer.unref(); } } };
    running = tick();
    const close = () => closed ??= (async () => { stopping = true; clearTimeout(timer); proxy.closeUpgradedConnections(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await running; await app.close(); await pool.end(); })();
    return { app, proxy, pool, origin, close };
  } catch { proxy?.closeAllConnections(); proxy?.close(); await app?.close().catch(() => {}); await pool.end(); throw Error(`LOCAL_RUNTIME_START_FAILED_${stage}`); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const privateWorkspace = process.env.EXHIBITOS_AUTHORING_MODE === "personal" ? await readNativeWorkspaceChannel() : undefined; const runtime = await startLocalRuntime(process.env, privateWorkspace); console.info("ExhibitOS local runtime started."); for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await runtime.close(); }); }
  catch (error) { console.error(/^LOCAL_[A-Z_]+$/.test(error.message) ? error.message : "LOCAL_RUNTIME_START_FAILED"); process.exitCode = 1; }
}
