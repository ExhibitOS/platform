// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {expect,it} from 'vitest';
import {migrate,transaction,type BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {bindHayesOriginalContext,openHayesOriginalAttempt,revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {Imports} from './imports.ts';

it.skipIf(!process.env.HAYES_TEST_PG||!process.env.EXHIBITOS_HAYES_ORIGINAL)('retains a native claim across expiry, rejects stale owners and leaves ordinary imports usable',async()=>{
 const pool=new Pool({connectionString:process.env.HAYES_TEST_PG}),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID(),jobId=randomUUID();
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic'};
 const b={version:1 as const,tenantId,workspaceId,principalId:userId,jobId,leaseId:randomUUID(),attemptId:randomUUID(),runtimeGeneration:randomUUID(),artworkId,correlationId:randomUUID(),artworkRevision:1,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096};
 const source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!);const blobs={getBounded:async()=>Buffer.from(source),get:async()=>Buffer.from('x')} as unknown as BlobStore;
 const owner={workspaceId,tenantId,principalId:userId,assertDatabase:async()=>{}} as unknown as NativeOexWorkspaceContext,s={id:randomUUID(),tenantId,userId,role:'admin'} as Session;
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  expect(await new Imports(pool,blobs).work()).toBe(false);
  await pool.query('CREATE UNIQUE INDEX local_workspaces_owner_scope ON local_workspaces(id,tenant_id,user_id)');
  await pool.query(await readFile(new URL('../../../database/native-hayes-original/042_hayes_original_attempt.sql',import.meta.url),'utf8'));
  await pool.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',['042_hayes_original_attempt.sql','074de4171572039f2f400d49d07aff8a3ec83ec222c1684cbc5452c6cc8b3ece']);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'test']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,1)',[workspaceId,tenantId,userId]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'test'}]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artworkId,artistId,{rights}]);
  await pool.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,state) VALUES($1,$2,$3,$4,'test','hash','model/gltf-binary',$5,$6,$7,$8,$9,1,'queued')",[tenantId,jobId,userId,artworkId,b.sourceSha256,b.sourceBytes,rights,`${tenantId}/quarantine/source`,`${tenantId}/approved/source`]);
  const bound=await transaction(pool,c=>bindHayesOriginalContext(c,owner));
  expect(await new Imports(pool,blobs).work()).toBe(false);
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{throw Error('owner lost');}))).rejects.toThrow('owner lost');
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_original_attempts')).rows[0].n).toBe(0);
  let calls=0;await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{if(++calls===3)throw Error('late owner lost');}))).rejects.toThrow('late owner lost');
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_original_attempts')).rows[0].n).toBe(0);expect((await pool.query('SELECT state FROM import_jobs WHERE id=$1',[jobId])).rows[0].state).toBe('queued');
  const expiring={...rights,expiresAt:new Date(Date.now()+1000).toISOString()};await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,{rights:expiring}]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,expiring]);
  let rightCalls=0,delayed=false;await expect(transaction(pool,c=>{const wrapped=new Proxy(c,{get(target,key){if(key==='query')return async (...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('SELECT 1 FROM import_jobs WHERE tenant_id=')){delayed=true;await new Promise(resolve=>setTimeout(resolve,1200));}return Reflect.apply(target.query,target,args);};return Reflect.get(target,key,target);}});return openHayesOriginalAttempt(wrapped,s,bound,blobs,b,async()=>{rightCalls++;});})).rejects.toThrow('HAYES_SOURCE_CHANGED');expect(rightCalls).toBe(3);expect(delayed).toBe(true);
  await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,{rights}]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,rights]);
  await pool.query('UPDATE artworks SET revision=2 WHERE id=$1',[artworkId]);
  await expect(transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  await pool.query('UPDATE artworks SET revision=1 WHERE id=$1',[artworkId]);
  const expiringRecheck={...rights,expiresAt:new Date(Date.now()+1000).toISOString()};await pool.query('UPDATE artworks SET metadata=$2 WHERE id=$1',[artworkId,{rights:expiringRecheck}]);await pool.query('UPDATE import_jobs SET rights=$2 WHERE id=$1',[jobId,expiringRecheck]);
  await transaction(pool,c=>openHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}));
  await transaction(pool,c=>revalidateHayesOriginalAttempt(c,s,bound,blobs,b,async()=>{}));
  await expect(transaction(pool,c=>revalidateHayesOriginalAttempt(c,s,bound,blobs,{...b,runtimeGeneration:randomUUID()},async()=>{}))).rejects.toThrow('HAYES_SOURCE_CHANGED');
  let delayedRecheck=false;await expect(transaction(pool,c=>{const wrapped=new Proxy(c,{get(target,key){if(key==='query')return async (...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('SELECT 1 FROM import_jobs WHERE tenant_id=')){delayedRecheck=true;await new Promise(resolve=>setTimeout(resolve,1200));}return Reflect.apply(target.query,target,args);};return Reflect.get(target,key,target);}});return revalidateHayesOriginalAttempt(wrapped,s,bound,blobs,b,async()=>{});})).rejects.toThrow('HAYES_SOURCE_CHANGED');expect(delayedRecheck).toBe(true);
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
 }finally{source.fill(0);await pool.end();}
});
