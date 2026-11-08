// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {expect,it} from 'vitest';
import {FileBlobStore,migrate,transaction,type BlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {Auth,digest,type Session} from './auth.ts';
import {createNativeHayesCaller,isIssuedNativeHayesCaller} from './native-hayes-caller.ts';
import {bindNativeOexWorkspace,assertIssuedWorkspaceImport,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {publicationDiskOwner} from './publication-attempt.ts';
import {bindHayesOriginalContext,createHayesOriginalQuarantine,openHayesOriginalAttempt,revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {Imports} from './imports.ts';

it.skipIf(!process.env.HAYES_TEST_PG||!process.env.EXHIBITOS_HAYES_ORIGINAL)('retains a native claim across expiry, rejects stale owners and leaves ordinary imports usable',async()=>{
 const pool=new Pool({connectionString:process.env.HAYES_TEST_PG}),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID();let jobId:string=randomUUID();
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic'};
 const b={version:1 as const,tenantId,workspaceId,principalId:userId,jobId,leaseId:randomUUID(),attemptId:randomUUID(),runtimeGeneration:randomUUID(),artworkId,correlationId:randomUUID(),artworkRevision:1,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096};
 const source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!),sourceObjects=new Map<string,Buffer>();const blobs={put:async(key:string,value:Buffer)=>{sourceObjects.set(key,Buffer.from(value));},getBounded:async(key:string)=>Buffer.from(sourceObjects.get(key)??Buffer.from('x')),get:async(key:string)=>Buffer.from(sourceObjects.get(key)??Buffer.from('x'))} as unknown as BlobStore;
 const initialDisplay='d'.repeat(64),metadata=(r:unknown,display=initialDisplay)=>({rights:r,displayReference:{status:'provisional-uncalibrated',assetSha256:display},provenance:{sourceUnits:'unknown',scaleApplied:false}});
 const root=await realpath(await mkdtemp(join(tmpdir(),'hayes-042-owner-'))),s={id:randomUUID(),tenantId,userId,role:'admin'} as Session;
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  expect(await new Imports(pool,blobs).work()).toBe(false);
  await migrate(pool,new URL('../../../database/native-oex-normal/',import.meta.url).pathname);
  await migrate(pool,new URL('../../../database/native-oex-workspace-import/',import.meta.url).pathname);
  await pool.query(await readFile(new URL('../../../database/native-hayes-original/042_hayes_original_attempt.sql',import.meta.url),'utf8'));
  await pool.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',['042_hayes_original_attempt.sql','074de4171572039f2f400d49d07aff8a3ec83ec222c1684cbc5452c6cc8b3ece']);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'test']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,process.getuid!()]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'test'}]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artworkId,artistId,metadata(rights)]);
  const owner=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid:process.getuid!(),blobRoot:root,workspaceImport:true}));
  const disk=await transaction(pool,c=>publicationDiskOwner(c,root));expect(()=>assertIssuedWorkspaceImport(owner,disk)).not.toThrow();
  await expect(transaction(pool,c=>bindHayesOriginalContext(c,{...owner} as NativeOexWorkspaceContext))).rejects.toMatchObject({code:'FORBIDDEN'});
  const bound=await transaction(pool,c=>bindHayesOriginalContext(c,owner));expect(bound).toBe(owner);expect(()=>assertIssuedWorkspaceImport(bound,disk)).not.toThrow();
  const initial=await transaction(pool,c=>createHayesOriginalQuarantine(c,s,bound,{artworkId,artworkRevision:1,displayReferenceSha256:initialDisplay,idempotencyKey:randomUUID()}));jobId=initial.id;b.jobId=jobId;await transaction(pool,c=>new Imports(pool,blobs,bound).upload(c,s,jobId,source));await transaction(pool,c=>new Imports(pool,blobs,bound).complete(c,s,jobId));
  expect(await new Imports(pool,blobs).work()).toBe(false);
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{},Date.now()-1))).rejects.toThrow('HAYES_OWNER_UNAVAILABLE');
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{},Date.now()+301000))).rejects.toThrow('HAYES_OWNER_UNAVAILABLE');
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{throw Error('owner lost');}))).rejects.toThrow('owner lost');
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_original_attempts')).rows[0].n).toBe(0);
  let calls=0;await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{if(++calls===3)throw Error('late owner lost');}))).rejects.toThrow('late owner lost');
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_original_attempts')).rows[0].n).toBe(0);expect((await pool.query('SELECT state FROM import_jobs WHERE id=$1',[jobId])).rows[0].state).toBe('queued');
  const expiring={...rights,expiresAt:new Date(Date.now()+1000).toISOString()};await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,metadata(expiring)]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,expiring]);
  let rightCalls=0,delayed=false;await expect(transaction(pool,c=>{const wrapped=new Proxy(c,{get(target,key){if(key==='query')return async (...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('SELECT 1 FROM import_jobs WHERE tenant_id=')){delayed=true;await new Promise(resolve=>setTimeout(resolve,1200));}return Reflect.apply(target.query,target,args);};return Reflect.get(target,key,target);}});return openHayesOriginalAttempt(wrapped,s,bound,blobs,b,async()=>{rightCalls++;});})).rejects.toThrow('HAYES_SOURCE_CHANGED');expect(rightCalls).toBe(3);expect(delayed).toBe(true);
  await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,metadata(rights)]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,rights]);
  await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,metadata(rights,'e'.repeat(64))]);await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,metadata(rights)]);
  await pool.query('UPDATE artworks SET revision=2 WHERE id=$1',[artworkId]);
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  await pool.query('UPDATE artworks SET revision=1 WHERE id=$1',[artworkId]);
  const expiringRecheck={...rights,expiresAt:new Date(Date.now()+1000).toISOString()};await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,metadata(expiringRecheck)]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,expiringRecheck]);
  await transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}));
  await transaction(pool,c=>revalidateHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}));
  await expect(transaction(pool,c=>revalidateHayesOriginalAttempt(c,s,bound,blobs,{...b,runtimeGeneration:randomUUID()},async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  let delayedRecheck=false;await expect(transaction(pool,c=>{const wrapped=new Proxy(c,{get(target,key){if(key==='query')return async (...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('SELECT 1 FROM import_jobs WHERE tenant_id=')){delayedRecheck=true;await new Promise(resolve=>setTimeout(resolve,1200));}return Reflect.apply(target.query,target,args);};return Reflect.get(target,key,target);}});return revalidateHayesOriginalAttempt(wrapped,s,bound,blobs,b,async()=>{});})).rejects.toThrow('HAYES_SOURCE_CHANGED');expect(delayedRecheck).toBe(true);
  // The selected stage catalog is inert until a separate runtime capability
  // admits it. Test the DB reservation on this isolated database only.
  await pool.query(await readFile(new URL('../../../database/native-hayes-disposition/043_hayes_output_stage.sql',import.meta.url),'utf8'));
  const stageId=randomUUID(),outputHash='b'.repeat(64),stageKey=`${tenantId}/hayes-output/${b.attemptId}/${outputHash}`;
  await pool.query('ALTER TABLE import_jobs DISABLE TRIGGER hayes_original_job_guard');await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1",[jobId]);await pool.query('ALTER TABLE import_jobs ENABLE TRIGGER hayes_original_job_guard');
  const blocker=await pool.connect(),waiter=await pool.connect();try{
   await blocker.query('BEGIN');await blocker.query('SELECT id FROM import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,jobId]);
   const waiterPid=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const waiting=waiter.query('INSERT INTO hayes_output_stages(tenant_id,id,attempt_id,job_id,output_sha256,output_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,randomUUID(),b.attemptId,jobId,outputHash,123,stageKey]);
   const rejected=expect(waiting).rejects.toThrow('Hayes output stage owner invalid');
   let locked=false;for(let i=0;i<50&&!locked;i++){locked=(await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[waiterPid])).rows[0]?.waiting===true;if(!locked)await new Promise(resolve=>setTimeout(resolve,10));}expect(locked).toBe(true);
   await new Promise(resolve=>setTimeout(resolve,1200));await blocker.query('COMMIT');await rejected;
  }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();waiter.release();}
  await pool.query('ALTER TABLE import_jobs DISABLE TRIGGER hayes_original_job_guard');await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",[jobId]);await pool.query('ALTER TABLE import_jobs ENABLE TRIGGER hayes_original_job_guard');
  await expect(pool.query('INSERT INTO hayes_output_stages(tenant_id,id,attempt_id,job_id,output_sha256,output_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,randomUUID(),b.attemptId,jobId,outputHash,123,`${tenantId}/wrong/key`])).rejects.toThrow();
  await pool.query('INSERT INTO hayes_output_stages(tenant_id,id,attempt_id,job_id,output_sha256,output_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,stageId,b.attemptId,jobId,outputHash,123,stageKey]);
  // Synthetic DB-only receipt: structural referential checks are not an
  // attestation, blob validation, native drain, or actual asset registration.
  const originalId=randomUUID(),displayId=randomUUID(),derivativeId=randomUUID(),rightsId=randomUUID(),receiptId=randomUUID();
  const makeReceipt=async(c:PoolClient,receiptHash=createHash('sha256').update('synthetic').digest('hex'))=>{
   const current=(await c.query('SELECT rights,object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,jobId])).rows[0];
   await c.query("UPDATE artworks SET metadata=jsonb_set(metadata,'{displayReference,assetSha256}',to_jsonb($2::text)) WHERE tenant_id=$1 AND id=$3",[tenantId,outputHash,artworkId]);
   await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,current.rights]);
   await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'quarantine')",[tenantId,originalId,artworkId,rightsId,current.object_key,b.sourceSha256,b.sourceBytes]);
   await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,123,'model/gltf-binary',1,'approved')",[tenantId,displayId,artworkId,rightsId,stageKey,outputHash]);
   await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,derivativeId,originalId,{kind:'hayes-original-display-v1',originalAssetId:originalId,displayAssetId:displayId,attemptId:b.attemptId,outputSha256:outputHash}]);
   await c.query('INSERT INTO hayes_original_dispositions(tenant_id,id,attempt_id,job_id,stage_id,native_owner_id,database_system_identifier,database_oid,runtime_manifest_sha256,worker_manifest_sha256,native_evidence_sha256,attestation,receipt_canonical,receipt_sha256,original_asset_id,display_asset_id,derivative_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$10,$11,$12,$13,$14,$15)',[tenantId,receiptId,b.attemptId,jobId,stageId,randomUUID(),'1','1','c'.repeat(64),{},Buffer.from('synthetic'),receiptHash,originalId,displayId,derivativeId]);
  };
  await expect(transaction(pool,c=>makeReceipt(c,'0'.repeat(64)))).rejects.toThrow('check constraint');
  await expect(transaction(pool,async c=>{await makeReceipt(c);await c.query('SET CONSTRAINTS ALL IMMEDIATE');})).rejects.toThrow('Hayes disposition incomplete');
  await expect(transaction(pool,async c=>{await makeReceipt(c);await c.query("UPDATE import_jobs SET state='approved',progress=100,asset_id=$3,approved_key=$4,hayes_disposition_id=$5 WHERE tenant_id=$1 AND id=$2",[tenantId,jobId,displayId,stageKey,receiptId]);await c.query('SET CONSTRAINTS ALL IMMEDIATE');throw Error('synthetic receipt rollback');})).rejects.toThrow('synthetic receipt rollback');
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_original_dispositions')).rows[0].n).toBe(0);
  await expect(pool.query('DELETE FROM hayes_output_stages WHERE id=$1',[stageId])).rejects.toThrow('verified disposition');
  await expect(pool.query('UPDATE hayes_output_stages SET output_bytes=124 WHERE id=$1',[stageId])).rejects.toThrow('verified disposition');
  await expect(pool.query('INSERT INTO hayes_output_stages(tenant_id,id,attempt_id,job_id,output_sha256,output_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,randomUUID(),b.attemptId,jobId,outputHash,123,stageKey])).rejects.toThrow();
  await expect(pool.query("UPDATE import_jobs SET lease_id=NULL WHERE id=$1",[jobId])).rejects.toThrow('Hayes owner unresolved');
  await expect(pool.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,state,hayes_attempt_id) VALUES($1,$2,$3,$4,'forged','hash','model/gltf-binary',$5,$6,$7,$8,$9,1,'queued',$10)",[tenantId,randomUUID(),userId,artworkId,b.sourceSha256,b.sourceBytes,rights,`${tenantId}/quarantine/fake`,`${tenantId}/approved/fake`,b.attemptId])).rejects.toThrow('claimed after upload');
  await expect(pool.query('DELETE FROM hayes_original_attempts WHERE id=$1',[b.attemptId])).rejects.toThrow('verified disposition');
  await pool.query('ALTER TABLE import_jobs DISABLE TRIGGER hayes_original_job_guard');await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[jobId]);await pool.query('ALTER TABLE import_jobs ENABLE TRIGGER hayes_original_job_guard');
  const other=randomUUID();await pool.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,state) VALUES($1,$2,$3,$4,'other','hash','model/gltf-binary',$5,1,$6,$7,$8,1,'queued')",[tenantId,other,userId,artworkId,'a'.repeat(64),rights,`${tenantId}/quarantine/other`,`${tenantId}/approved/other`]);
  expect(await new Imports(pool,blobs).work()).toBe(true);expect((await pool.query('SELECT state FROM import_jobs WHERE id=$1',[other])).rows[0].state).toBe('failed');
  expect(await new Imports(pool,blobs,bound).work()).toBe(false);expect(await new Imports(pool,blobs).work()).toBe(false);
  await expect(transaction(pool,c=>revalidateHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  const row=(await pool.query('SELECT * FROM import_jobs WHERE id=$1',[jobId])).rows[0];expect(row.lease_id).toBe(b.leaseId);expect(row.hayes_attempt_id).toBe(b.attemptId);
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  await transaction(pool,c=>new Imports(pool,blobs,bound).action(c,s,jobId,'cancel'));
  const cancelled=(await pool.query('SELECT * FROM import_jobs WHERE id=$1',[jobId])).rows[0];expect(cancelled.state).toBe('cancelled');expect(cancelled.lease_id).toBe(b.leaseId);
  await expect(transaction(pool,c=>new Imports(pool,blobs,bound).action(c,s,jobId,'retry'))).rejects.toThrow('WORKER_DRAIN_UNCONFIRMED');
  const provisional=randomUUID(),display='b'.repeat(64),request={artworkId:provisional,artworkRevision:1,displayReferenceSha256:display,idempotencyKey:randomUUID()};
  await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,provisional,artistId,{rights,displayReference:{status:'provisional-uncalibrated',assetSha256:display},provenance:{sourceUnits:'unknown',scaleApplied:false}}]);
  const objects=new Map<string,Buffer>(),store={put:async(key:string,bytes:Buffer)=>{objects.set(key,Buffer.from(bytes));},get:async(key:string)=>{const bytes=objects.get(key);if(!bytes)throw Error('missing');return Buffer.from(bytes);},getBounded:async(key:string)=>{const bytes=objects.get(key);if(!bytes)throw Error('missing');return Buffer.from(bytes);}} as unknown as BlobStore,imports=new Imports(pool,store,bound);
  await expect(transaction(pool,c=>imports.create(c,s,{artworkId:provisional,idempotencyKey:randomUUID(),mime:'model/gltf-binary',sha256:b.sourceSha256,bytes:b.sourceBytes,scaleMeters:1,rights}))).rejects.toThrow('PROVISIONAL_ASSET_MISMATCH');
  const created=await transaction(pool,c=>createHayesOriginalQuarantine(c,s,bound,request));expect(created.state).toBe('uploading');expect(await transaction(pool,c=>createHayesOriginalQuarantine(c,s,bound,{idempotencyKey:request.idempotencyKey,displayReferenceSha256:display,artworkRevision:1,artworkId:provisional}))).toEqual(created);
  await expect(transaction(pool,c=>createHayesOriginalQuarantine(c,s,bound,{...request,displayReferenceSha256:'c'.repeat(64)}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  await expect(transaction(pool,c=>imports.upload(c,s,created.id,Buffer.from('wrong')))).rejects.toThrow('UPLOAD_INTEGRITY');await transaction(pool,c=>imports.upload(c,s,created.id,source));await transaction(pool,c=>imports.complete(c,s,created.id));
  expect(await imports.work()).toBe(false);const quarantine=(await pool.query('SELECT state,object_key,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,created.id])).rows[0];expect(quarantine.state).toBe('queued');expect(quarantine.asset_id).toBeNull();expect(quarantine.object_key).toContain('/quarantine/');
  const token=randomBytes(32).toString('base64url'),csrf='hayes-caller-test',runtimeGeneration=randomUUID(),nativeOwnerId=randomUUID(),runtimeManifestSha256='a'.repeat(64),challenge=randomUUID(),events:string[]=[],pending:Buffer[]=[];let active=true,controlBinding:Record<string,unknown>|undefined,total=0;const sourceDigest=createHash('sha256'),frame=(v:unknown)=>Buffer.from(JSON.stringify(v));
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),digest(token),digest(csrf),csrf,tenantId,userId]);
  const channel={isOpen:()=>active,close:async()=>{active=false;events.push('close');},receive:async()=>{const item=pending.shift();if(!item)throw Error('EOF');return item;},send:async(raw:Uint8Array)=>{const message=JSON.parse(Buffer.from(raw).toString()) as Record<string,unknown>;
   if(message.kind==='hayes-operation-open'){controlBinding=message.binding as Record<string,unknown>;events.push('open');pending.push(frame({version:1,kind:'hayes-operation-open-accepted',binding:controlBinding,nativeOwnerId,runtimeManifestSha256}));}
   if(message.kind==='hayes-transfer-data'&&message.direction==='source'){const part=Buffer.from(String(message.data),'base64');expect(message.offset).toBe(total);total+=part.length;sourceDigest.update(part);}
   if(message.kind==='hayes-transfer-end'&&message.direction==='source'){expect(total).toBe(b.sourceBytes);expect(sourceDigest.digest('hex')).toBe(b.sourceSha256);events.push('source');pending.push(frame({version:1,kind:'hayes-transfer-accepted',attemptId:controlBinding!.attemptId,correlationId:controlBinding!.correlationId,direction:'source',bytes:total,sha256:b.sourceSha256}),frame({version:1,kind:'hayes-operation-revalidate',binding:controlBinding,challenge,runtimeManifestSha256}));}
   if(message.kind==='hayes-operation-revalidated')events.push('revalidated');
  }};
  const caller=createNativeHayesCaller({owner:bound,auth:new Auth(pool),blobs:store,channel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal:new AbortController().signal,assertLive:async()=>{}});
  const fileStore=new FileBlobStore(root),routeChannel={isOpen:()=>true,close:async()=>{},receive:async()=>{throw Error('unused');},send:async()=>{}},routeCaller=createNativeHayesCaller({owner:bound,auth:new Auth(pool),blobs:fileStore,channel:routeChannel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal:new AbortController().signal,assertLive:async()=>{}});let ready=true;
  const appConfig={pool,blobs:fileStore,nativeOexWorkspace:bound,nativeHayesCaller:routeCaller,runtimeAvailable:()=>ready,auth:{mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}};expect(()=>buildApp({...appConfig,blobs:new FileBlobStore(join(root,'other'))})).toThrow('HAYES_OWNER_CONFIGURATION');expect(()=>buildApp({...appConfig,runtimeAvailable:undefined})).toThrow('HAYES_OWNER_CONFIGURATION');
  const app=buildApp(appConfig),headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},url=`/api/v1/tenants/${tenantId}/imports/native-hayes-original`,routeRequest={...request,idempotencyKey:randomUUID()};
  try{
   expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://evil.example'},payload:routeRequest})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url,headers:{...headers,cookie:'exhibitos_local_session=invalid'},payload:routeRequest})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url,headers,payload:{...routeRequest,nativeOwnerId}})).statusCode).toBe(400);
   ready=false;expect((await app.inject({method:'POST',url,headers,payload:routeRequest})).statusCode).toBe(503);ready=true;
   const response=await app.inject({method:'POST',url,headers,payload:routeRequest});expect(response.statusCode).toBe(200);expect(response.json().state).toBe('uploading');expect((await app.inject({method:'POST',url,headers,payload:routeRequest})).json()).toEqual(response.json());
   expect((await app.inject({method:'POST',url:`${url}/${response.json().id}/start`,headers,payload:{artworkId:provisional,artworkRevision:1}})).statusCode).toBe(404);
  }finally{await app.close();await routeCaller.close();}

  expect(isIssuedNativeHayesCaller(caller,bound,store)).toBe(true);expect(isIssuedNativeHayesCaller({...caller},bound,store)).toBe(false);expect(()=>createNativeHayesCaller({owner:bound,auth:new Auth(pool),blobs:store,channel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal:new AbortController().signal,assertLive:async()=>{}})).toThrow();
  await expect(caller.start({token:randomBytes(32).toString('base64url'),csrf},{jobId:created.id,artworkId:provisional,artworkRevision:1},Date.now()+30000)).rejects.toMatchObject({code:'AUTH_REQUIRED'});expect(events).toEqual([]);expect(active).toBe(true);
  const operationDeadline=Date.now()+90000,exchange=await caller.start({token,csrf},{jobId:created.id,artworkId:provisional,artworkRevision:1},operationDeadline);expect(events).toEqual(['open','source','revalidated']);
  const activeJob=(await pool.query('SELECT state,lease_id,lease_until,hayes_attempt_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,created.id])).rows[0];expect(activeJob.state).toBe('processing');expect(activeJob.lease_id).toBeTruthy();expect(activeJob.hayes_attempt_id).toBeTruthy();expect(activeJob.lease_until.getTime()).toBeLessThanOrEqual(operationDeadline);expect(activeJob.lease_until.getTime()).toBeGreaterThan(Date.now()+30000);
  await exchange.close();await caller.close();expect(events.filter(x=>x==='close')).toHaveLength(1);
  const secondRequest={...request,idempotencyKey:randomUUID()},second=await transaction(pool,c=>createHayesOriginalQuarantine(c,s,bound,secondRequest));await transaction(pool,c=>imports.upload(c,s,second.id,source));await transaction(pool,c=>imports.complete(c,s,second.id));
  const interrupted=new AbortController(),outcomes:string[]=[],incoming:Buffer[]=[];let commits=0,secondBinding:Record<string,unknown>|undefined,open=true;
  const delayedPool=new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){if(k==='query')return async (...args:unknown[])=>{const result=await Reflect.apply(c.query,c,args);if(args[0]==='COMMIT'&&++commits===4)interrupted.abort();return result;};const value=Reflect.get(c,k,c);return typeof value==='function'?value.bind(c):value;}}) as PoolClient;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const secondChannel={isOpen:()=>open,close:async()=>{open=false;outcomes.push('close');},receive:async()=>{const item=incoming.shift();if(!item)throw Error('EOF');return item;},send:async(raw:Uint8Array)=>{const m=JSON.parse(Buffer.from(raw).toString()) as Record<string,unknown>;
   if(m.kind==='hayes-operation-open'){secondBinding=m.binding as Record<string,unknown>;incoming.push(frame({version:1,kind:'hayes-operation-open-accepted',binding:secondBinding,nativeOwnerId,runtimeManifestSha256}));}
   if(m.kind==='hayes-transfer-end'&&m.direction==='source')incoming.push(frame({version:1,kind:'hayes-transfer-accepted',attemptId:secondBinding!.attemptId,correlationId:secondBinding!.correlationId,direction:'source',bytes:b.sourceBytes,sha256:b.sourceSha256}),frame({version:1,kind:'hayes-operation-revalidate',binding:secondBinding,challenge,runtimeManifestSha256}));
   if(m.kind==='hayes-operation-revalidated')outcomes.push('revalidated');
  }};
  const interruptedCaller=createNativeHayesCaller({owner:bound,auth:new Auth(delayedPool),blobs:store,channel:secondChannel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal:interrupted.signal,assertLive:async()=>{}});
  await expect(interruptedCaller.start({token,csrf},{jobId:second.id,artworkId:provisional,artworkRevision:1},Date.now()+30000)).rejects.toThrow();expect(commits).toBe(4);expect(outcomes).toEqual(['close']);
  const retained=(await pool.query('SELECT state,lease_id,hayes_attempt_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,second.id])).rows[0];expect(retained.state).toBe('processing');expect(retained.lease_id).toBeTruthy();expect(retained.hayes_attempt_id).toBeTruthy();



 }finally{source.fill(0);await pool.end();await rm(root,{recursive:true,force:true});}
});
