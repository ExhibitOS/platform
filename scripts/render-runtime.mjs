// SPDX-License-Identifier: AGPL-3.0-or-later
import { Pool } from "pg";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { migrate, PostgresBlobStore } from "../packages/storage/dist/index.js";
import { bootstrap, config } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
import { createLocalProxy } from "./local-runtime.mjs";
import { createPagesPublicationSource } from "./pages-publication-source.mjs";

/** Check the same durable object table used by uploads. A SELECT alone also
 * succeeds on a read-only connection. The probe never commits an object and
 * does not promise that a larger upload will fit the remaining database quota. */
export async function checkHostedStorage(pool) {
  const client = await pool.connect();
  let destroy = false, failed = false, failure;
  try {
    await client.query({text:"BEGIN",query_timeout:2000});
    await client.query({text:"SET LOCAL statement_timeout = '2000ms'",query_timeout:2000});
    const name = `readiness/${randomUUID()}`;
    const bytes = Buffer.from("ExhibitOS storage readiness");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await client.query({text:"INSERT INTO hosted_objects(object_key,bytes,sha256) VALUES($1,$2,$3)",values:[name,bytes,hash],query_timeout:2000});
    const result = await client.query({text:"SELECT bytes,sha256 FROM hosted_objects WHERE object_key=$1",values:[name],query_timeout:2000});
    const row = result.rows[0];
    if (result.rowCount !== 1 || !Buffer.isBuffer(row?.bytes) || !row.bytes.equals(bytes) || row.sha256 !== hash) throw Error("HOSTED_STORAGE_PROBE_FAILED");
  } catch (error) { failed = true; failure = error; }
  finally {
    try { await client.query({text:"ROLLBACK",query_timeout:2000}); }
    catch { destroy = true; if (!failed) { failed = true; failure = Error("HOSTED_STORAGE_PROBE_FAILED"); } }
    finally { client.release(destroy); }
  }
  if (failed) throw failure;
}

/** Render runs behind its TLS terminator; only the outer proxy binds publicly.
 * All private object bytes are in Postgres. The signing key is required from
 * durable provider secret configuration, never regenerated on startup or saved
 * to the ephemeral filesystem. Manager keeps its recovery reference in Keychain. */
export async function startRenderRuntime(environment = process.env) {
  const origin = environment.AUTH_ORIGIN ?? environment.RENDER_EXTERNAL_URL;
  const clientOrigin = environment.CLIENT_ORIGIN;
  if (!origin || !clientOrigin || !environment.DATABASE_URL || !environment.FREEZE_SIGNING_KEY_BASE64 || !environment.TENANT_ID || !environment.ADMIN_PASSWORD) throw Error("HOSTED_DURABLE_CONFIGURATION_REQUIRED");
  const publicFields=[environment.STATIC_PUBLICATION_ID,environment.STATIC_REVISION_SHA256,environment.STATIC_INDEX_SHA256];
  if(publicFields.some(Boolean)&&!publicFields.every(Boolean))throw Error("HOSTED_PUBLICATION_CONFIGURATION_REQUIRED");
  const publicationSource=publicFields.every(Boolean)?createPagesPublicationSource({origin:clientOrigin,publicationId:publicFields[0],revisionSha256:publicFields[1],indexSha256:publicFields[2]}):undefined;
  const auth = config({mode:"network",origin,clientOrigin,bindHost:"127.0.0.1"});
  const port = Number(environment.PORT ?? "10000");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("HOSTED_PORT_INVALID");
  let signingKey;
  try { signingKey=createPrivateKey({key:Buffer.from(environment.FREEZE_SIGNING_KEY_BASE64,"base64"),format:"der",type:"pkcs8"});if(signingKey.asymmetricKeyType!=="ed25519")throw Error(); }
  catch { throw Error("HOSTED_SIGNING_CONFIGURATION_INVALID"); }
  const webRoot = new URL("../apps/web/dist/",import.meta.url).pathname;
  const migrationDirectory = new URL("../database/migrations/",import.meta.url).pathname;
  const pool = new Pool({connectionString:environment.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});
  pool.on("error",()=>console.error("Hosted database unavailable; preserved data remains in Postgres."));
  let app,proxy,timer,running,closing,stopping=false;
  const close=()=>closing??=(async()=>{stopping=true;clearTimeout(timer);if(proxy){proxy.closeUpgradedConnections();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}await running;await app?.close();await pool.end();})();
  try {
    await migrate(pool,migrationDirectory);
    if (!(await pool.query("SELECT 1 FROM auth_credentials LIMIT 1")).rowCount) await bootstrap(pool,environment.TENANT_ID,environment.ADMIN_SUBJECT??"exhibitos-owner",environment.ADMIN_PASSWORD);
    const blobs = new PostgresBlobStore(pool);
    app=buildApp({pool,blobs,auth,publicationSource,freeze:{runtimeRoot:webRoot,signingKey,origin},oexWorker:true,lifecycle:{migrationDirectory,webRoot,blobRoot:"",storageCheck:()=>checkHostedStorage(pool)}});
    await app.listen({host:"127.0.0.1",port:3000});
    proxy=await createLocalProxy({webRoot,origin,apiPort:3000});
    await new Promise((resolve,reject)=>{proxy.once("error",reject);proxy.listen(port,"0.0.0.0",resolve);});
    const imports=new Imports(pool,blobs);let failures=0;
    const tick=async()=>{try{await imports.work();failures=0;}catch{console.error("Hosted import worker unavailable; pending jobs remain recoverable.");if(++failures>=5){stopping=true;process.exitCode=1;setImmediate(()=>void close());}}finally{if(!stopping){timer=setTimeout(()=>{running=tick();},1000);timer.unref();}}};
    running=tick();return {app,proxy,pool,close};
  } catch {await close();throw Error("HOSTED_RUNTIME_START_FAILED");}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try {const runtime=await startRenderRuntime();console.info("ExhibitOS hosted runtime started.");for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>void runtime.close());}
 catch {console.error("Hosted service could not start. Existing database and provider configuration are preserved.");process.exitCode=1;}
}
