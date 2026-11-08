// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {FileBlobStore,migrate,transaction} from '@exhibitos/storage';
import {revisionHash} from '@exhibitos/spec';
import {buildApp} from './app.ts';
import {bindNativeLocalExportWorkspace} from './native-oex-provenance.ts';
import {bindNativeDetailContext} from './native-detail-context.ts';

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function unusedPort(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('port');const port=address.port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;}

it.skipIf(!process.env.NATIVE_DETAIL_TEST_PG)('issued native context mounts the guarded route and keeps a disconnected socket charged',async()=>{
 const pool=new Pool({connectionString:process.env.NATIVE_DETAIL_TEST_PG,max:5}),root=await mkdtemp(join(tmpdir(),'exhibitos-detail-owner-')),blobRoot=join(root,'blobs'),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),sessionId=randomUUID(),publicationId=randomUUID(),jobId=randomUUID(),token=randomBytes(32).toString('base64url'),csrf='detail-csrf',sha=(v:string)=>createHash('sha256').update(v).digest('hex'),entered=deferred(),release=deferred(),channelEntered=deferred(),channelRelease=deferred();
 let app:ReturnType<typeof buildApp>|undefined,live=true,gate:{entered:ReturnType<typeof deferred>;release:ReturnType<typeof deferred>}|undefined={entered,release};
 try{
  await mkdir(blobRoot,{mode:0o700});await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,process.getuid!()]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[sessionId,sha(token),sha(csrf),csrf,tenantId,userId]);
  const exhibitionId=randomUUID(),snapshot={artworks:[]},revision=revisionHash(snapshot as never);await pool.query('INSERT INTO exhibitions(tenant_id,id,metadata,studio_managed,studio_owner_user_id) VALUES($1,$2,$3,true,$4)',[tenantId,exhibitionId,{},userId]);await pool.query('INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256) VALUES($1,$2,$3,1,$4,$5,$6)',[tenantId,publicationId,exhibitionId,userId,snapshot,revision]);await pool.query("INSERT INTO publication_states(publication_id,status) VALUES($1,'published')",[publicationId]);
  const owner=await transaction(pool,c=>bindNativeLocalExportWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid:process.getuid!(),blobRoot})),ownerChannel=new AbortController(),detail=bindNativeDetailContext(owner,randomUUID(),ownerChannel.signal,()=>live);
  const delayed=new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(inner,name){if(name==='query')return async(...args:unknown[])=>{if(gate&&typeof args[0]==='string'&&args[0].startsWith('SELECT p.*,st.status,e.studio_owner_user_id')){const held=gate;gate=undefined;held.entered.release();await held.release.promise;}return (inner.query as (...values:unknown[])=>unknown).apply(inner,args);};const value=Reflect.get(inner,name,inner);return typeof value==='function'?value.bind(inner):value;}}) as PoolClient;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as Pool;
  const port=await unusedPort(),origin=`http://127.0.0.1:${port}`,auth={mode:'local' as const,origin,bindHost:'127.0.0.1'};expect(()=>buildApp({pool:delayed,auth,blobs:new FileBlobStore(join(root,'wrong')),nativeExportWorkspace:owner,nativeDetailContext:detail})).toThrow('NATIVE_DETAIL_CONFIGURATION');app=buildApp({pool:delayed,auth,blobs:new FileBlobStore(blobRoot),nativeExportWorkspace:owner,nativeDetailContext:detail});app.addHook('onRequest',async(request,reply)=>{if(request.headers['x-test-write-failure']==='1')reply.raw.writeHead=(()=>{throw Error('synthetic write failure');}) as typeof reply.raw.writeHead;});await app.listen({host:'127.0.0.1',port});
  const base=`${origin}/api/v1/tenants/${tenantId}/studio/publications/${publicationId}/native-detail-export`,headers={'content-type':'application/json',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},controller=new AbortController();
  expect((await fetch(`${base}/operations/${jobId}`,{headers:{...headers,origin:'http://attacker.invalid'}})).status).toBe(403);
  const pending=fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify({version:1,jobId,revisionSha256:revision}),signal:controller.signal}).catch(()=>undefined);await entered.promise;controller.abort();await pending;
  const status=async(id=jobId)=>(await (await fetch(`${base}/operations/${id}`,{headers})).json()) as {state:string};expect((await status()).state).toBe('pending');release.release();
  let state='pending';for(let i=0;i<100&&state==='pending';i++){await new Promise(resolve=>setTimeout(resolve,20));state=(await status()).state;}expect(state).toBe('settled-failure');
  const closedJob=randomUUID(),closed={version:1,jobId:closedJob,revisionSha256:revision};expect((await fetch(`${base}/close`,{method:'POST',headers,body:JSON.stringify(closed)})).status).toBe(200);expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify(closed)})).status).toBe(409);
  expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:`{"version":1,"version":1,"jobId":"${randomUUID()}","revisionSha256":"${revision}"}`})).status).toBe(400);
  const currentJob=randomUUID(),initial={version:1,jobId:currentJob,revisionSha256:revision};expect((await fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify(initial)})).status).toBe(200);
  const terminal={...initial,detailCount:0,detailSetSha256:sha('[]')};let finish=await fetch(`${base}/final-check`,{method:'POST',headers,body:JSON.stringify(terminal)});if(finish.status===409){expect((await finish.json() as {code:string}).code).toBe('NATIVE_DETAIL_BUSY');await new Promise(resolve=>setTimeout(resolve,20));finish=await fetch(`${base}/final-check`,{method:'POST',headers,body:JSON.stringify(terminal)});}expect(finish.status).toBe(200);
  let finalState='pending';for(let i=0;i<100&&finalState==='pending';i++){await new Promise(resolve=>setTimeout(resolve,20));finalState=(await status(currentJob)).state;}expect(finalState).toBe('settled-success');
  const failedJob=randomUUID();await fetch(`${base}/prepare`,{method:'POST',headers:{...headers,'x-test-write-failure':'1'},body:JSON.stringify({version:1,jobId:failedJob,revisionSha256:revision})}).catch(()=>undefined);let failedState='pending';for(let i=0;i<100&&failedState==='pending';i++){await new Promise(resolve=>setTimeout(resolve,20));failedState=(await status(failedJob)).state;}expect(failedState).toBe('settled-failure');
  const channelJob=randomUUID();gate={entered:channelEntered,release:channelRelease};const channelPending=fetch(`${base}/prepare`,{method:'POST',headers,body:JSON.stringify({version:1,jobId:channelJob,revisionSha256:revision})}).catch(()=>undefined);await channelEntered.promise;live=false;ownerChannel.abort();channelRelease.release();expect((await channelPending)?.status).not.toBe(200);expect((await fetch(`${base}/operations/${jobId}`,{headers})).status).toBe(409);await app.close();app=undefined;
 }finally{release.release();channelRelease.release();if(app)await app.close();await pool.end();await rm(root,{recursive:true,force:true});}
},120000);
