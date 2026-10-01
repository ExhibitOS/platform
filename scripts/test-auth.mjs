import { execFileSync } from 'node:child_process';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { fixtureURL } from '@exhibitos/spec';
import { Pool } from 'pg';
import { migrate,Storage,FileBlobStore } from '../packages/storage/dist/index.js';
import { bootstrap } from '../apps/api/dist/auth.js';
import { buildApp } from '../apps/api/dist/app.js';
const docker=process.env.DOCKER_BIN??'docker', name=`exhibitos-auth-test-${randomUUID()}`, password=randomBytes(24).toString('hex');
const image=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))).postgres;
const run=(...args)=>execFileSync(docker,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
let started=false,pool,app;const evidence=[];let checks=0;
const test=async(title,work)=>{await work();checks++;evidence.push(title);};
const origin='http://127.0.0.1:3000', headers={host:'127.0.0.1:3000',origin};
try {
 run('run','-d','--name',name,'--label',`exhibitos.auth.test=${name}`,'-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,image);started=true;
 const port=Number(run('port',name,'5432/tcp').split(':').at(-1));pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',statement_timeout:5000});
 for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');break;}catch(error){if(attempt>=90)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);
 const tenant=randomUUID(),foreignTenant=randomUUID();const pass='Synthetic-only-password-123';
 let admin;
 await test('one-time concurrent bootstrap: one winner; hashes only; no default password',async()=>{
  const results=await Promise.allSettled([bootstrap(pool,tenant,'synthetic.admin',pass),bootstrap(pool,tenant,'synthetic.race',pass)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);admin=results.find(x=>x.status==='fulfilled').value;assert.equal((await pool.query('SELECT count(*) FROM auth_credentials')).rows[0].count,'1');await assert.rejects(bootstrap(pool,tenant,'synthetic.late',pass));
 });
 const blobs=new FileBlobStore(await mkdtemp(`${tmpdir()}/exhibitos-auth-blobs-`));let reads=0;
 const spy={get:async key=>{reads++;return blobs.get(key);},put:(...args)=>blobs.put(...args),remove:key=>blobs.remove(key),list:p=>blobs.list(p)};
 app=buildApp({pool,auth:{mode:'local',origin,bindHost:'127.0.0.1'},blobs:spy});
 const adminSubject=(await pool.query('SELECT subject FROM users WHERE id=$1',[admin.userId])).rows[0].subject;
 const login=async(subject,extra={})=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{...headers,...extra},payload:{subject,password:pass,tenantId:tenant}});assert.equal(response.statusCode,200,response.body);const cookie=response.headers['set-cookie'].split(';')[0];const session=await app.inject({url:'/api/v1/auth/session',headers:{...headers,cookie}});assert.equal(session.statusCode,200);return {cookie,...session.json()};};
 let a=await login(adminSubject);
 const request=(actor,method,path,payload,overrides={})=>app.inject({method,url:`/api/v1/tenants/${tenant}/${path}`,headers:{...headers,...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrfToken}:{}),...overrides},...(payload===undefined?{}:{payload})});
 const expectCode=async(promise,status,code)=>{const res=await promise;assert.equal(res.statusCode,status,res.body);if(code)assert.equal(res.json().code,code);return res;};
 let artist,otherArtist,curator,viewer;
 for(const [subject,role] of [['synthetic.artist','artist'],['synthetic.other','artist'],['synthetic.curator','curator'],['synthetic.viewer','viewer']]) {const result=await expectCode(request(a,'POST','users',{subject,password:pass,role}),201);const actor=await login(subject);assert.equal(actor.userId,result.json().userId);if(role==='curator')curator=actor;else if(role==='viewer')viewer=actor;else if(subject==='synthetic.artist')artist=actor;else otherArtist=actor;}
 const artistId=randomUUID(),otherArtistId=randomUUID(),exhibition=randomUUID(),otherExhibition=randomUUID(),room=randomUUID();
 await pool.query("INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}'),($1,$4,$5,'{}')",[tenant,artistId,artist.userId,otherArtistId,otherArtist.userId]);
 await pool.query("INSERT INTO exhibitions(tenant_id,id,metadata) VALUES($1,$2,'{}'),($1,$3,'{}')",[tenant,exhibition,otherExhibition]);
 await pool.query("INSERT INTO rooms(tenant_id,id,metadata,exhibition_id) VALUES($1,$2,'{}',$3)",[tenant,room,exhibition]);
 const originalRights=JSON.parse(await readFile(fixtureURL('oes/v1/examples/sculpture.json'),'utf8')).rights;
 const grant={...originalRights,permissions:{...originalRights.permissions,display:false}};
 const storage=new Storage(pool,blobs), input={artistId,metadata:{title:'Synthetic sculpture'},rights:grant,mime:'text/html',scaleMeters:1,bytes:Buffer.from('synthetic bytes; not an approved format')};
 const artwork=await storage.ingest({tenantId:tenant,userId:artist.userId},'auth-synthetic',input);await storage.work();
 const asset=(await pool.query('SELECT id FROM assets WHERE artwork_id=$1',[artwork])).rows[0].id;
 await pool.query("INSERT INTO placements(tenant_id,id,metadata,room_id,artwork_id) VALUES($1,$2,'{}',$3,$4)",[tenant,randomUUID(),room,artwork]);
 await test('anonymous and forged actor headers cannot read/write assets, artwork or export',async()=>{
  for(const [method,path,payload] of [['GET',`artworks/${artwork}`],['PATCH',`artworks/${artwork}`,{revision:1,metadata:{}}],['GET',`assets/${asset}`],['GET',`assets/${asset}/bytes`],['POST',`assets/${asset}/export-check`]])await expectCode(request(null,method,path,payload,{'x-user-id':a.userId}),401);
 });
 await test('cross-tenant read/write/exhibition/asset/bytes/export denied',async()=>{
  for(const [method,path,payload] of [['GET',`artworks/${artwork}`],['PATCH',`artworks/${artwork}`,{revision:1,metadata:{}}],['GET',`exhibitions/${exhibition}`],['PATCH',`exhibitions/${exhibition}`,{revision:1,metadata:{}}],['GET',`assets/${asset}`],['GET',`assets/${asset}/bytes`],['POST',`assets/${asset}/export-check`]])await expectCode(app.inject({method,url:`/api/v1/tenants/${foreignTenant}/${path}`,headers:{...headers,cookie:a.cookie,'x-csrf-token':a.csrfToken},...(payload?{payload}:{})}),403);
  assert.equal(reads,0);
 });
 await test('artist own artwork CAS, other artist/viewer/curator denial, Storage cannot bypass',async()=>{
  await expectCode(request(artist,'GET',`artworks/${artwork}`),200);await expectCode(request(otherArtist,'GET',`artworks/${artwork}`),403);await expectCode(request(viewer,'GET',`artworks/${artwork}`),403);await expectCode(request(curator,'GET',`artworks/${artwork}`),403);
  await expectCode(request(artist,'PATCH',`artworks/${artwork}`,{revision:1,metadata:{title:'Edited'}}),200);await expectCode(request(artist,'PATCH',`artworks/${artwork}`,{revision:1,metadata:{}}),409,'REVISION_CONFLICT');
  await assert.rejects(storage.readArtwork({tenantId:tenant,userId:viewer.userId},artwork));await assert.rejects(storage.revise({tenantId:tenant,userId:curator.userId},artwork,2,{}));await assert.rejects(storage.ingest({tenantId:tenant,userId:curator.userId},'curator-forbidden',input));
 });
 await test('curator assigned exhibition write and placed-artwork read; viewer explicit read only; revoke immediate',async()=>{
  await expectCode(request(a,'PUT',`exhibitions/${exhibition}/assignments/${curator.userId}`,{canView:false}),200);await expectCode(request(curator,'GET',`artworks/${artwork}`),200);await expectCode(request(curator,'PATCH',`artworks/${artwork}`,{revision:2,metadata:{}}),403);
  await expectCode(request(curator,'PATCH',`exhibitions/${exhibition}`,{revision:1,metadata:{title:'Exhibition'}}),200);await expectCode(request(curator,'GET',`exhibitions/${otherExhibition}`),403);
  await expectCode(request(a,'PUT',`exhibitions/${exhibition}/assignments/${viewer.userId}`,{canView:true}),200);await expectCode(request(viewer,'GET',`exhibitions/${exhibition}`),200);await expectCode(request(viewer,'PATCH',`exhibitions/${exhibition}`,{revision:2,metadata:{}}),403);
  await expectCode(request(a,'POST',`exhibitions/${exhibition}/assignments/${curator.userId}/revoke`),200);await expectCode(request(curator,'GET',`artworks/${artwork}`),403);await expectCode(request(curator,'GET',`exhibitions/${exhibition}`),403);
 });
 await test('asset metadata/bytes denied before blob read; authorized export differs from display; safe attachment',async()=>{
  for(const actor of [otherArtist,curator,viewer]){await expectCode(request(actor,'GET',`assets/${asset}`),403);await expectCode(request(actor,'GET',`assets/${asset}/bytes`),403);await expectCode(request(actor,'POST',`assets/${asset}/export-check`),403);}assert.equal(reads,0);
  const eligible=await expectCode(request(artist,'POST',`assets/${asset}/export-check`),200);assert.equal(eligible.json().packageProduced,false);
  const bytes=await expectCode(request(artist,'GET',`assets/${asset}/bytes`),200);assert.deepEqual(bytes.rawPayload,input.bytes);assert.equal(bytes.headers['content-type'],'application/octet-stream');assert.equal(bytes.headers['content-disposition'],'attachment');assert.equal(bytes.headers['x-content-type-options'],'nosniff');assert.equal(reads,1);
 });
 await test('expiry/calendar/leap-second/export=false rights deny before blob reads; stored hash/size checked',async()=>{
  const rightsId=(await pool.query('SELECT rights_id FROM assets WHERE id=$1',[asset])).rows[0].rights_id;
  for(const rights of [{export:true,display:false},{...grant,export:true,permissions:{...grant.permissions,export:false}},{...grant,permissions:{...grant.permissions,download:false}},{...grant,expiresAt:'2000-01-01T00:00:00Z'},{...grant,validFrom:'2999-01-01T00:00:00Z'},{...grant,expiresAt:'2016-12-31T23:59:60Z'},{...grant,expiresAt:'2027-02-30T00:00:00Z'}]){await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,rights]);await expectCode(request(artist,'GET',`assets/${asset}/bytes`),403,'RIGHTS_DENIED');}assert.equal(reads,1);
  await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,grant]);await pool.query("UPDATE assets SET state='quarantine' WHERE id=$1",[asset]);await expectCode(request(artist,'GET',`assets/${asset}/bytes`),409,'ASSET_NOT_STORED');assert.equal(reads,1);
  await pool.query("UPDATE assets SET state='stored',bytes=bytes+1 WHERE id=$1",[asset]);await expectCode(request(artist,'GET',`assets/${asset}/bytes`),409,'ASSET_INTEGRITY');await pool.query('UPDATE assets SET bytes=bytes-1 WHERE id=$1',[asset]);
 });
 await test('CSRF, exact Host/Origin, forwarded identity and JSON extra fields reject',async()=>{
  for(const h of [{'x-csrf-token':''},{'x-csrf-token':'wrong'},{origin:'https://evil.test'},{origin:''},{host:'evil.test'},{origin:'null'}])await expectCode(request(artist,'PATCH',`artworks/${artwork}`,{revision:2,metadata:{}},h),403);
  await expectCode(request(otherArtist,'GET',`artworks/${artwork}`,undefined,{'x-forwarded-for':'127.0.0.1','x-forwarded-host':headers.host,'x-user-id':artist.userId}),403);
  await expectCode(request(artist,'PATCH',`artworks/${artwork}`,{revision:2,metadata:{},userId:a.userId}),400);
  await expectCode(app.inject({method:'POST',url:'/api/v1/auth/login',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},payload:'subject=synthetic.admin'}),415);
 });
 await test('logout, revoke, disable, membership change and expiry reject existing cookies',async()=>{
  const tmp=await login('synthetic.artist');await expectCode(app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{...headers,cookie:tmp.cookie,'x-csrf-token':tmp.csrfToken}}),200);await expectCode(request(tmp,'GET',`artworks/${artwork}`),401);
  const next=await login('synthetic.artist');await expectCode(request(a,'POST',`sessions/${next.id}/revoke`),200);await expectCode(request(next,'GET',`artworks/${artwork}`),401);
  await expectCode(request(a,'PUT',`memberships/${curator.userId}`,{role:'viewer'}),200);await expectCode(request(curator,'GET',`exhibitions/${exhibition}`),401);
  await expectCode(request(a,'POST',`users/${otherArtist.userId}/disable`),200);await expectCode(request(otherArtist,'GET',`artworks/${artwork}`),401);
  const expiry=await login('synthetic.artist');await pool.query('UPDATE auth_sessions SET expires_at=now() WHERE id=$1',[expiry.id]);await expectCode(request(expiry,'GET',`artworks/${artwork}`),401);
  await expectCode(request(a,'PUT',`memberships/${a.userId}`,{role:'viewer'}),409,'LAST_ADMIN');await expectCode(request(a,'POST',`users/${a.userId}/disable`),409,'LAST_ADMIN');
 });
 await test('multi-tenant user global disable denied; foreign admin operations denied',async()=>{
  await pool.query("INSERT INTO tenants(id,name) VALUES($1,'foreign')",[foreignTenant]);await pool.query("INSERT INTO memberships VALUES($1,$2,'artist')",[foreignTenant,artist.userId]);await expectCode(request(a,'POST',`users/${artist.userId}/disable`),409,'MULTI_TENANT_USER');await expectCode(request(viewer,'PUT',`memberships/${a.userId}`,{role:'viewer'}),403);
 });
 await test('no session fixation; malformed and duplicate session cookies rejected',async()=>{
  const next=await login('synthetic.artist');assert.notEqual(next.cookie,artist.cookie);
  await expectCode(request(artist,'GET',`artworks/${artwork}`,undefined,{cookie:`${artist.cookie}; ${next.cookie}`}),401);
  await expectCode(request(artist,'GET',`artworks/${artwork}`,undefined,{cookie:'exhibitos_local_session=invalid'}),401);
  const stored=(await pool.query('SELECT token_hash FROM auth_sessions WHERE id=$1',[next.id])).rows[0].token_hash;assert.equal(stored,createHash('sha256').update(next.cookie.split('=')[1]).digest('hex'));
 });
 await test('network secure cookie, local external settings rejected, hostile forwarded origin not trusted',async()=>{
  assert.throws(()=>buildApp({pool,auth:{mode:'local',origin,bindHost:'0.0.0.0'}}));assert.throws(()=>buildApp({pool,auth:{mode:'network',origin,bindHost:'0.0.0.0'}}));assert.throws(()=>buildApp({pool,auth:{mode:'network',origin:'https://gallery.test',bindHost:'0.0.0.0'}}));
  const network=buildApp({pool,auth:{mode:'network',origin:'https://gallery.test',bindHost:'127.0.0.1'}});
  const result=await network.inject({method:'POST',url:'/api/v1/auth/login',headers:{host:'gallery.test',origin:'https://gallery.test'},payload:{subject:adminSubject,password:pass,tenantId:tenant}});assert.equal(result.statusCode,200);assert.match(result.headers['set-cookie'],/^__Host-exhibitos_session=/);assert.match(result.headers['set-cookie'],/; Secure/);assert.doesNotMatch(result.headers['set-cookie'],/Domain=/);
  await expectCode(network.inject({method:'POST',url:'/api/v1/auth/login',headers:{host:'evil.test',origin:'https://gallery.test','x-forwarded-host':'gallery.test'},payload:{subject:adminSubject,password:pass,tenantId:tenant}}),403);await network.close();
 });
 await test('uniform unknown/wrong password responses; login rate and KDF concurrency bounded',async()=>{
  const probe=buildApp({pool,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});
  const attempt=(subject,password=pass)=>probe.inject({method:'POST',url:'/api/v1/auth/login',headers,payload:{subject,password,tenantId:tenant}});
  const wrong=await attempt(adminSubject,'Wrong-synthetic-password'),unknown=await attempt('synthetic.unknown');assert.equal(wrong.statusCode,401);assert.equal(unknown.statusCode,401);assert.equal(wrong.json().code,unknown.json().code);
  const simultaneous=await Promise.all(Array.from({length:8},()=>attempt('synthetic.unknown')));assert.ok(simultaneous.some(r=>r.statusCode===429));assert.ok(simultaneous.some(r=>r.statusCode===401));
  for(let i=0;i<10;i++)await attempt('synthetic.unknown');
  await expectCode(attempt(adminSubject),429,'RATE_LIMITED');await probe.close();
 });
 await test('maintenance and authenticated write lock order finishes without deadlock',async()=>{
  await pool.query("SET statement_timeout='5s'");
  const results=await Promise.race([Promise.all([storage.reconcile({tenantId:tenant,userId:a.userId}),request(artist,'PATCH',`artworks/${artwork}`,{revision:2,metadata:{title:'Concurrent write'}})]),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('concurrency timeout')),7000);timer.unref();})]);assert.equal(results[1].statusCode,200,results[1].body);
 });
 await test('download and export rights are independent, malformed OES rights denied',async()=>{
  const rightsId=(await pool.query('SELECT rights_id FROM assets WHERE id=$1',[asset])).rows[0].rights_id;
  await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,{...grant,permissions:{...grant.permissions,download:false}}]);await expectCode(request(artist,'POST',`assets/${asset}/export-check`),200);await expectCode(request(artist,'GET',`assets/${asset}/bytes`),403,'RIGHTS_DENIED');
  await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,{...grant,permissions:{...grant.permissions,export:false}}]);await expectCode(request(artist,'POST',`assets/${asset}/export-check`),403,'RIGHTS_DENIED');await expectCode(request(artist,'GET',`assets/${asset}/bytes`),200);
  await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,{...grant,export:true,permissions:{...grant.permissions,export:false}}]);await expectCode(request(artist,'POST',`assets/${asset}/export-check`),403,'RIGHTS_DENIED');await pool.query('UPDATE rights SET metadata=$2 WHERE id=$1',[rightsId,grant]);
 });
 await test('quiesced backup maintenance lock blocks login writes until released',async()=>{
  const maintenance=await pool.connect();let finished=false;
  try{await maintenance.query('SELECT pg_advisory_lock(82002)');const pending=login('synthetic.artist').then(result=>{finished=true;return result;});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false);await maintenance.query('SELECT pg_advisory_unlock(82002)');await pending;assert.equal(finished,true);}finally{await maintenance.query('SELECT pg_advisory_unlock_all()');maintenance.release();}
 });
 await test('actual server startup rejects public plaintext network and health-only external bind',async()=>{
  for(const env of [{HOST:'0.0.0.0'},{HOST:'0.0.0.0',AUTH_MODE:'network',AUTH_ORIGIN:'https://gallery.test',DATABASE_URL:'postgres://synthetic.invalid'}]){let failed=false;try{execFileSync(process.execPath,['apps/api/dist/server.js'],{env:{PATH:process.env.PATH,...env},timeout:5000,stdio:['ignore','pipe','pipe']});}catch(error){failed=true;assert.equal(error.status,1);}assert.ok(failed);}
 });
 await test('real ephemeral HTTP and Chromium HttpOnly cookie login/session/CSRF/logout',async()=>{
  let live,base;
  for(let attempt=0;attempt<3;attempt++){
   const reserve=createServer();await new Promise((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',resolve);});const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));base=`http://127.0.0.1:${port}`;
   live=buildApp({pool,auth:{mode:'local',origin:base,bindHost:'127.0.0.1'}});
   try{await live.listen({host:'127.0.0.1',port});break;}catch(error){await live.close();if(error.code!=='EADDRINUSE'||attempt===2)throw error;}
  }
  let browser;
  try{
   browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();await page.goto(`${base}/api/v1/health`);
   const login=await page.evaluate(async data=>{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return r.status;},{subject:adminSubject,password:pass,tenantId:tenant});assert.equal(login,200);
   const cookies=await context.cookies();const sessionCookie=cookies.find(c=>c.name==='exhibitos_local_session');assert.ok(sessionCookie);assert.equal(sessionCookie.httpOnly,true);assert.equal(sessionCookie.sameSite,'Strict');assert.equal(await page.evaluate(()=>document.cookie),'');
   const session=await page.evaluate(async()=>{const r=await fetch('/api/v1/auth/session');return {status:r.status,data:await r.json()};});assert.equal(session.status,200);
   const missing=await page.evaluate(async()=> (await fetch('/api/v1/auth/logout',{method:'POST'})).status);assert.equal(missing,403);
   const logout=await page.evaluate(async csrf=>(await fetch('/api/v1/auth/logout',{method:'POST',headers:{'x-csrf-token':csrf}})).status,session.data.csrfToken);assert.equal(logout,200);assert.equal((await context.cookies()).some(c=>c.name==='exhibitos_local_session'),false);assert.equal(await page.evaluate(async()=>(await fetch('/api/v1/auth/session')).status),401);
  }finally{await browser?.close();await live?.close();}
 });
 console.log(JSON.stringify({valid:true,checks,evidence,image,scope:'synthetic isolated PostgreSQL + Fastify injection + real loopback HTTP; actual Chromium local cookie lifecycle checked; no production TLS/OEX/parser approval'},null,2));
} finally {await app?.close();await pool?.end();if(started && run('inspect','--format','{{index .Config.Labels "exhibitos.auth.test"}}',name)===name)run('rm','-f','-v',name);}
