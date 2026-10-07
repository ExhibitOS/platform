import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {Pool} from 'pg';
import {fixtureURL} from '@exhibitos/spec';
import {migrate} from '../packages/storage/dist/index.js';
import {bootstrap} from '../apps/api/dist/auth.js';
import {buildApp} from '../apps/api/dist/app.js';
// Explicit existing immutable image; never pull images or create persistent volumes.
const image=process.env.EXHIBITOS_TEST_POSTGRES_IMAGE;
if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('EXPLICIT_EXISTING_POSTGRES_IMAGE_REQUIRED');
const name='exhibitos-input-authorization-'+randomUUID(),password=randomBytes(24).toString('hex');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
let started=false,pool,app;const checks=[];
try{
 docker('run','-d','--pull','never','--name',name,'--label',`exhibitos.authorization.test=${name}`,'--memory','512m','--tmpfs','/var/lib/postgresql:rw,size=268435456','-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,image);started=true;
 assert(!JSON.parse(docker('inspect',name,'--format','{{json .Mounts}}')).some(m=>m.Type==='volume'||m.Type==='bind'));
 pool=new Pool({host:'127.0.0.1',port:Number(docker('port',name,'5432/tcp').split(':').at(-1)),user:'postgres',password,database:'postgres',statement_timeout:5000});
 for(let i=0;;i++){try{await pool.query('SELECT 1');break;}catch{if(i>=60)throw Error('TEST_DATABASE_NOT_READY');await new Promise(r=>setTimeout(r,500));}}
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);
 const tenant=randomUUID(),artistId=randomUUID(),artwork=randomUUID(),subject='synthetic.input.admin',pass='Synthetic-input-password123',admin=await bootstrap(pool,tenant,subject,pass),rights=JSON.parse(readFileSync(fixtureURL('oes/v1/examples/sculpture.json'))).rights;
 await pool.query("INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}')",[tenant,artistId,admin.userId]);
 await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenant,artwork,artistId,{rights}]);
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
 app=buildApp({pool,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});await app.listen({host:'127.0.0.1',port});
 const login=async(subject)=>{const response=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({subject,password:pass,tenantId:tenant})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];return {cookie,...await(await fetch(origin+'/api/v1/auth/session',{headers:{origin,cookie}})).json()};};
 const actor=await login(subject),requestId=randomUUID(),datasetDigest=createHash('sha256').update('public synthetic input').digest('hex'),input={requestId,datasetDigest,processingConsent:true};
 const request=(a=actor,body=input,extra={},targetTenant=tenant,targetArtwork=artwork)=>fetch(`${origin}/api/v1/tenants/${targetTenant}/artworks/${targetArtwork}/processing-authorization`,{method:'POST',headers:{origin,'content-type':'application/json',cookie:a.cookie,'x-csrf-token':a.csrfToken,...extra},body:JSON.stringify(body),redirect:'manual'});
 const expect=async(promise,status,label)=>{const response=await promise;assert.equal(response.status,status,await response.clone().text());checks.push(label);return response;};
 const success=await expect(request(),200,'current admin/session/artwork/export rights and explicit consent accepted');assert.equal(success.headers.get('cache-control'),'no-store');const observation=await success.json();
 assert.equal(observation.datasetDigest,datasetDigest);assert.equal(observation.requestId,requestId);assert.equal(observation.subjectId,admin.userId);assert.equal(observation.tenantId,tenant);assert.equal(observation.origin,origin);assert.equal(observation.artworkId,artwork);assert.equal(observation.capability,false);assert.equal(observation.jobCreated,false);assert(Date.parse(observation.expiresAt)-Date.parse(observation.checkedAt)<=30000);assert(Date.parse(observation.expiresAt)<=Date.parse(actor.expiresAt));checks.push('exact identity/digest/nonce binding, bounded expiry and no-store; no capability/job');
 await expect(request({cookie:'invalid=synthetic',csrfToken:'invalid'}),401,'invalid session denied');
 for(const headers of [{'x-csrf-token':'wrong'},{origin:'https://foreign.test'}])await expect(request(actor,input,headers),403,'wrong CSRF/Origin/Host denied');
 const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(origin+`/api/v1/tenants/${tenant}/artworks/${artwork}/processing-authorization`,{method:'POST',headers:{host:'foreign.test',origin,cookie:actor.cookie,'x-csrf-token':actor.csrfToken,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(input));});assert.equal(hostStatus,403);checks.push('actual wire Host mismatch denied');
 await expect(request(actor,input,{},randomUUID()),403,'foreign tenant denied');await expect(request(actor,input,{},tenant,randomUUID()),403,'unknown artwork denied');
 for(const body of [{...input,processingConsent:false},{...input,subjectId:admin.userId},{...input,datasetDigest:'bad'},{...input,requestId:'bad'}])await expect(request(actor,body),400,'closed body/consent/digest/nonce validation');
 const actors={};for(const role of ['artist','curator','viewer']){
 const s='synthetic.input.'+role,response=await fetch(`${origin}/api/v1/tenants/${tenant}/users`,{method:'POST',headers:{origin,cookie:actor.cookie,'x-csrf-token':actor.csrfToken,'content-type':'application/json'},body:JSON.stringify({subject:s,password:pass,role})});assert.equal(response.status,201);actors[role]=await login(s);await expect(request(actors[role]),403,role+' foreign artwork denied');
 }
 await pool.query('UPDATE artists SET user_id=$1 WHERE id=$2',[actors.artist.userId,artistId]);await expect(request(actors.artist),200,'owning artist accepted');
 await pool.query("UPDATE memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",[tenant,actors.artist.userId]);await expect(request(actors.artist),403,'current role change invalidates observation request');
 for(const grant of [{...rights,permissions:{...rights.permissions,export:false}},{...rights,expiresAt:'2000-01-01T00:00:00Z'},{...rights,validFrom:'2999-01-01T00:00:00Z'},{...rights,expiresAt:'2027-02-30T00:00:00Z'},{}]){await pool.query('UPDATE artworks SET metadata=$1 WHERE id=$2',[{rights:grant},artwork]);await expect(request(),403,'revoked/expired/future/malformed rights denied');}
 const until=new Date(Date.now()+15000).toISOString();await pool.query('UPDATE artworks SET metadata=$1 WHERE id=$2',[{rights:{...rights,expiresAt:until}},artwork]);const limited=await(await expect(request(),200,'rights expiry limits observation')).json();assert(Date.parse(limited.expiresAt)<=Date.parse(until));assert.notEqual(limited.rightsDigest,observation.rightsDigest);
 await pool.query('UPDATE artworks SET deleted_at=now() WHERE id=$1',[artwork]);await expect(request(),403,'archived artwork denied');
 await pool.query('UPDATE auth_sessions SET revoked=true WHERE id=$1',[actor.id]);await expect(request(),401,'session revocation denied');
 assert.equal((await pool.query('SELECT count(*) n FROM import_jobs')).rows[0].n,'0');assert.equal((await pool.query('SELECT count(*) n FROM assets')).rows[0].n,'0');checks.push('no import/job/asset side effects');
 console.log(JSON.stringify({state:'PASS',scope:'real HTTP and PostgreSQL current policy observation only; not persistent authenticated ingest or physical copyright proof',checks,postgresImage:image,newVolumes:0,newImages:0,secretsLogged:false}));
}finally{if(app)await app.close();if(pool)await pool.end();if(started){assert.equal(docker('inspect',name,'--format','{{index .Config.Labels "exhibitos.authorization.test"}}'),name);docker('rm','-f',name);}}
