// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, request as httpRequest } from "node:http";
import { constants } from "node:fs";
import { open, mkdir, lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { Transform } from "node:stream";
import { Pool } from "pg";
import { FileBlobStore, migrate, migrateInTransaction, transaction } from "../packages/storage/dist/index.js";
import { openLocalWorkspace, validateLocalWorkspace } from "../apps/api/dist/local-workspace.js";
import { readNativeWorkspaceChannel } from "./native-workspace-channel.mjs";
import {closeNativeOwnerDescriptor,openNativeOwnerChannel,unpackNativeOwnerInput} from "./native-owner-channel.mjs";
import {openHayesOwnerChannel} from "./native-hayes-owner-channel.mjs";
import {HAYES_DISPOSITION_CAPABILITY,HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,hasHayesDispositionCapability,HAYES_ORIGINAL_CAPABILITY,HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,hasHayesOriginalCapability,WORKSPACE_PORTAL_FINISH_CAPABILITY,hasWorkspacePortalFinishCapability,WORKSPACE_FRAME_PREPARATION_CAPABILITY,WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,hasWorkspaceFramePreparationCapability,WORKSPACE_FURNISHING_ARTWORK_FRAME_MODELS_CAPABILITY,hasWorkspaceFurnishingArtworkFrameModelsCapability,WORKSPACE_FURNISHING_ARTWORK_FRAME_CAPABILITY,hasWorkspaceFurnishingArtworkFrameCapability,WORKSPACE_FURNISHING_ROOM_VISUAL_CAPABILITY,hasWorkspaceFurnishingRoomVisualCapability,WORKSPACE_FURNISHING_STOOL_CAPABILITY,hasWorkspaceFurnishingStoolCapability,WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY,WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256,hasWorkspaceMaterialMultimapCapability,assertExactWorkspaceMaterialMultimapCatalog,WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,hasWorkspaceMaterialPublicationCapability,assertExactWorkspaceMaterialPublicationCatalog,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,preflightNormalOexCatalog,assertExactWorkspacePublicationCatalog,assertWorkspaceImportOwnerMode,verifyNormalOexMigration,verifyNormalOexProvenanceMigration,verifyNormalOexMaterialMigration,verifyNormalOexFloorMigration,verifyNormalOexConcreteMigration,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,verifyWorkspaceMaterialMigrations,hasWorkspaceMaterialCapability,hasWorkspaceImportCapability,verifyWorkspaceImportMigrations,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,hasWorkspaceWallImportCapability,verifyWorkspaceWallImportMigration,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256} from "./native-oex-normal-catalog.mjs";
import { Auth, bootstrap, config } from "../apps/api/dist/auth.js";
import {createNativeHayesCaller} from "../apps/api/dist/native-hayes-caller.js";
import { buildApp } from "../apps/api/dist/app.js";
import {WorkspaceMaterialIntakes} from "../apps/api/dist/workspace-material-intakes.js";
import {validateWorkspaceMaterial} from "@exhibitos/spec/workspace-material";
import { loadFreezeConfig } from "../apps/api/dist/freeze.js";
import { Imports } from "../apps/api/dist/imports.js";
import {createSelectedNativeUploadSlot} from "../apps/api/dist/native-bounded-oex-upload.js";
import {createSelectedStudioPutSlot} from "../apps/api/dist/native-selected-studio-put.js";
import {runFreshNativeOexOwner} from "../apps/api/dist/native-fresh-oex-owner.js";
import {bindNativeOexWorkspace,bindNativeLocalExportWorkspace} from "../apps/api/dist/native-oex-provenance.js";
import {bindHayesOriginalContext} from "../apps/api/dist/hayes-original-attempt.js";
import {bindNativeDetailContext} from "../apps/api/dist/native-detail-context.js";
import {hasNativeDetailCapability,hasNativeDetailRequiredFiles,NATIVE_DETAIL_CAPABILITY} from './native-detail-capability.mjs';
import {hasWorkspaceFurnishingCapability,verifyWorkspaceFurnishingMigration,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256} from './native-oex-normal-catalog.mjs';
import {assertFurnishingBeforeCommit,assertWorkspaceFurnishingRuntimeAdmission,prepareWorkspaceFurnishingCatalog} from './native-workspace-furnishing-bootstrap.mjs';
import {WorkspaceFurnishingIntakes} from '../apps/api/dist/workspace-furnishing-intakes.js';
import {hasWorkspaceFurnishingWriterCapability,verifyWorkspaceFurnishingWriterMigration,WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,hasWorkspaceFurnishingPublicationCapability,verifyWorkspaceFurnishingPublicationMigration,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256,WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY} from './native-oex-normal-catalog.mjs';
import {acceptFurnishingWriterLease,acceptFurnishingOrdinaryAdmission,assertIssuedFurnishingOrdinaryAdmission,furnishingOrdinaryStopControl,finalizeFurnishingOrdinaryStop} from './native-workspace-furnishing-admission.mjs';
import {pinNativeOexPayloadManifest} from '../apps/api/dist/native-oex-payload.js';

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
export async function createLocalProxy({ webRoot, origin, apiPort = 3000, disableUpgrades = false, isAvailable = () => true }) {
  const root = await realpath(webRoot), allowed = new Set(["basis/basis_transcoder.js", "basis/basis_transcoder.wasm", "basis/exhibitos-basis-worker.js","index.html", "native-viewport.html", "studio-sw.js", "freeze-runtime.json", "THIRD_PARTY_NOTICES.txt", "offline-server.mjs"]);
  for(const file of [...FLOOR_TEXTURE_FILES,...SURFACE_TEXTURE_FILES])allowed.add(file.path);
  for (const name of await readdir(join(root, "assets"))) if (/^[-\w.]+\.(?:js|css)$/.test(name)) allowed.add(`assets/${name}`);
  const expectedHost = new URL(origin).host;
  const server = createServer(async (req, reply) => {
    const deny = status => { reply.writeHead(status, { "cache-control": "no-store", "content-type": "application/json" }); reply.end(JSON.stringify({ code: status === 404 ? "NOT_FOUND" : "REQUEST_DENIED" })); };
    if(!isAvailable()){req.resume();deny(503);return;}
    if (req.headers.host !== expectedHost) { req.resume(); deny(403); return; }
    let pathname;
    try { pathname = decodeURIComponent((req.url ?? "").split("?")[0]); } catch { deny(400); return; }
    if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some(value => value === "." || value === "..")) { deny(400); return; }
    if (pathname.startsWith("/api/")) {
      if (!/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(req.method ?? "")) { deny(405); return; }
      if (req.headers["content-length"] !== undefined && (!/^\d+$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > MAX_BODY)) { req.resume(); deny(413); return; }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !hop.has(name)));
      const upstream = httpRequest({ hostname: "127.0.0.1", port: apiPort, method: req.method, path: req.url, headers }, response => {
        if(!isAvailable()){response.resume();deny(503);return;}
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
      file = await safeStatic(root, path);const size=(await file.stat()).size;if(!isAvailable()){await file.close();deny(503);return;}reply.writeHead(200, { ...(path === "native-viewport.html" ? {"content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "referrer-policy":"no-referrer"} : {}), ...(path === "basis/exhibitos-basis-worker.js" ? {"content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'"} : {}), "content-type": path.endsWith(".wasm")?"application/wasm":mime(path), "x-content-type-options": "nosniff", "cache-control": "public, max-age=0, must-revalidate", "content-length": size });
      if (req.method === "HEAD") { reply.end(); await file.close(); }
      else { const stream = file.createReadStream(); stream.once("error", () => reply.destroy()); reply.once("close", () => { if (!reply.writableFinished) stream.destroy(); }); stream.pipe(reply); }
    } catch { await file?.close().catch(() => {}); if (!reply.headersSent) deny(404); else reply.destroy(); }
  });
  // Preserve the existing publication protocol behind the same bounded proxy.
  // Both public Host and configured client Origin remain checked by the API.
  const upgraded = new Set();
  server.on("upgrade", (req, socket, head) => {
    const reject = code => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if(!isAvailable()){reject(503);return;}if(disableUpgrades){reject(403);return;}
    if (req.headers.host !== expectedHost || !/^\/api\/v1\/publications\/[a-f0-9-]{36}\/(?:presence|opening)$/.test(req.url ?? "") || req.headers.upgrade?.toLowerCase() !== "websocket") { reject(403); return; }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !hop.has(name)));
    delete headers["sec-websocket-extensions"];headers.connection="Upgrade";headers.upgrade="websocket";
    const upstream=httpRequest({hostname:"127.0.0.1",port:apiPort,path:req.url,headers});
    socket.on("error",()=>upstream.destroy());
    upstream.on("error",()=>{if(!socket.destroyed)reject(502);});
    upstream.on("response",response=>{response.resume();reject(response.statusCode===403?403:502);});
    upstream.on("upgrade",(response,remote,remoteHead)=>{
      if(!isAvailable()){remote.destroy();reject(503);return;}
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
export async function startLocalRuntime(environment = process.env, privateWorkspace, privateOwner, privateHayes, privateProbe) {
  const transfer={started:false,hayesStarted:false};
  if(privateHayes&&environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD===environment.EXHIBITOS_NATIVE_OWNER_FD){closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_OWNER_FD);transfer.started=true;transfer.hayesStarted=true;throw Error('NATIVE_OWNER_UNAVAILABLE');}
  if(!privateOwner&&environment.EXHIBITOS_AUTHORING_MODE==='personal'&&environment.EXHIBITOS_RUNTIME_MODE==='native'&&environment.EXHIBITOS_NATIVE_OWNER_FD!==undefined){closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_OWNER_FD);transfer.started=true;}
  try{if(privateHayes&&(!privateOwner||privateHayes.runtimeGeneration!==privateOwner.runtimeGeneration||privateHayes.secret===privateOwner.secret||environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD===environment.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD))throw Error('HAYES_OWNER_UNAVAILABLE');return await startLocalRuntimeInner(environment,privateWorkspace,privateOwner,privateHayes,transfer,privateProbe);}
  finally{if(!transfer.started&&(privateOwner||environment.EXHIBITOS_AUTHORING_MODE==='personal'&&environment.EXHIBITOS_RUNTIME_MODE==='native'&&environment.EXHIBITOS_NATIVE_OWNER_FD!==undefined))closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_OWNER_FD);if(!transfer.hayesStarted&&environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD!==undefined)closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD);}
}
async function startLocalRuntimeInner(environment, privateWorkspace, privateOwner, privateHayes, transfer, privateProbe) {
  const { port, apiPort, proxyPort, proxyHost } = localRuntimeNetwork(environment);
  const personal = environment.EXHIBITOS_AUTHORING_MODE === "personal";
  const freshOexTest = privateOwner?.mode === 'fresh-oex-test-v1';
  const multimapSelected=privateOwner?.mode==='workspace-furnishing-040-selected-import-v7';
  const materialSelected=multimapSelected||privateOwner?.mode==='workspace-furnishing-039-selected-import-v7';
  const furnishingSelected=materialSelected||privateOwner?.mode==='workspace-furnishing-038-selected-import-v7';
  const furnishingMode=furnishingSelected||['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-039-to-040-upgrade-v1'].includes(privateOwner?.mode);
  const normalOexV7=privateOwner?.mode==='normal-oex-workspace-import-v7',normalOexV6=privateOwner?.mode==='normal-oex-workspace-import-v6'||normalOexV7,normalOexV5=privateOwner?.mode==='normal-oex-workspace-v5'||normalOexV6,normalOexV4=privateOwner?.mode==='normal-oex-028-v4'||normalOexV5,normalOexV3=privateOwner?.mode==='normal-oex-027-v3'||normalOexV4,normalOexV2=privateOwner?.mode==='normal-oex-027-v2'||normalOexV3,normalOex=privateOwner?.mode==='normal-oex-v1'||normalOexV2,selectedOex=freshOexTest||normalOex,selectedPhase=selectedOex||furnishingSelected;
  if((selectedOex||furnishingMode)&&(!personal||environment.EXHIBITOS_RUNTIME_MODE!=='native'))throw Error('LOCAL_WORKSPACE_CONFIGURATION_INVALID');
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
  let app, proxy, ownerChannel, hayesChannel, nativeHayesCaller, shutdown, selectedTask, writerLease, ordinaryAdmission, ordinaryStop, pinnedPayload, ownerStopped=false, runtimeReady=false, terminalFailure=false, stage = "MIGRATIONS", timer, running, closed, apiListening, proxyListening, proxyCreation, payloadAcquisition, deferredWork;let stopping=false;const ownerAbort=new AbortController(),hayesAbort=new AbortController();
  // This handshake is optional and grants no import authority. Legacy startup
  // must not wait for or depend on it; failure only leaves it unavailable.
  let ownerTask=Promise.resolve();
  if(personal&&privateOwner&&environment.EXHIBITOS_RUNTIME_MODE==='native'){transfer.started=true;ownerTask=openNativeOwnerChannel(environment.EXHIBITOS_NATIVE_OWNER_FD,privateWorkspace,privateOwner,ownerAbort.signal).then(async channel=>{if(ownerStopped)await channel.close();else ownerChannel=channel;}).catch(()=>{});}
  else if(privateOwner){closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_OWNER_FD);transfer.started=true;}
  let hayesTask=Promise.resolve();
  if(personal&&privateOwner&&privateHayes&&environment.EXHIBITOS_RUNTIME_MODE==='native'){transfer.hayesStarted=true;hayesTask=openHayesOwnerChannel(environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD,privateWorkspace,privateHayes,hayesAbort.signal).then(async channel=>{if(ownerStopped)await channel.close();else hayesChannel=channel;}).catch(()=>{});}
  else if(environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD!==undefined){closeNativeOwnerDescriptor(environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD);transfer.hayesStarted=true;}
  const close = (normalStop=false) => closed ??= (async () => {
    stopping=true;runtimeReady=false;ownerStopped=true;if(!normalStop)ownerAbort.abort();let failed=false;
    const attempt=async action=>{try{await action();}catch{failed=true;}};
    await attempt(()=>ownerTask);hayesAbort.abort();await attempt(()=>hayesTask);if(nativeHayesCaller)await attempt(()=>nativeHayesCaller.close());if(hayesChannel)await attempt(()=>hayesChannel.close());if(!normalStop&&ownerChannel)await attempt(()=>ownerChannel.close());clearTimeout(timer);
    if(payloadAcquisition)await payloadAcquisition.catch(()=>{});if(proxyCreation)await proxyCreation.catch(()=>{});if(apiListening)await apiListening.catch(()=>{});if(proxyListening)await proxyListening.catch(()=>{});if(deferredWork)await deferredWork.catch(()=>{});
    if(proxy){await attempt(()=>proxy.closeUpgradedConnections());await attempt(()=>proxy.closeAllConnections());if(proxy.listening)await attempt(()=>new Promise((resolve,reject)=>proxy.close(error=>error?reject(error):resolve())));}
    await attempt(()=>running);if(selectedTask)await selectedTask.catch(()=>{});if(app)await attempt(()=>app.close());await attempt(()=>pool.end());
    if(normalStop&&!failed&&!terminalFailure){await attempt(()=>finalizeFurnishingOrdinaryStop(ordinaryStop,async()=>{if(pinnedPayload){await pinnedPayload.close();pinnedPayload=undefined;}},()=>terminalFailure));}else if(normalStop)failed=true;
    if(pinnedPayload)await attempt(()=>pinnedPayload.close());ordinaryStop?.dispose();ownerAbort.abort();if(ownerChannel)await attempt(()=>ownerChannel.close());if(failed)throw Error('LOCAL_RUNTIME_CLOSE_FAILED');
  })();
  shutdown=close;
  try {
    // Either selected schema applies only to a genuinely empty DB in the
    // same authenticated native owner session, before listening.
    let supplementalMigrationDirectory=selectedOex?fileURLToPath(new URL(normalOex?'../database/native-oex-normal/':'../database/fresh-oex-test/',import.meta.url)):undefined;
    const workspaceCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceMaterialCapability(fileURLToPath(new URL('./native-workspace-material-capability-v5.json',import.meta.url))):false;
    const workspaceImportCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceImportCapability(fileURLToPath(new URL('./native-workspace-oex-import-capability-v6.json',import.meta.url))):false;
    const workspaceImportDirectory=workspaceImportCapability?fileURLToPath(new URL('../database/native-oex-workspace-import/',import.meta.url)):undefined;
    const workspaceWallImportCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceWallImportCapability(fileURLToPath(new URL('./native-workspace-oex-import-capability-v7.json',import.meta.url))):false;
    const workspaceWallImportDirectory=workspaceWallImportCapability?fileURLToPath(new URL('../database/native-oex-workspace-import-wall/',import.meta.url)):undefined;
    const workspaceFurnishingCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingCapability(fileURLToPath(new URL('./native-workspace-furnishing-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingDirectory=workspaceFurnishingCapability?fileURLToPath(new URL('../database/native-workspace-furnishing/',import.meta.url)):undefined;
    const workspaceFurnishingWriterCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingWriterCapability(fileURLToPath(new URL('./native-workspace-furnishing-writer-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingWriterDirectory=workspaceFurnishingWriterCapability?fileURLToPath(new URL('../database/native-workspace-furnishing-writer/',import.meta.url)):undefined;
    const workspaceFurnishingPublicationCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingPublicationCapability(fileURLToPath(new URL('./native-workspace-furnishing-publication-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingPublicationDirectory=workspaceFurnishingPublicationCapability?fileURLToPath(new URL('../database/native-workspace-furnishing-publication/',import.meta.url)):undefined;
    const workspaceMaterialPublicationCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceMaterialPublicationCapability(fileURLToPath(new URL('./native-workspace-material-publication-capability-v1.json',import.meta.url))):false;
    const workspaceMaterialPublicationDirectory=workspaceMaterialPublicationCapability?fileURLToPath(new URL('../database/native-workspace-material-publication/',import.meta.url)):undefined;
    const workspaceMaterialMultimapCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceMaterialMultimapCapability(fileURLToPath(new URL('./native-workspace-material-multimap-capability-v1.json',import.meta.url))):false;
    const workspaceMaterialMultimapDirectory=workspaceMaterialMultimapCapability?fileURLToPath(new URL('../database/native-workspace-material-multimap/',import.meta.url)):undefined;
    const workspaceFurnishingStoolCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingStoolCapability(fileURLToPath(new URL('./native-workspace-furnishing-stool-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingRoomVisualCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingRoomVisualCapability(fileURLToPath(new URL('./native-workspace-furnishing-room-visual-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingArtworkFrameCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingArtworkFrameCapability(fileURLToPath(new URL('./native-workspace-furnishing-artwork-frame-capability-v1.json',import.meta.url))):false;
    const workspaceFurnishingArtworkFrameModelsCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFurnishingArtworkFrameModelsCapability(fileURLToPath(new URL('./native-workspace-furnishing-artwork-frame-models-capability-v1.json',import.meta.url))):false;
    const workspacePortalFinishCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspacePortalFinishCapability(fileURLToPath(new URL('./native-workspace-portal-finish-capability-v1.json',import.meta.url))):false;
    if(workspacePortalFinishCapability&&(!workspaceFurnishingArtworkFrameModelsCapability||!furnishingMode))throw Error('NATIVE_OEX_CATALOG');
    const workspaceFramePreparationCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasWorkspaceFramePreparationCapability(fileURLToPath(new URL('./native-workspace-frame-preparation-capability-v1.json',import.meta.url))):false;
    const workspaceFramePreparationDirectory=workspaceFramePreparationCapability?fileURLToPath(new URL('../database/native-workspace-frame-preparation/',import.meta.url)):undefined;
    if(workspaceFramePreparationCapability&&(!workspaceFurnishingArtworkFrameModelsCapability||!furnishingMode||furnishingSelected||privateOwner?.mode==='workspace-furnishing-039-to-040-upgrade-v1'))throw Error('NATIVE_OEX_CATALOG');
    const hayesOriginalCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasHayesOriginalCapability(fileURLToPath(new URL('./native-hayes-original-capability-v1.json',import.meta.url))):false;
    const hayesOriginalDirectory=hayesOriginalCapability?fileURLToPath(new URL('../database/native-hayes-original/',import.meta.url)):undefined;
    const hayesDispositionCapability=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'?await hasHayesDispositionCapability(fileURLToPath(new URL('./native-hayes-disposition-capability-v1.json',import.meta.url))):false;
    const hayesDispositionDirectory=hayesDispositionCapability?fileURLToPath(new URL('../database/native-hayes-disposition/',import.meta.url)):undefined;
    if(hayesDispositionCapability&&!hayesOriginalCapability)throw Error('NATIVE_OEX_CATALOG');
    if(hayesOriginalCapability&&(!workspaceFramePreparationCapability||!furnishingMode||furnishingSelected||privateOwner?.mode==='workspace-furnishing-039-to-040-upgrade-v1'))throw Error('NATIVE_OEX_CATALOG');
    await hayesTask;if(hayesOriginalCapability!==!!privateHayes||hayesOriginalCapability&&(!hayesChannel?.isOpen()||environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD===environment.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD))throw Error('HAYES_OWNER_UNAVAILABLE');
    if(hayesOriginalCapability)void hayesChannel.whenClosed().then(()=>{hayesAbort.abort();if(!runtimeReady&&!ownerStopped){ownerStopped=true;ownerAbort.abort();if(shutdown)void shutdown().catch(()=>{process.exitCode=1;});}});
    if(workspaceFurnishingArtworkFrameModelsCapability&&!workspaceFurnishingArtworkFrameCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingArtworkFrameCapability&&!workspaceFurnishingRoomVisualCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingRoomVisualCapability&&!workspaceFurnishingStoolCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingStoolCapability&&(!workspaceMaterialMultimapCapability||!furnishingMode))throw Error('NATIVE_OEX_CATALOG');
    if(workspaceMaterialMultimapCapability&&!workspaceMaterialPublicationCapability||multimapSelected&&!workspaceMaterialMultimapCapability||furnishingSelected&&!multimapSelected&&workspaceMaterialMultimapCapability||workspaceMaterialPublicationCapability&&!workspaceFurnishingPublicationCapability||materialSelected&&!workspaceMaterialPublicationCapability||furnishingSelected&&!materialSelected&&workspaceMaterialPublicationCapability)throw Error('NATIVE_OEX_CATALOG');
    if(furnishingSelected&&!workspaceFurnishingPublicationCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingPublicationCapability&&(!furnishingMode||!workspaceFurnishingWriterCapability))throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingWriterCapability&&!workspaceFurnishingCapability||furnishingMode&&!workspaceFurnishingWriterCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceFurnishingCapability&&!workspaceWallImportCapability||furnishingMode&&!workspaceFurnishingCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceWallImportCapability&&!workspaceImportCapability||normalOexV7&&!workspaceWallImportCapability)throw Error('NATIVE_OEX_CATALOG');
    if(workspaceImportCapability&&!workspaceCapability||normalOexV6&&!workspaceImportCapability)throw Error('NATIVE_OEX_CATALOG');
    if(normalOexV5&&!workspaceCapability)throw Error('NATIVE_OEX_CATALOG');
    const normalMigration=normalOex?await verifyNormalOexMigration(supplementalMigrationDirectory):undefined;
    const provenanceMigration=normalOexV2?await verifyNormalOexProvenanceMigration(supplementalMigrationDirectory):undefined;
    const materialMigration=normalOexV4?await verifyNormalOexMaterialMigration(supplementalMigrationDirectory):undefined;
    const floorMigration=normalOexV4?await verifyNormalOexFloorMigration(supplementalMigrationDirectory):undefined;
    const concreteMigration=normalOexV4?await verifyNormalOexConcreteMigration(supplementalMigrationDirectory):undefined;
    const workspaceMigrations=normalOexV5?await verifyWorkspaceMaterialMigrations(supplementalMigrationDirectory):undefined;
    const workspaceImportMigrations=normalOexV6?await verifyWorkspaceImportMigrations(workspaceImportDirectory):undefined;
    const workspaceWallImportMigration=normalOexV7?await verifyWorkspaceWallImportMigration(workspaceWallImportDirectory):undefined;
    if(selectedOex){
      stage='OWNER_CHANNEL';await ownerTask;if(!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
      void ownerChannel.whenClosed().then(()=>{if(!ownerStopped){ownerStopped=true;ownerAbort.abort();if(shutdown)void shutdown().catch(()=>{process.exitCode=1;console.error('Native owner shutdown failed.');});}});stage='FRESH_DATABASE';
      await transaction(pool,async c=>{
        if(normalOexV6)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await c.query('SELECT pg_advisory_xact_lock(82001)');
        const check=await c.query("SELECT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (n.nspname<>'public' OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','S','f')) OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace=n.oid) OR EXISTS(SELECT 1 FROM pg_type t WHERE t.typnamespace=n.oid AND t.typtype IN ('e','d','c')))) AS occupied");
        if(check.rows[0]?.occupied!==false||!ownerChannel?.isOpen())throw Error('FRESH_DATABASE_OCCUPIED');
        await migrateInTransaction(c,migrationDirectory);if(normalOex){await c.query(normalMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256]);if(normalOexV2){await c.query(provenanceMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256]);if(normalOexV4){await c.query(materialMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256]);await c.query(floorMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256]);await c.query(concreteMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256]);if(normalOexV5){await c.query(workspaceMigrations[0]);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256]);await c.query(workspaceMigrations[1]);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]);if(normalOexV6){await c.query(workspaceImportMigrations[0]);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256]);await c.query(workspaceImportMigrations[1]);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]);if(normalOexV7){await c.query(workspaceWallImportMigration);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256]);}}}}}}else await migrateInTransaction(c,supplementalMigrationDirectory);if(normalOexV6&&!await preflightNormalOexCatalog(c,migrationDirectory,supplementalMigrationDirectory,{allowWorkspaceMaterial:true,workspaceImportDirectory,workspaceWallImportDirectory}))throw Error('NATIVE_OEX_CATALOG');if(!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
      });
    }else if(furnishingMode){
      stage='OWNER_CHANNEL';await ownerTask;if(!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
      void ownerChannel.whenClosed().then(()=>{if(!ownerStopped){ownerStopped=true;ownerAbort.abort();if(shutdown)void shutdown().catch(()=>{process.exitCode=1;console.error('Native owner shutdown failed.');});}});
      stage='WRITER_LEASE';payloadAcquisition=pinNativeOexPayloadManifest(fileURLToPath(new URL('../../manifest.json',import.meta.url))).then(value=>{pinnedPayload=value;return value;});await payloadAcquisition;if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
      writerLease=await acceptFurnishingWriterLease({channel:ownerChannel,secret:Buffer.from(privateOwner.secret,'hex'),scope:{workspaceId:privateWorkspace.workspaceId,tenantId:privateWorkspace.tenantId,principalId:privateWorkspace.principalId,runtimeGeneration:privateOwner.runtimeGeneration,mode:privateOwner.mode},payload:pinnedPayload,writerFd:environment.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD,ownerFd:environment.EXHIBITOS_NATIVE_OWNER_FD,blobRoot,configRoot});
      const markerPath='platform/scripts/native-workspace-furnishing-publication-capability-v1.json',migrationPath='platform/database/native-workspace-furnishing-publication/'+WORKSPACE_FURNISHING_PUBLICATION_MIGRATION;
      if(workspaceFurnishingPublicationCapability?(!pinnedPayload.hasExact(markerPath,'968dec2c1d4312b3e8a50194fa13d961c3bfb47ec4df17800f94e353a682daf3',Buffer.byteLength(WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY))||!pinnedPayload.hasExact(migrationPath,WORKSPACE_FURNISHING_PUBLICATION_SHA256,1032)):(pinnedPayload.hasPath(markerPath)||pinnedPayload.hasPath(migrationPath)))throw Error('NATIVE_OEX_CATALOG');
      if(workspaceMaterialPublicationCapability&&(!pinnedPayload.hasExact('platform/scripts/native-workspace-material-publication-capability-v1.json','c93117acc9cc397cb978bcb5d4bbc5732699af983f2f3c0413e9b4205455339c',163)||!pinnedPayload.hasExact('platform/database/native-workspace-material-publication/'+WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,1011)))throw Error('NATIVE_OEX_CATALOG');
      const multimapMarker='platform/scripts/native-workspace-material-multimap-capability-v1.json',multimapMigration='platform/database/native-workspace-material-multimap/'+WORKSPACE_MATERIAL_MULTIMAP_MIGRATION;
      if(workspaceMaterialMultimapCapability?(!pinnedPayload.hasExact(multimapMarker,'14203083f3e9e735bba46a5dcc436c3f797aea168e5c91f428f28c134c1b3f84',Buffer.byteLength(WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY))||!pinnedPayload.hasExact(multimapMigration,WORKSPACE_MATERIAL_MULTIMAP_SHA256,5544)):(pinnedPayload.hasPath(multimapMarker)||pinnedPayload.hasPath(multimapMigration)))throw Error('NATIVE_OEX_CATALOG');
      const stoolMarker='platform/scripts/native-workspace-furnishing-stool-capability-v1.json';
      if(workspaceFurnishingStoolCapability?(!pinnedPayload.hasExact(stoolMarker,'9e4928cb47fc6e0c682e35e71d3fc2566de965d7e547f42300fe35e08b4bda2f',Buffer.byteLength(WORKSPACE_FURNISHING_STOOL_CAPABILITY))||!pinnedPayload.hasExact('platform/vendor/exhibitos-spec-0.1.0-draft.19.tgz','80b9bc637e89b6d2850a17e439af748ccde0c9b98344e3cc496eb0f793a292b5',166490)):pinnedPayload.hasPath(stoolMarker))throw Error('NATIVE_OEX_CATALOG');
      const frameMarker='platform/scripts/native-workspace-furnishing-artwork-frame-capability-v1.json';
      if(workspaceFurnishingArtworkFrameCapability?(!pinnedPayload.hasExact(frameMarker,'a3cacedee625c6111b4c92f766f07e1caf770afeb61f534550cbfe0f42d83e9b',Buffer.byteLength(WORKSPACE_FURNISHING_ARTWORK_FRAME_CAPABILITY))||!pinnedPayload.hasExact('platform/vendor/exhibitos-spec-0.1.0-draft.21.tgz','b25a30d4c724304e547152c835ca7f43940e9e74478413c0986c330792de9353',169605)):pinnedPayload.hasPath(frameMarker))throw Error('NATIVE_OEX_CATALOG');
      const frameModelsMarker='platform/scripts/native-workspace-furnishing-artwork-frame-models-capability-v1.json';
      if(workspaceFurnishingArtworkFrameModelsCapability?(!pinnedPayload.hasExact(frameModelsMarker,'f823a2ebc598e81c8a0fc996e3b9108546a31338f21173be575ee7fb0dc0c0a2',Buffer.byteLength(WORKSPACE_FURNISHING_ARTWORK_FRAME_MODELS_CAPABILITY))||!pinnedPayload.hasExact('platform/vendor/exhibitos-spec-0.1.0-draft.26.tgz','9ea61a721a9919c6e0d0a15574e994fb820b7bb6db4fd9458b38bcda39bd8a10',175159)):pinnedPayload.hasPath(frameModelsMarker))throw Error('NATIVE_OEX_CATALOG');
      const portalMarker='platform/scripts/native-workspace-portal-finish-capability-v1.json';
      if(workspacePortalFinishCapability?!pinnedPayload.hasExact(portalMarker,'6a7e94ccd178ec05d57a120d77de28d7fcc6fb54f2069c18ead5beb52cd9aebc',Buffer.byteLength(WORKSPACE_PORTAL_FINISH_CAPABILITY)):pinnedPayload.hasPath(portalMarker))throw Error('NATIVE_OEX_CATALOG');
      const framePreparationMarker='platform/scripts/native-workspace-frame-preparation-capability-v1.json',framePreparationMigration='platform/database/native-workspace-frame-preparation/'+WORKSPACE_FRAME_PREPARATION_MIGRATION;
      if(workspaceFramePreparationCapability?(!pinnedPayload.hasExact(framePreparationMarker,'c1fe667c80a3b36ddb124fddb5ce427131bae3018c47ecfce7238be556955f92',Buffer.byteLength(WORKSPACE_FRAME_PREPARATION_CAPABILITY))||!pinnedPayload.hasExact(framePreparationMigration,WORKSPACE_FRAME_PREPARATION_SHA256,4199)):(pinnedPayload.hasPath(framePreparationMarker)||pinnedPayload.hasPath(framePreparationMigration)))throw Error('NATIVE_OEX_CATALOG');
      if(hayesOriginalCapability&&privateHayes.runtimeManifestSha256!==pinnedPayload.digest)throw Error('HAYES_OWNER_UNAVAILABLE');
      const hayesMarker='platform/scripts/native-hayes-original-capability-v1.json',hayesMigration='platform/database/native-hayes-original/'+HAYES_ORIGINAL_MIGRATION;
      if(hayesOriginalCapability?(!pinnedPayload.hasExact(hayesMarker,'89bcf960b415e5601cdf345be7c763975744f3d6e45f6772a90d8d1a0f991762',Buffer.byteLength(HAYES_ORIGINAL_CAPABILITY))||!pinnedPayload.hasExact(hayesMigration,HAYES_ORIGINAL_SHA256,3617)):(pinnedPayload.hasPath(hayesMarker)||pinnedPayload.hasPath(hayesMigration)))throw Error('NATIVE_OEX_CATALOG');
      const dispositionMarker='platform/scripts/native-hayes-disposition-capability-v1.json',dispositionMigration='platform/database/native-hayes-disposition/'+HAYES_DISPOSITION_MIGRATION;
      if(hayesDispositionCapability?(!pinnedPayload.hasExact(dispositionMarker,'5815c26a4439aa868f1e7ff012a6aa3b79ecbf35e3824e35e6af7a525b69f098',Buffer.byteLength(HAYES_DISPOSITION_CAPABILITY))||!pinnedPayload.hasExact(dispositionMigration,HAYES_DISPOSITION_SHA256,11581)):(pinnedPayload.hasPath(dispositionMarker)||pinnedPayload.hasPath(dispositionMigration)))throw Error('NATIVE_OEX_CATALOG');
      const roomVisualMarker='platform/scripts/native-workspace-furnishing-room-visual-capability-v1.json';
      if(workspaceFurnishingRoomVisualCapability?(!pinnedPayload.hasExact(roomVisualMarker,'c7aaa7eabadac0d7b99d7ff194402f53bf90a76f694b5a42a9f868651bdac32b',Buffer.byteLength(WORKSPACE_FURNISHING_ROOM_VISUAL_CAPABILITY))||!pinnedPayload.hasExact('platform/vendor/exhibitos-spec-0.1.0-draft.20.tgz','3013ccbc30af582698a21e14181fc3ee51880e4eb7aede690d235126ac16665b',167439)):pinnedPayload.hasPath(roomVisualMarker))throw Error('NATIVE_OEX_CATALOG');
      if(furnishingSelected&&!materialSelected&&!pinnedPayload.hasExact('platform/scripts/native-workspace-furnishing-selected-oex-v1.json','2792fac7aba1e053a9a43849e2899ad27e447be9fc58114f316a8a4c9d23d0ce',209)||materialSelected&&!multimapSelected&&(!pinnedPayload.hasExact('platform/scripts/native-workspace-furnishing-selected-oex-039-v1.json','4bded824d2c2eaab8be1f165903ed79b08f5182bb873065c9934226e135e6225',209)||pinnedPayload.hasPath('platform/scripts/native-workspace-furnishing-selected-oex-v1.json'))||multimapSelected&&(!pinnedPayload.hasExact('platform/scripts/native-workspace-furnishing-selected-oex-040-v1.json','08eddd08e0a17921a0cc4ac733258b70580e400ced004a582dac3d057a22a979',209)||pinnedPayload.hasPath('platform/scripts/native-workspace-furnishing-selected-oex-v1.json')||pinnedPayload.hasPath('platform/scripts/native-workspace-furnishing-selected-oex-039-v1.json')))throw Error('NATIVE_OEX_CATALOG');
      await pinnedPayload.verify();await writerLease.assertLive();
      ordinaryAdmission=await acceptFurnishingOrdinaryAdmission({writer:writerLease,channel:ownerChannel,secret:Buffer.from(privateOwner.secret,'hex')});await assertWorkspaceFurnishingRuntimeAdmission(privateOwner.mode,ordinaryAdmission);
      ordinaryStop=furnishingOrdinaryStopControl(ordinaryAdmission,ownerChannel,Buffer.from(privateOwner.secret,'hex'));
      supplementalMigrationDirectory=fileURLToPath(new URL('../database/native-oex-normal/',import.meta.url));
    }else if(personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'){
      const normalDirectory=fileURLToPath(new URL('../database/native-oex-normal/',import.meta.url));
      await transaction(pool,async c=>{if(workspaceImportCapability)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.query('SELECT pg_advisory_xact_lock(82001)');supplementalMigrationDirectory=await preflightNormalOexCatalog(c,migrationDirectory,normalDirectory,{allowWorkspaceMaterial:workspaceCapability,workspaceImportDirectory,workspaceWallImportDirectory});await migrateInTransaction(c,migrationDirectory);});
    }else await migrate(pool,migrationDirectory);
    stage = "BOOTSTRAP";
    if (personal) await openLocalWorkspace(pool, privateWorkspace, environment.EXHIBITOS_RUNTIME_MODE,furnishingMode?c=>prepareWorkspaceFurnishingCatalog(c,{mode:privateOwner.mode,base:migrationDirectory,normal:supplementalMigrationDirectory,imports:workspaceImportDirectory,wall:workspaceWallImportDirectory,furnishing:workspaceFurnishingDirectory,writerDirectory:workspaceFurnishingWriterDirectory,publicationDirectory:workspaceFurnishingPublicationDirectory,materialPublicationDirectory:workspaceMaterialPublicationDirectory,materialMultimapDirectory:workspaceMaterialMultimapDirectory,framePreparationDirectory:workspaceFramePreparationDirectory,hayesOriginalDirectory,hayesDispositionDirectory,ownerUid:privateWorkspace.ownerUid,writer:writerLease,channel:ownerChannel,ordinaryAdmission}):!selectedOex&&environment.EXHIBITOS_RUNTIME_MODE==='native'?async c=>{await c.query('SELECT pg_advisory_xact_lock(82001)');supplementalMigrationDirectory=await preflightNormalOexCatalog(c,migrationDirectory,fileURLToPath(new URL('../database/native-oex-normal/',import.meta.url)),{allowWorkspaceMaterial:workspaceCapability,workspaceImportDirectory,workspaceWallImportDirectory});}:undefined,workspaceImportCapability?{isolation:'read committed',...(['workspace-furnishing-036-reopen-v1','workspace-furnishing-039-to-040-upgrade-v1'].includes(privateOwner?.mode)?{requireExisting:true}:{}),...(furnishingMode?{furnishingExclusive:true,beforeCommit:c=>assertFurnishingBeforeCommit(c,{mode:privateOwner.mode,ordinaryAdmission,writer:writerLease,channel:ownerChannel,isStopped:()=>ownerStopped||hayesOriginalCapability&&(hayesAbort.signal.aborted||!hayesChannel?.isOpen()),framePreparation:workspaceFramePreparationCapability,hayesOriginal:hayesOriginalCapability,hayesDisposition:hayesDispositionCapability})}:{})}:undefined);
    else {
      if ((await pool.query("SELECT 1 FROM local_workspaces LIMIT 1")).rowCount) throw Error("LOCAL_WORKSPACE_ACCOUNT_MODE_REFUSED");
      if (!(await pool.query("SELECT 1 FROM auth_credentials LIMIT 1")).rowCount) await bootstrap(pool, environment.TENANT_ID, environment.ADMIN_SUBJECT, environment.ADMIN_PASSWORD);
    }
    if((selectedOex||furnishingMode)&&!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
    stage = "STORAGE"; await mkdir(blobRoot, { recursive: true, mode: 0o700 });
    stage = "SIGNING_KEY";
    const keyFile = await signingKey(configRoot), freeze = await loadFreezeConfig({ runtimeRoot: webRoot, signingKeyFile: keyFile, origin });
    stage = "API"; const blobs = new FileBlobStore(blobRoot);
    let supplementalMigrationNames,workspaceImportApplied=false,workspaceWallImportApplied=false;
    if(supplementalMigrationDirectory&&!freshOexTest){const rows=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;const provenance=rows.find(row=>row.name===NORMAL_OEX_PROVENANCE_MIGRATION);if(provenance&&provenance.sha256!==NORMAL_OEX_PROVENANCE_SHA256)throw Error('NATIVE_OEX_CATALOG');const material=rows.find(row=>row.name===NORMAL_OEX_MATERIAL_MIGRATION);if(material&&(!provenance||material.sha256!==NORMAL_OEX_MATERIAL_SHA256))throw Error('NATIVE_OEX_CATALOG');const floor=rows.find(row=>row.name===NORMAL_OEX_FLOOR_MIGRATION);if(floor&&(!material||floor.sha256!==NORMAL_OEX_FLOOR_SHA256))throw Error('NATIVE_OEX_CATALOG');const concrete=rows.find(row=>row.name===NORMAL_OEX_CONCRETE_MIGRATION);if(concrete&&(!floor||concrete.sha256!==NORMAL_OEX_CONCRETE_SHA256))throw Error('NATIVE_OEX_CATALOG');const intake=rows.find(row=>row.name===WORKSPACE_MATERIAL_MIGRATION),workspaceOex=rows.find(row=>row.name===WORKSPACE_MATERIAL_OEX_MIGRATION);if(!!intake!==!!workspaceOex||intake&&(!concrete||!workspaceCapability||intake.sha256!==WORKSPACE_MATERIAL_SHA256||workspaceOex.sha256!==WORKSPACE_MATERIAL_OEX_SHA256))throw Error('NATIVE_OEX_CATALOG');const importStage=rows.find(row=>row.name===WORKSPACE_IMPORT_STAGE_MIGRATION),importProof=rows.find(row=>row.name===WORKSPACE_IMPORT_PROOF_MIGRATION);if(!!importStage!==!!importProof||importStage&&(!workspaceImportCapability||!intake||importStage.sha256!==WORKSPACE_IMPORT_STAGE_SHA256||importProof.sha256!==WORKSPACE_IMPORT_PROOF_SHA256))throw Error('NATIVE_OEX_CATALOG');if(importStage)await verifyWorkspaceImportMigrations(workspaceImportDirectory);workspaceImportApplied=!!importStage;const wall=rows.find(row=>row.name===WORKSPACE_WALL_IMPORT_MIGRATION);if(wall&&(!workspaceWallImportCapability||!importStage||wall.sha256!==WORKSPACE_WALL_IMPORT_SHA256))throw Error('NATIVE_OEX_CATALOG');if(wall)await verifyWorkspaceWallImportMigration(workspaceWallImportDirectory);workspaceWallImportApplied=!!wall;supplementalMigrationNames=[NORMAL_OEX_MIGRATION,...(provenance?[NORMAL_OEX_PROVENANCE_MIGRATION]:[]),...(material?[NORMAL_OEX_MATERIAL_MIGRATION]:[]),...(floor?[NORMAL_OEX_FLOOR_MIGRATION]:[]),...(concrete?[NORMAL_OEX_CONCRETE_MIGRATION]:[]),...(intake?[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_OEX_MIGRATION]:[])];}
    if(furnishingMode){const rows=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;if(rows.length!==(hayesDispositionCapability?43:hayesOriginalCapability?42:workspaceFramePreparationCapability?41:workspaceMaterialMultimapCapability?40:workspaceMaterialPublicationCapability?39:workspaceFurnishingPublicationCapability?38:37)||rows[35]?.name!==WORKSPACE_FURNISHING_MIGRATION||rows[35]?.sha256!==WORKSPACE_FURNISHING_SHA256||rows[36]?.name!==WORKSPACE_FURNISHING_WRITER_MIGRATION||rows[36]?.sha256!==WORKSPACE_FURNISHING_WRITER_SHA256||!workspaceWallImportApplied||!ownerChannel?.isOpen())throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceFurnishingMigration(workspaceFurnishingDirectory);await verifyWorkspaceFurnishingWriterMigration(workspaceFurnishingWriterDirectory);if(workspaceFurnishingPublicationCapability){if(rows[37]?.name!==WORKSPACE_FURNISHING_PUBLICATION_MIGRATION||rows[37]?.sha256!==WORKSPACE_FURNISHING_PUBLICATION_SHA256)throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceFurnishingPublicationMigration(workspaceFurnishingPublicationDirectory);}}
    assertWorkspaceImportOwnerMode(privateOwner?.mode,workspaceWallImportApplied);
    if(normalOexV2&&(!ownerChannel?.isOpen()||!supplementalMigrationNames?.includes(NORMAL_OEX_PROVENANCE_MIGRATION)))throw Error('NATIVE_OEX_CATALOG');
    if(normalOexV4&&(!supplementalMigrationNames?.includes(NORMAL_OEX_FLOOR_MIGRATION)||!supplementalMigrationNames?.includes(NORMAL_OEX_CONCRETE_MIGRATION)))throw Error('NATIVE_OEX_CATALOG');
    const nativeOexWorkspace=personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'&&supplementalMigrationNames?.includes(NORMAL_OEX_PROVENANCE_MIGRATION)?await transaction(pool,async c=>{
      if(workspaceImportCapability)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await c.query('SELECT pg_advisory_xact_lock(82001)');
      if((normalOexV2||furnishingMode)&&!ownerChannel?.isOpen()||!await preflightNormalOexCatalog(c,migrationDirectory,supplementalMigrationDirectory,{allowWorkspaceMaterial:workspaceCapability,workspaceImportDirectory,workspaceWallImportDirectory,...(furnishingMode?{workspaceFurnishingDirectory,workspaceFurnishingWriterDirectory,...(workspaceFurnishingPublicationCapability?{workspaceFurnishingPublicationDirectory}:{}) ,...(workspaceMaterialPublicationCapability?{workspaceMaterialPublicationDirectory}:{}),...(workspaceMaterialMultimapCapability?{workspaceMaterialMultimapDirectory}:{}),...(workspaceFramePreparationCapability?{workspaceFramePreparationDirectory}:{}),...(hayesOriginalCapability?{hayesOriginalDirectory}:{}),...(hayesDispositionCapability?{hayesDispositionDirectory}:{})}:{})}))throw Error('NATIVE_OEX_CATALOG');
      const proof=ordinaryAdmission?.fields.restoreProof;
      const restoredProvenance=proof?{...proof,assertLive:async()=>{assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);if(ordinaryAdmission.writer!==writerLease||!ownerChannel?.isOpen())throw Error('FURNISHING_ADMISSION_INVALID');await writerLease.assertLive();}}:undefined;
      const context=await bindNativeOexWorkspace(c,{workspaceId:privateWorkspace.workspaceId,tenantId:privateWorkspace.tenantId,principalId:privateWorkspace.principalId,ownerUid:privateWorkspace.ownerUid,blobRoot,...(restoredProvenance?{restoredProvenance}:{}),...(workspaceImportApplied?{workspaceImport:true}:{}),...(workspaceWallImportApplied?{workspaceWallImport:true}:{}),...(furnishingMode?{workspaceFurnishing:true,workspaceFurnishingWriter:true,...(workspaceFurnishingPublicationCapability?{workspaceFurnishingPublication:true}:{}) ,...(workspaceMaterialPublicationCapability?{workspaceMaterialPublication:true}:{}),...(workspaceMaterialMultimapCapability?{workspaceMaterialMultimap:true}:{}),...(workspaceFurnishingStoolCapability&&!furnishingSelected?{workspaceFurnishingStool:true}:{}),...(workspaceFurnishingRoomVisualCapability&&!furnishingSelected?{workspaceFurnishingRoomVisual:true}:{}),...(workspaceFurnishingArtworkFrameCapability&&!furnishingSelected?{workspaceFurnishingArtworkFrame:true}:{}),...(workspaceFurnishingArtworkFrameModelsCapability&&!furnishingSelected?{workspaceFurnishingArtworkFrameModels:true}:{}),...(workspaceFramePreparationCapability?{workspaceArtworkFramePreparation:true}:{}),...(workspacePortalFinishCapability&&!furnishingSelected?{workspacePortalFinish:true}:{})}:{})});
      if(hayesOriginalCapability){if(hayesAbort.signal.aborted||!hayesChannel?.isOpen())throw Error('HAYES_OWNER_UNAVAILABLE');await bindHayesOriginalContext(c,context);if(hayesAbort.signal.aborted||!hayesChannel?.isOpen())throw Error('HAYES_OWNER_UNAVAILABLE');}
      if((normalOexV2||furnishingMode)&&!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');return context;
    }):undefined;
    if(normalOexV5&&(!nativeOexWorkspace?.workspaceMaterials||!workspaceCapability))throw Error('NATIVE_OEX_CATALOG');
    const workspaceMaterial=!selectedPhase&&workspaceCapability&&nativeOexWorkspace?.workspaceMaterials?new WorkspaceMaterialIntakes(blobs,nativeOexWorkspace,validateWorkspaceMaterial,...(workspaceMaterialPublicationCapability?[writerLease]:[])):undefined;
    if(furnishingMode&&!nativeOexWorkspace?.workspaceFurnishingWriter)throw Error('NATIVE_OEX_CATALOG');
    if(furnishingMode)await writerLease.assertLive();
    const workspaceFurnishing=furnishingMode&&!furnishingSelected?new WorkspaceFurnishingIntakes(blobs,nativeOexWorkspace,writerLease):undefined;
    const selectedWorkspaceMaterial=(normalOexV5||furnishingSelected)&&workspaceCapability&&nativeOexWorkspace?.workspaceMaterials?new WorkspaceMaterialIntakes(blobs,nativeOexWorkspace,validateWorkspaceMaterial):undefined;
    let nativeExportWorkspace;
    if(personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'&&!selectedPhase){
      try{nativeExportWorkspace=await transaction(pool,c=>bindNativeLocalExportWorkspace(c,{workspaceId:privateWorkspace.workspaceId,tenantId:privateWorkspace.tenantId,principalId:privateWorkspace.principalId,ownerUid:privateWorkspace.ownerUid,blobRoot}));}
      catch{console.warn('Native bounded file export is unavailable for this workspace.');}
    }
    const uploadSlot=selectedPhase?createSelectedNativeUploadSlot():undefined,saveSlot=selectedPhase?createSelectedStudioPutSlot():undefined;
    if((selectedOex||furnishingMode)&&(ownerStopped||!ownerChannel?.isOpen()))throw Error('NATIVE_OWNER_UNAVAILABLE');
    const isOwnerAvailable=()=>runtimeReady&&!ownerStopped&&!!ownerChannel?.isOpen(),deferredStartup=[];
    if(hayesOriginalCapability){if(!nativeOexWorkspace||!hayesChannel?.isOpen()||!pinnedPayload||!writerLease)throw Error('HAYES_OWNER_UNAVAILABLE');nativeHayesCaller=createNativeHayesCaller({owner:nativeOexWorkspace,auth:new Auth(pool),blobs,channel:hayesChannel,runtimeGeneration:privateHayes.runtimeGeneration,nativeOwnerId:privateHayes.nativeOwnerId,runtimeManifestSha256:privateHayes.runtimeManifestSha256,signal:hayesAbort.signal,...(privateProbe?{onClaimCommitted:privateProbe.onClaimCommitted,onProbePhase:privateProbe.onProbePhase}:{}),assertLive:async()=>{if(!isOwnerAvailable()||!hayesChannel?.isOpen()||!pinnedPayload||hayesAbort.signal.aborted)throw Error('HAYES_OWNER_UNAVAILABLE');await writerLease.assertLive();await pinnedPayload.verify();if(!isOwnerAvailable()||!hayesChannel?.isOpen()||!pinnedPayload||hayesAbort.signal.aborted)throw Error('HAYES_OWNER_UNAVAILABLE');}});}
    let nativeDetailContext;
    if(personal&&environment.EXHIBITOS_RUNTIME_MODE==='native'&&furnishingMode&&!selectedPhase&&privateOwner&&nativeExportWorkspace&&await hasNativeDetailCapability(fileURLToPath(new URL('./native-detail-static-export-capability-v1.json',import.meta.url)))){
      const marker='platform/scripts/native-detail-static-export-capability-v1.json';
      if(!ordinaryAdmission||!writerLease||!pinnedPayload||!pinnedPayload.hasRegular(marker)||!pinnedPayload.hasExact(marker,'9663e0fb346c78ebbd1b9e883bbd2400a1b968368d101102f0e0285c8e7deaef',Buffer.byteLength(NATIVE_DETAIL_CAPABILITY))||!hasNativeDetailRequiredFiles(pinnedPayload))throw Error('NATIVE_DETAIL_CONFIGURATION');
      await pinnedPayload.verify();await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
      nativeDetailContext=bindNativeDetailContext(nativeExportWorkspace,privateOwner.runtimeGeneration,ownerAbort.signal,isOwnerAvailable);
    }
    app = buildApp({ ...(furnishingMode?{runtimeAvailable:isOwnerAvailable,deferredStartup}:{}), pool, blobs, auth: config({ mode: "local", origin, bindHost: "127.0.0.1" }), freeze, oexWorker: !selectedPhase, ...(selectedPhase?{freshOexTest:true,uploadSlot,saveSlot}:{}),...(nativeOexWorkspace?{nativeOexWorkspace,...(!selectedPhase?{nativeBoundedEditing:true}:{})}:{}),...(nativeExportWorkspace?{nativeExportWorkspace}:{}),...(nativeDetailContext?{nativeDetailContext}:{}),...(nativeHayesCaller?{nativeHayesCaller}:{}),...(workspaceMaterial?{workspaceMaterial}:{}),...(workspaceFurnishing?{workspaceFurnishing}:{}),...(selectedWorkspaceMaterial?{selectedWorkspaceMaterial}:{}), lifecycle: { migrationDirectory, ...(supplementalMigrationDirectory?{supplementalMigrationDirectory,...(supplementalMigrationNames?{supplementalMigrationNames}:{})}:{}),...(workspaceImportApplied?{workspaceImportMigrationDirectory:workspaceImportDirectory}:{}),...(workspaceWallImportApplied?{workspaceWallImportMigrationDirectory:workspaceWallImportDirectory}:{}),...(furnishingMode?{workspaceFurnishingMigrationDirectory:workspaceFurnishingDirectory,workspaceFurnishingWriterMigrationDirectory:workspaceFurnishingWriterDirectory,...(workspaceFurnishingPublicationCapability?{workspaceFurnishingPublicationMigrationDirectory:workspaceFurnishingPublicationDirectory}:{}),...(workspaceMaterialPublicationCapability?{workspaceMaterialPublicationMigrationDirectory:workspaceMaterialPublicationDirectory}:{}),...(workspaceMaterialMultimapCapability?{workspaceMaterialMultimapMigrationDirectory:workspaceMaterialMultimapDirectory}:{}),...(workspaceFramePreparationCapability?{workspaceFramePreparationMigrationDirectory:workspaceFramePreparationDirectory}:{}),...(hayesOriginalCapability?{hayesOriginalMigrationDirectory:hayesOriginalDirectory}:{}),...(hayesDispositionCapability?{hayesDispositionMigrationDirectory:hayesDispositionDirectory}:{})}:{}), webRoot, blobRoot } });
    if(furnishingMode)app.addHook('onRequest',async(_request,reply)=>{try{if(!isOwnerAvailable())throw Error();await writerLease.assertLive();if(!isOwnerAvailable())throw Error();}catch{return reply.code(503).send({code:'NATIVE_OWNER_UNAVAILABLE'});}});
    if(furnishingMode){stage='API_PRELISTEN';await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');}
    if((selectedOex||furnishingMode)&&(ownerStopped||!ownerChannel?.isOpen()))throw Error('NATIVE_OWNER_UNAVAILABLE');
    apiListening=app.listen({ host: "127.0.0.1", port: apiPort });await apiListening;
    if(furnishingMode){await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');}
    stage = "WEB_PROXY"; proxyCreation=createLocalProxy({ webRoot, origin, apiPort, disableUpgrades:selectedPhase,...(furnishingMode?{isAvailable:isOwnerAvailable}:{}) }).then(value=>{proxy=value;return value;});await proxyCreation;if((selectedOex||furnishingMode)&&(ownerStopped||!ownerChannel?.isOpen()))throw Error('NATIVE_OWNER_UNAVAILABLE');
    if(furnishingMode){stage='PROXY_PRELISTEN';await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');}
    proxyListening=new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(proxyPort, proxyHost, resolve); });await proxyListening;
    if(furnishingMode){await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');}
    if((selectedOex||furnishingMode)&&(ownerStopped||!ownerChannel?.isOpen()))throw Error('NATIVE_OWNER_UNAVAILABLE');
    if(furnishingMode){deferredWork=(async()=>{for(const task of deferredStartup){await writerLease.assertLive();await task();await writerLease.assertLive();}})();await deferredWork;if(ownerStopped||!ownerChannel?.isOpen()||hayesOriginalCapability&&(hayesAbort.signal.aborted||!hayesChannel?.isOpen()))throw Error('NATIVE_OWNER_UNAVAILABLE');runtimeReady=true;}
    if(selectedPhase){
      selectedTask=runFreshNativeOexOwner({pool,databaseUrl:environment.DATABASE_URL,blobs,workspaceId:privateWorkspace.workspaceId,tenantId:privateWorkspace.tenantId,principalId:privateWorkspace.principalId,ownerUid:privateWorkspace.ownerUid,runtimeGeneration:privateOwner.runtimeGeneration,secret:Buffer.from(privateOwner.secret,'hex'),channel:ownerChannel,payloadManifestPath:fileURLToPath(new URL('../../manifest.json',import.meta.url)),uploadSlot,saveSlot,signal:ownerAbort.signal,...(nativeOexWorkspace?{nativeOexWorkspace,requireCatalogProof:true}:{}),...(selectedWorkspaceMaterial?{selectedWorkspaceMaterial}:{}),...((normalOexV3||furnishingSelected)?{variant:'v3'}:{}),...(furnishingSelected?{requiredArchiveFormat:'1.0.0-draft.12',verifyRuntime:async()=>{await writerLease.assertLive();if(ownerStopped||!ownerChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');},verifyCatalog:()=>transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(82001)');await (multimapSelected?assertExactWorkspaceMaterialMultimapCatalog(c):materialSelected?assertExactWorkspaceMaterialPublicationCatalog(c):assertExactWorkspacePublicationCatalog(c));if(!await preflightNormalOexCatalog(c,migrationDirectory,supplementalMigrationDirectory,{allowWorkspaceMaterial:true,workspaceImportDirectory,workspaceWallImportDirectory,workspaceFurnishingDirectory,workspaceFurnishingWriterDirectory,workspaceFurnishingPublicationDirectory,workspaceMaterialPublicationDirectory,workspaceMaterialMultimapDirectory}))throw Error('NATIVE_OEX_CATALOG');await (multimapSelected?assertExactWorkspaceMaterialMultimapCatalog(c):materialSelected?assertExactWorkspaceMaterialPublicationCatalog(c):assertExactWorkspacePublicationCatalog(c));})}:{})});
      void selectedTask.catch(()=>{});
    }
    if(furnishingMode){void (furnishingSelected?selectedTask:Promise.resolve()).then(()=>ordinaryStop.wait()).then(()=>{if(!ownerStopped)void close(true).catch(()=>{process.exitCode=1;console.error('Native owner shutdown failed.');});}).catch(()=>{if(!ownerStopped){ownerStopped=true;ownerAbort.abort();void close().catch(()=>{process.exitCode=1;});}});}
    if(privateProbe){if(!hayesOriginalCapability||!nativeHayesCaller||!hayesChannel?.isOpen()||!privateWorkspace||!privateHayes||typeof privateProbe.run!=='function'||typeof privateProbe.onClaimCommitted!=='function'||typeof privateProbe.onProbePhase!=='function')throw Error('HAYES_PROBE_UNAVAILABLE');void Promise.resolve().then(()=>privateProbe.run({caller:nativeHayesCaller,channel:hayesChannel,pool,blobs,owner:nativeOexWorkspace,workspace:privateWorkspace,hayes:privateHayes,signal:hayesAbort.signal,assertLive:async()=>{if(!isOwnerAvailable()||!hayesChannel?.isOpen()||!pinnedPayload||hayesAbort.signal.aborted)throw Error('HAYES_OWNER_UNAVAILABLE');await writerLease.assertLive();await pinnedPayload.verify();if(!isOwnerAvailable()||!hayesChannel?.isOpen()||!pinnedPayload||hayesAbort.signal.aborted)throw Error('HAYES_OWNER_UNAVAILABLE');}})).catch(()=>{console.error('HAYES_SESSION_PROBE_FAILED');process.exitCode=1;void close().catch(()=>{});});}
    const importer = new Imports(pool, blobs, nativeOexWorkspace); let failures = 0;
    const tick = async () => { try { await importer.work(); failures = 0; } catch { console.error("Local import worker failed; pending jobs remain recoverable."); if (++failures >= 5) { terminalFailure=true;runtimeReady=false;stopping = true; process.exitCode = 1; setImmediate(() => { void close(); }); } } finally { if (!stopping) { timer = setTimeout(() => { running = tick(); }, 1000); timer.unref(); } } };
    if(!selectedPhase)running = tick();
    if((selectedOex||furnishingMode)&&ownerStopped)throw Error('NATIVE_OWNER_UNAVAILABLE');
    return { app, proxy, pool, origin, close };
  } catch { await close().catch(()=>{}); throw Error(`LOCAL_RUNTIME_START_FAILED_${stage}`); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let handedOff=false;
  try { const received = process.env.EXHIBITOS_AUTHORING_MODE === "personal" ? unpackNativeOwnerInput(await readNativeWorkspaceChannel()) : {}; handedOff=true;const runtime = await startLocalRuntime(process.env, received.workspace, received.ownerChannel, received.hayesOwnerChannel); console.info("ExhibitOS local runtime started."); for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await runtime.close(); }); }
  catch (error) { if(!handedOff&&process.env.EXHIBITOS_AUTHORING_MODE==='personal'){closeNativeOwnerDescriptor(process.env.EXHIBITOS_NATIVE_OWNER_FD);if(process.env.EXHIBITOS_NATIVE_HAYES_OWNER_FD!==process.env.EXHIBITOS_NATIVE_OWNER_FD)closeNativeOwnerDescriptor(process.env.EXHIBITOS_NATIVE_HAYES_OWNER_FD);}console.error(/^LOCAL_[A-Z_]+$/.test(error.message) ? error.message : "LOCAL_RUNTIME_START_FAILED"); process.exitCode = 1; }
}
