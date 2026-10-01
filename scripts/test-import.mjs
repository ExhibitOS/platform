import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,mkdtemp} from 'node:fs/promises';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {fixtureURL} from '@exhibitos/spec';
import {migrate,Storage,FileBlobStore,sha256} from '../packages/storage/dist/index.js';
import {bootstrap} from '../apps/api/dist/auth.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Imports,decode} from '../apps/api/dist/imports.js';
const docker=process.env.DOCKER_BIN??'docker',name=`exhibitos-import-test-${randomUUID()}`,password=randomBytes(24).toString('hex');
const image=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))).postgres;
const run=(...args)=>execFileSync(docker,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
let started=false,pool,app;const evidence=[];
const test=async(title,work)=>{await work();evidence.push(title);console.log(`PASS ${title}`);};
function crc(data){let x=0xffffffff;for(const b of data){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return(x^0xffffffff)>>>0;}
function chunk(kind,body){const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);Buffer.from(kind,'latin1').copy(h,4);tail.writeUInt32BE(crc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);}
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function png(raw=Buffer.from([0,255,0,0]),kind='IDAT'){const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;return Buffer.concat([signature,chunk('IHDR',h),chunk(kind,deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const painting=png(),glb=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb'));
try{
 await test('actual isolated GLB/PNG decode and malformed/8-byte spoof/CRC/trailing/zlib bomb rejection',async()=>{
  await decode(painting,'image/png');await decode(glb,'model/gltf-binary');
  for(const bytes of [signature,Buffer.from('not an image'),png(Buffer.alloc(1000000)),png(Buffer.from([0,255,0,0]),'I\xc4AT'),Buffer.concat([painting,Buffer.from('trailing')])])await assert.rejects(decode(bytes,'image/png'));
  const bad=Buffer.from(painting);bad[bad.length-1]^=1;await assert.rejects(decode(bad,'image/png'));
  await assert.rejects(decode(Buffer.from('glTFbad'),'model/gltf-binary'));await assert.rejects(decode(painting,'model/gltf-binary'));
 });
 run('run','-d','--name',name,'--label',`exhibitos.import.test=${name}`,'-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,image);started=true;
 pool=new Pool({host:'127.0.0.1',port:Number(run('port',name,'5432/tcp').split(':').at(-1)),user:'postgres',password,database:'postgres',statement_timeout:5000});
 for(let i=0;;i++){try{await pool.query('SELECT 1');break;}catch(e){if(i>=90)throw e;await new Promise(r=>setTimeout(r,1000));}}
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname,'003_auth.sql');await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);
 const tenant=randomUUID(),admin=await bootstrap(pool,tenant,'synthetic.import.admin','Synthetic-import-password123');
 const blobRoot=await mkdtemp(`${tmpdir()}/exhibitos-import-blobs-`);const blobs=new FileBlobStore(blobRoot),imports=new Imports(pool,blobs),storage=new Storage(pool,blobs);
 const artwork=randomUUID(),artist=randomUUID();await pool.query("INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}')",[tenant,artist,admin.userId]);await pool.query("INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,'{}')",[tenant,artwork,artist]);
 const rights=JSON.parse(await readFile(fixtureURL('oes/v1/examples/sculpture.json'))).rights;
 const origin='http://127.0.0.1:3000',headers={host:'127.0.0.1:3000',origin};app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers,payload:{subject:'synthetic.import.admin',password:'Synthetic-import-password123',tenantId:tenant}});assert.equal(login.statusCode,200,login.body);const cookie=login.headers['set-cookie'].split(';')[0];const session=(await app.inject({url:'/api/v1/auth/session',headers:{...headers,cookie}})).json();
 const request=(method,path,payload,extra={})=>app.inject({method,url:`/api/v1/tenants/${tenant}/imports${path}`,headers:{...headers,cookie,'x-csrf-token':session.csrfToken,...extra},...(payload===undefined?{}:{payload})});
 const expected=async(p,status,code)=>{const r=await p;assert.equal(r.statusCode,status,r.body);if(code)assert.equal(r.json().code,code);return r.json();};
 const input=(bytes=painting,mime='image/png',key=randomUUID())=>({artworkId:artwork,idempotencyKey:key,mime,sha256:sha256(bytes),bytes:bytes.length,scaleMeters:0.5,rights});
 const enqueue=async(bytes=painting,mime='image/png')=>{const j=await expected(request('POST','',input(bytes,mime)),201);await expected(request('PUT',`/${j.id}/bytes`,bytes,{'content-type':'application/octet-stream'}),200);await expected(request('POST',`/${j.id}/complete`),200);return j;};
 await test('server authorization, CSRF, cross-tenant, remote URL and malformed rights fail closed',async()=>{
  await expected(request('POST','',input(),{cookie:''}),401);await expected(request('POST','',input(),{'x-csrf-token':''}),403);
  await expected(request('POST','',{...input(),url:'http://127.0.0.1/private'}),400);await expected(request('POST','',{...input(),rights:{export:true}}),400,'INVALID_RIGHTS');
  const r=await app.inject({method:'POST',url:`/api/v1/tenants/${randomUUID()}/imports`,headers:{...headers,cookie,'x-csrf-token':session.csrfToken},payload:input()});assert.equal(r.statusCode,403);
 });
 await test('incomplete/interrupted upload, hash mismatch and semantic replay produce one durable job',async()=>{
  const body=input();const j=await expected(request('POST','',body),201);const replay=await expected(request('POST','',{...body,rights:Object.fromEntries(Object.entries(rights).reverse())}),201);assert.equal(replay.id,j.id);
  await expected(request('POST','',{...body,scaleMeters:2}),409,'IDEMPOTENCY_CONFLICT');await expected(request('POST',`/${j.id}/complete`),409,'UPLOAD_INCOMPLETE');
  await expected(request('PUT',`/${j.id}/bytes`,painting.subarray(0,10),{'content-type':'application/octet-stream'}),422,'UPLOAD_INTEGRITY');await expected(request('PUT',`/${j.id}/bytes`,painting,{'content-type':'application/octet-stream'}),200);await expected(request('PUT',`/${j.id}/bytes`,painting,{'content-type':'application/octet-stream'}),200);
  await expected(request('POST',`/${j.id}/complete`),200);await expected(request('POST',`/${j.id}/complete`),200);await imports.work();const ready=await expected(request('GET',`/${j.id}`),200);assert.equal(ready.state,'approved');assert.equal(ready.progress,100);assert.ok(ready.assetId);
  assert.equal((await pool.query('SELECT count(*) FROM assets WHERE artwork_id=$1',[artwork])).rows[0].count,'1');assert.equal(await imports.work(),false);
 });
 await test('queued quarantine preserved by reconciliation; cancel idempotent and blocks worker',async()=>{
  const j=await enqueue();assert.deepEqual(await storage.reconcile({tenantId:tenant,userId:admin.userId},true),[]);await expected(request('POST',`/${j.id}/cancel`),200);await expected(request('POST',`/${j.id}/cancel`),200);assert.equal(await imports.work(),false);await expected(request('POST',`/${j.id}/retry`),409);
 });
 await test('malformed image/GLB worker errors cannot publish; error retry respects backoff',async()=>{
  for(const [bytes,mime]of [[signature,'image/png'],[Buffer.from('glTFinvalid'),'model/gltf-binary'],[Buffer.from('<script>alert(1)</script>'),'image/png']]){
   const j=await enqueue(bytes,mime);await imports.work();const failed=await expected(request('GET',`/${j.id}`),200);assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'FORMAT_REJECTED');assert.equal(failed.assetId,null);await expected(request('POST',`/${j.id}/retry`),409);
  }
 });
 await test('after-copy failure rolls back asset and safely retries immutable bytes once',async()=>{
  const j=await enqueue(glb,'model/gltf-binary');await imports.work({afterCopy:()=>{throw Error('synthetic worker crash after copy');}});assert.equal((await expected(request('GET',`/${j.id}`),200)).state,'failed');
  await pool.query("UPDATE import_jobs SET available_at=now()-interval '1 second' WHERE id=$1",[j.id]);await expected(request('POST',`/${j.id}/retry`),200);await imports.work();const ready=await expected(request('GET',`/${j.id}`),200);assert.equal(ready.state,'approved');assert.equal(ready.attempts,2);
  assert.equal((await pool.query('SELECT count(*) FROM assets WHERE id=$1',[ready.assetId])).rows[0].count,'1');
 });
 await test('real truncated HTTP upload disconnect leaves uploading job and no committed bytes',async()=>{
  const j=await expected(request('POST','',input()),201);await app.listen({host:'127.0.0.1',port:0});const port=app.server.address().port;
  await new Promise((resolve,reject)=>{const socket=connect(port,'127.0.0.1');socket.on('error',reject);socket.on('connect',()=>{socket.write(`PUT /api/v1/tenants/${tenant}/imports/${j.id}/bytes HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nX-CSRF-Token: ${session.csrfToken}\r\nContent-Type: application/octet-stream\r\nContent-Length: ${painting.length}\r\n\r\n`);socket.write(painting.subarray(0,10));setTimeout(()=>{socket.destroy();resolve();},30);});});
  await new Promise(r=>setTimeout(r,30));assert.equal((await expected(request('GET',`/${j.id}`),200)).state,'uploading');await expected(request('POST',`/${j.id}/complete`),409,'UPLOAD_INCOMPLETE');await expected(request('POST',`/${j.id}/cancel`),200);
 });
 await test('actual SIGKILL after durable worker claim reclaims lease and creates exactly one asset',async()=>{
  const j=await enqueue();const source=`import {Pool} from 'pg';import {FileBlobStore} from './packages/storage/dist/index.js';import {Imports} from './apps/api/dist/imports.js';const pool=new Pool(JSON.parse(process.env.PG_TEST));const store=new FileBlobStore(process.env.BLOB_TEST);store.get=async()=>{process.stdout.write('CLAIMED\\n');await new Promise(()=>setInterval(()=>{},1000));};await new Imports(pool,store).work();`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{PATH:process.env.PATH,PG_TEST:JSON.stringify({host:'127.0.0.1',port:pool.options.port,user:'postgres',password,database:'postgres'}),BLOB_TEST:blobRoot},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker claim timeout')),5000);child.stdout.on('data',()=>{clearTimeout(timer);resolve();});child.on('error',reject);});
  const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exit;
  assert.equal((await expected(request('GET',`/${j.id}`),200)).state,'processing');await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[j.id]);await imports.work();const ready=await expected(request('GET',`/${j.id}`),200);assert.equal(ready.state,'approved');assert.equal(ready.attempts,2);
 });
 await test('cancel during validation and expired clock at final commit cannot approve',async()=>{
  const cancelled=await enqueue();await imports.work({beforeCommit:()=>expected(request('POST',`/${cancelled.id}/cancel`),200)});assert.equal((await expected(request('GET',`/${cancelled.id}`),200)).state,'cancelled');
  const expired=await enqueue();await imports.work({beforeCommit:()=>pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id])});const status=await expected(request('GET',`/${expired.id}`),200);assert.equal(status.state,'processing');assert.equal(status.assetId,null);await imports.work();assert.equal((await expected(request('GET',`/${expired.id}`),200)).state,'approved');
 });
 await test('maintenance-lock wait uses advancing clock; expired blob-copy cannot commit approval',async()=>{
  const waiting=await enqueue();const lock=await pool.connect();
  try{await imports.work({beforeCommit:async()=>{await lock.query('SELECT pg_advisory_lock(82002)');await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE id=$1",[waiting.id]);setTimeout(()=>{void lock.query('SELECT pg_advisory_unlock(82002)');},250);}});}finally{await lock.query('SELECT pg_advisory_unlock_all()');lock.release();}
  const status=await expected(request('GET',`/${waiting.id}`),200);assert.equal(status.state,'processing');assert.equal(status.assetId,null);await imports.work();assert.equal((await expected(request('GET',`/${waiting.id}`),200)).state,'approved');
  const copying=await enqueue();await imports.work({beforeCommit:()=>pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",[copying.id]),afterCopy:()=>new Promise(r=>setTimeout(r,250))});const fail=await expected(request('GET',`/${copying.id}`),200);assert.equal(fail.state,'failed');assert.equal(fail.errorCode,'LEASE_EXPIRED');assert.equal(fail.assetId,null);
 });
 await test('crashed lease resumes, final-attempt expired lease fails instead of stuck processing',async()=>{
  const j=await enqueue();await pool.query("UPDATE import_jobs SET state='processing',attempts=1,lease_id=$2,lease_until=now()-interval '1 second' WHERE id=$1",[j.id,randomUUID()]);await imports.work();assert.equal((await expected(request('GET',`/${j.id}`),200)).state,'approved');
  const dead=await enqueue();await pool.query("UPDATE import_jobs SET state='processing',attempts=5,lease_id=$2,lease_until=now()-interval '1 second' WHERE id=$1",[dead.id,randomUUID()]);await imports.work();const failed=await expected(request('GET',`/${dead.id}`),200);assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'RETRY_EXHAUSTED');await expected(request('POST',`/${dead.id}/retry`),409);
 });
 console.log(JSON.stringify({valid:true,checks:evidence.length,evidence,image,scope:'isolated synthetic PostgreSQL + filesystem + HTTP injection + bounded child decoder; single primary asset import, no anonymous publishing/OES/OEX import'},null,2));
}finally{await app?.close();await pool?.end();if(started&&run('inspect','--format','{{index .Config.Labels "exhibitos.import.test"}}',name)===name)run('rm','-f','-v',name);}
