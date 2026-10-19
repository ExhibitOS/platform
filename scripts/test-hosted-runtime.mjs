// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {Pool} from 'pg';
import {readiness} from '../apps/api/dist/lifecycle.js';
import {PostgresBlobStore,createServiceBackup,verifyServiceBackup,restoreServiceBackup,collectServiceInventory,sha256} from '../packages/storage/dist/index.js';
import {IsolatedBackends} from './service-backup-adapters.mjs';
import {startRenderRuntime,checkHostedStorage} from './render-runtime.mjs';
const root=await mkdtemp(tmpdir()+'/exhibitos-hosted-runtime-'),backends=new IsolatedBackends(JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))));
const checks=[],secret=randomBytes(32),migrationDirectory=new URL('../database/migrations/',import.meta.url).pathname;
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const origin='https://synthetic-example.onrender.com',clientOrigin='https://synthetic-example.pages.dev';
let runtime;
try {
 const source=await backends.postgres('hosted-source'),target=await backends.postgres('hosted-restored');
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const env={DATABASE_URL:`postgresql://postgres:${source.password}@127.0.0.1:${source.database.port}/postgres`,AUTH_ORIGIN:origin,CLIENT_ORIGIN:clientOrigin,TENANT_ID:randomUUID(),ADMIN_SUBJECT:'synthetic-owner',ADMIN_PASSWORD:randomBytes(24).toString('hex'),FREEZE_SIGNING_KEY_BASE64:generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),PORT:String(port)};
 const http=(path,{method='GET',payload,cookie,from=clientOrigin}={})=>new Promise((resolve,reject)=>{const data=payload?JSON.stringify(payload):undefined;const req=request({host:'127.0.0.1',port,path,method,headers:{host:new URL(origin).host,...(from?{origin:from}:{}),...(cookie?{cookie}:{}),...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{})}},response=>{const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.once('error',reject);req.end(data);});
 let cookie,authority;
 await test('Render entrypoint migrates and serves readiness with exact Pages credential CORS',async()=>{runtime=await startRenderRuntime(env);const r=await http('/api/v1/readiness');assert.equal(r.status,200);assert.equal(r.body.ready,true);assert.equal(r.headers['access-control-allow-origin'],clientOrigin);assert.equal(r.headers['access-control-allow-credentials'],'true');});
 await test('existing login/session and CSRF/foreign-origin rejection remain enforced',async()=>{const r=await http('/api/v1/auth/login',{method:'POST',payload:{subject:env.ADMIN_SUBJECT,password:env.ADMIN_PASSWORD,tenantId:env.TENANT_ID}});assert.equal(r.status,200);cookie=r.headers['set-cookie'][0].split(';')[0];assert.match(r.headers['set-cookie'][0],/HttpOnly/);assert.match(r.headers['set-cookie'][0],/Secure/);assert.match(r.headers['set-cookie'][0],/SameSite=None/);assert.equal((await http('/api/v1/auth/session',{cookie})).status,200);assert.equal((await http('/api/v1/auth/logout',{method:'POST',cookie,from:'https://attacker.invalid'})).status,403);assert.equal((await http('/api/v1/auth/logout',{method:'POST',cookie})).status,403);authority=(await http('/api/v1/freeze/authority',{cookie})).body.authority;});
 const sourceStore=new PostgresBlobStore(source.pool),name=env.TENANT_ID+'/objects/preserved',bytes=randomBytes(128*1024);
 await test('actual PostgreSQL immutable objects survive contention and reject replacement',async()=>{await Promise.all([sourceStore.put(name,bytes),sourceStore.put(name,bytes)]);await assert.rejects(sourceStore.put(name,Buffer.from('conflicting')));assert.equal(sha256(await sourceStore.get(name)),sha256(bytes));});
 // Function-level readiness regression on the existing synthetic DB, not a new
 // HTTP/provider/disk-full qualification. Both probes must preserve every object.
 await test('read-only durable storage is unavailable and writable probe rolls back without changing objects',async()=>{
  const inventory=async()=>(await source.pool.query('SELECT object_key,bytes,sha256 FROM hosted_objects ORDER BY object_key')).rows;
  const original=await inventory();
  const readonlyPool=new Pool({...source.database,options:'-c default_transaction_read_only=on',max:1,connectionTimeoutMillis:2000});
  const config=pool=>({migrationDirectory,webRoot:new URL('../apps/web/dist/',import.meta.url).pathname,blobRoot:'',storageCheck:()=>checkHostedStorage(pool)});
  try{
   assert.equal((await readonlyPool.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
   await readonlyPool.query('SELECT object_key FROM hosted_objects LIMIT 1');
   await assert.rejects(checkHostedStorage(readonlyPool),{code:'25006'});
   const unavailable=await readiness(readonlyPool,config(readonlyPool));
   assert.equal(unavailable.ready,false);
   assert.equal(unavailable.services.find(service=>service.name==='storage').status,'unavailable');
   await checkHostedStorage(source.pool);
   const recovered=await readiness(source.pool,config(source.pool));
   assert.equal(recovered.ready,true);
   assert.equal(recovered.services.find(service=>service.name==='storage').status,'ready');
   assert.deepEqual(await inventory(),original);
   assert.equal(sha256(await sourceStore.get(name)),sha256(bytes));
  }finally{await readonlyPool.end();}
 });
 await test('active WebSocket is closed and same durable key/data/session survive runtime restart',async()=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/api/v1/publications/${randomUUID()}/presence`,{headers:{host:new URL(origin).host,origin:clientOrigin}});await once(ws,'open');const closed=once(ws,'close');await runtime.close();runtime=null;await closed;runtime=await startRenderRuntime(env);assert.deepEqual((await http('/api/v1/freeze/authority',{cookie})).body.authority,authority);assert.equal(sha256(await new PostgresBlobStore(runtime.pool).get(name)),sha256(bytes));await runtime.close();runtime=null;});
 const snapshot=store=>client=>collectServiceInventory(client,store,{migrationDirectory});
 let before;
 await test('existing encrypted backup authenticates same-DB objects without provider secrets',async()=>{await createServiceBackup({pool:source.pool,store:sourceStore,encryptionKey:secret,destination:root+'/backup',snapshot:snapshot(sourceStore),dump:(p,s)=>backends.pgFile(source,p,'dump',s)});const verified=await verifyServiceBackup({source:root+'/backup',encryptionKey:secret,destination:root+'/verify'});assert.equal(verified.manifest.inventory.objects.length,1);before=verified.manifest.inventory;for(const file of ['complete.json']){const text=await readFile(root+'/backup/'+file,'utf8');for(const value of [source.password,env.ADMIN_PASSWORD,env.FREEZE_SIGNING_KEY_BASE64])assert(!text.includes(value));}assert(!JSON.stringify(verified.manifest).includes(env.FREEZE_SIGNING_KEY_BASE64));});
 const targetStore=new PostgresBlobStore(target.pool,{allowUninitialized:true});
 await test('fresh independent DB restores exact objects, database rows and schema with original source stopped',async()=>{await source.pool.end();backends.stop(source.name);const restored=await restoreServiceBackup({pool:target.pool,store:targetStore,source:root+'/backup',encryptionKey:secret,destination:root+'/restore',snapshot:snapshot(targetStore),restore:p=>backends.pgFile(target,p,'restore')});assert.equal(sha256(await targetStore.get(name)),sha256(bytes));assert.deepEqual(restored.inventory.tables,before.tables);assert.equal(restored.inventory.schemaDigest,before.schemaDigest);assert.deepEqual(restored.inventory.issues,[]);});
 await writeFile(root+'/evidence.json',JSON.stringify({passed:true,checks,localSynthetic:true,actualRenderAccount:false,actualCloudflare:false,backupScope:'Postgres SQL and same-DB objects encrypted; externally managed provider secrets/signing key not included',databaseDumpDuplicatesObjectBytes:true,limits:['Cardless account/API creation not verified','Safari public cross-site cookies not qualified','Provider DB expiration/local backup Manager wiring incomplete']},null,2),{mode:0o600});console.log('report '+root+'/evidence.json');
} finally {await runtime?.close();secret.fill(0);await backends.close();}
