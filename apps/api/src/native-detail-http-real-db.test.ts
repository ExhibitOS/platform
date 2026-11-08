// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {expect,it} from 'vitest';
import {Pool} from 'pg';
import {migrate} from '@exhibitos/storage';
import {revisionHash} from '@exhibitos/spec';
import {Auth,ApiError} from './auth.ts';
import {registerNativeDetailHttp} from './native-detail-http.ts';

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

it.skipIf(!process.env.NATIVE_DETAIL_TEST_PG)('actual socket disconnect keeps an admitted detail scope charged until it settles',async()=>{
 const pool=new Pool({connectionString:process.env.NATIVE_DETAIL_TEST_PG,max:5}),tenantId=randomUUID(),userId=randomUUID(),sessionId=randomUUID(),publicationId=randomUUID(),jobId=randomUUID(),token='a'.repeat(43),csrf='detail-csrf',hash=(v:string)=>createHash('sha256').update(v).digest('hex'),entered=deferred(),release=deferred();
 const app=Fastify();app.setErrorHandler((error,_request,reply)=>{const status=error instanceof ApiError?error.status:500,code=error instanceof ApiError?error.code:'INTERNAL_ERROR';return reply.code(status).send({code});});let calls=0;
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[sessionId,hash(token),hash(csrf),csrf,tenantId,userId]);
  const exhibitionId=randomUUID(),snapshot={artworks:[]};const revision=revisionHash(snapshot as never);
  await pool.query('INSERT INTO exhibitions(tenant_id,id,metadata,studio_managed,studio_owner_user_id) VALUES($1,$2,$3,true,$4)',[tenantId,exhibitionId,{},userId]);
  await pool.query('INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256) VALUES($1,$2,$3,1,$4,$5,$6)',[tenantId,publicationId,exhibitionId,userId,snapshot,revision]);await pool.query("INSERT INTO publication_states(publication_id,status) VALUES($1,'published')",[publicationId]);
  const owner={workspaceId:randomUUID(),tenantId,principalId:userId,assertDatabase:async()=>{if(++calls===2){entered.release();await release.promise;}}};
  registerNativeDetailHttp(app,{auth:new Auth(pool),context:{owner,runtimeGeneration:randomUUID(),live:()=>true},guard:()=>{},token:request=>request.headers.cookie?.replace('exhibitos_local_session=','')});
  const origin=await app.listen({host:'127.0.0.1',port:0}),base=`${origin}/api/v1/tenants/${tenantId}/studio/publications/${publicationId}/native-detail-export`,headers={'content-type':'application/json',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},controller=new AbortController();
  const pending=fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify({version:1,jobId,revisionSha256:revision}),signal:controller.signal}).catch(()=>undefined);
  await entered.promise;controller.abort();await pending;
  const status=async()=>(await (await fetch(`${base}/operations/${jobId}`,{headers})).json()) as {state:string};
  expect((await status()).state).toBe('pending');release.release();
  let state='pending';for(let i=0;i<100&&state==='pending';i++){await new Promise(resolve=>setTimeout(resolve,20));state=(await status()).state;}expect(state).toBe('settled-failure');
  const closedJob=randomUUID(),closed={version:1,jobId:closedJob,revisionSha256:revision};expect((await fetch(`${base}/close`,{method:'POST',headers,body:JSON.stringify(closed)})).status).toBe(200);expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify(closed)})).status).toBe(409);
  expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:`{"version":1,"version":1,"jobId":"${randomUUID()}","revisionSha256":"${revision}"}`})).status).toBe(400);
  const currentJob=randomUUID(),initial={version:1,jobId:currentJob,revisionSha256:revision};expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify(initial)})).status).toBe(200);
  const terminal={...initial,detailCount:0,detailSetSha256:hash('[]')};let finish=await fetch(`${base}/final-check`,{method:'POST',headers,body:JSON.stringify(terminal)});if(finish.status===409){expect((await finish.json() as {code:string}).code).toBe('NATIVE_DETAIL_BUSY');await new Promise(resolve=>setTimeout(resolve,20));finish=await fetch(`${base}/final-check`,{method:'POST',headers,body:JSON.stringify(terminal)});}expect(finish.status).toBe(200);
  let finalState='pending';for(let i=0;i<100&&finalState==='pending';i++){await new Promise(resolve=>setTimeout(resolve,20));finalState=((await (await fetch(`${base}/operations/${currentJob}`,{headers})).json()) as {state:string}).state;}expect(finalState).toBe('settled-success');
 }finally{release.release();await app.close();await pool.end();}
},120000);
