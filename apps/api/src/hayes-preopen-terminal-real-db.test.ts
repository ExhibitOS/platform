// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable DB and synthetic channel. No live Native authorization.
import { mkdtemp,readFile,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect,it,vi } from 'vitest';
import { collectServiceInventory,FileBlobStore,migrate,sha256,transaction } from '@exhibitos/storage';
import { Auth,digest,type Session } from './auth.ts';
import { buildApp } from './app.ts';
import { bindNativeOexWorkspace } from './native-oex-provenance.ts';
import { bindHayesOriginalContext,bindHayesDispositionContext,bindHayesReleaseContext,createHayesOriginalQuarantine,openHayesOriginalAttempt } from './hayes-original-attempt.ts';
import { createNativeHayesCaller } from './native-hayes-caller.ts';
import { Imports } from './imports.ts';

it.skipIf(!process.env.HAYES_TERMINAL_TEST_PG||!process.env.EXHIBITOS_HAYES_ORIGINAL)(
 'records only authenticated expired pre-OPEN claims and can read the same receipt after a lost ACK',async()=>{
  const pool=new Pool({connectionString:process.env.HAYES_TERMINAL_TEST_PG});
  const root=await realpath(await mkdtemp(join(tmpdir(),'hayes-terminal-test-')));
  const blobStore=new FileBlobStore(root);
  const source=await readFile(process.env.EXHIBITOS_HAYES_ORIGINAL!);
  const tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID();
  const token=randomBytes(32).toString('base64url'),csrf='synthetic-csrf';
  const hash='c'.repeat(64);
  const rightsExpiry=Date.now()+60000;
  const rights={holder:'Synthetic test rights',ownership:'owner',licenseId:'CC0-1.0',expiresAt:new Date(rightsExpiry).toISOString(),
   permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Fixture'};
  const metadata={rights,displayReference:{status:'provisional-uncalibrated',assetSha256:hash},
   provenance:{sourceUnits:'unknown',scaleApplied:false}};
  const session={id:randomUUID(),tenantId,userId,role:'admin'} as Session;
  try{
   for(const name of ['migrations','native-oex-normal','native-oex-workspace-import','native-hayes-original',
    'native-hayes-disposition','native-hayes-release','native-hayes-preopen-terminal']){
    await migrate(pool,new URL(`../../../database/${name}/`,import.meta.url).pathname);
   }
   await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Terminal receipt test']);
   await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);
   await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
   await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,process.getuid!()]);
   await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'fixture'}]);
   await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artworkId,artistId,metadata]);
   await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",
    [session.id,digest(token),digest(csrf),csrf,tenantId,userId]);
   const owner=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid:process.getuid!(),blobRoot:root,workspaceImport:true}));
   await transaction(pool,async c=>{
    await bindHayesOriginalContext(c,owner);await bindHayesDispositionContext(c,owner);await bindHayesReleaseContext(c,owner);
   });
   const create=async()=>{
    const job=await transaction(pool,c=>createHayesOriginalQuarantine(c,session,owner,{artworkId,artworkRevision:1,displayReferenceSha256:hash,idempotencyKey:randomUUID()}));
    const imports=new Imports(pool,blobStore,owner);
    await transaction(pool,c=>imports.upload(c,session,job.id,source));await transaction(pool,c=>imports.complete(c,session,job.id));
    const binding={version:1,tenantId,workspaceId,principalId:userId,jobId:job.id,leaseId:randomUUID(),
     attemptId:randomUUID(),runtimeGeneration:randomUUID(),artworkId,correlationId:randomUUID(),
     artworkRevision:1,sourceSha256:sha256(source),sourceBytes:source.length};
    await transaction(pool,c=>openHayesOriginalAttempt(c,session,owner,blobStore,binding,async()=>{},Date.now()+1000));
    const {rows:[db]}=await pool.query(`SELECT (pg_control_system()).system_identifier::text AS system_id,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS db_oid,to_json(lease_until) AS lease_until
      FROM import_jobs WHERE tenant_id=$1 AND id=$2`,[tenantId,job.id]);
    const observation={artworkId,artworkRevision:1,attempts:1,claim:{attemptId:binding.attemptId,correlationId:binding.correlationId,
     databaseOid:db.db_oid,generation:binding.runtimeGeneration,leaseExpired:true,leaseId:binding.leaseId,leaseUntil:db.lease_until,systemId:db.system_id},
     custodyAuthoritySha256:hash,dispositionPresent:false,failedRecordSha256:hash,jobId:job.id,kind:'hayes-preopen-claim-observation',
     openJournalPresent:false,outputStagePresent:false,principalId:userId,progress:25,releasePresent:false,
     savedEtag:`"studio-r99-${hash}"`,savedRevision:298,state:'processing',tenantId,transferSha256:hash,version:1,workspaceId};
    return {job,binding,observation};
   };
   const retained=await create();
   await pool.query('SELECT pg_sleep(1)');
   const scoped=async(value:typeof retained.observation,mode:'reject'|'lost-ack'|'replay'|'late-liveness'|'expired-rights',
    check:(app:ReturnType<typeof buildApp>,path:string,proofSha256:string,caller:ReturnType<typeof createNativeHayesCaller>)=>Promise<void>)=>{
    let open=true,challenge:Record<string,unknown>|undefined,ackSent=false,liveChecks=0;
    let restoreClock:(()=>void)|undefined;
    const channel={isOpen:()=>open,close:async()=>{open=false;},
     send:async(bytes:Uint8Array)=>{
      const frame=JSON.parse(Buffer.from(bytes).toString());
      if(frame.kind==='hayes-preopen-terminal-challenge')challenge=frame;
      else {
       ackSent=true;
       if(mode==='lost-ack')throw Error('simulated ACK loss');
      }
     },
     receive:async()=>Buffer.from(JSON.stringify({...challenge,kind:'hayes-preopen-terminal-proof',observation:value})),
    };
    const caller=createNativeHayesCaller({owner,auth:new Auth(pool),blobs:blobStore,channel,runtimeGeneration:randomUUID(),
     nativeOwnerId:randomUUID(),runtimeManifestSha256:hash,signal:new AbortController().signal,assertLive:async()=>{
      liveChecks++;
      if(mode==='late-liveness'&&liveChecks===4)await new Promise<void>(()=>{});
      if(mode==='expired-rights'&&liveChecks===2){
       const mocked=vi.spyOn(Date,'now').mockReturnValue(rightsExpiry);
       restoreClock=()=>{mocked.mockRestore();};
      }
     }});
    const app=buildApp({pool,blobs:blobStore,nativeOexWorkspace:owner,nativeHayesCaller:caller,runtimeAvailable:()=>true,
     auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
    try{
     await check(app,`/api/v1/tenants/${tenantId}/imports/native-hayes-original/${value.jobId}/preopen-terminal`,sha256(Buffer.from(JSON.stringify(value))),caller);
     if(mode==='replay')expect(challenge).toBeUndefined();
     if(mode==='late-liveness'){expect(liveChecks).toBe(4);expect(ackSent).toBe(false);}
    }finally{restoreClock?.();await app.close();await caller.close();}
   };
   const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
   const expectedReceipt={jobId:retained.job.id,attemptId:retained.binding.attemptId,outcome:'preopen-cancelled'};

   await scoped({...retained.observation,claim:{...retained.observation.claim,databaseOid:'999'}},'reject',async(app,url,proofSha256)=>{
    expect((await app.inject({method:'POST',url,headers,payload:{proofSha256}})).statusCode).toBe(409);
   });
   await scoped(retained.observation,'lost-ack',async(app,url,proofSha256)=>{
    expect((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':'wrong'},payload:{proofSha256}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url,headers,payload:{proofSha256,observation:{jobId:retained.job.id}}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url,headers,payload:{proofSha256}})).statusCode).toBe(500);
    const receipt=await app.inject({method:'GET',url:`${url}?proofSha256=${proofSha256}`,headers});
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toEqual({...expectedReceipt,proofSha256});
   });
   await scoped(retained.observation,'replay',async(app,url,proofSha256)=>{
    const response=await app.inject({method:'POST',url,headers,payload:{proofSha256}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({...expectedReceipt,proofSha256});
    expect((await app.inject({method:'GET',url:`${url}?proofSha256=${hash}`,headers})).statusCode).toBe(409);
   });
   const {rows:[retainedJob]}=await pool.query(`SELECT state,attempts,progress,hayes_attempt_id,lease_id,rights,object_key
    FROM import_jobs WHERE tenant_id=$1 AND id=$2`,[tenantId,retained.job.id]);
   expect(retainedJob).toMatchObject({state:'cancelled',attempts:1,progress:25,hayes_attempt_id:retained.binding.attemptId,
    lease_id:retained.binding.leaseId,rights});
   expect(Buffer.from(await blobStore.getBounded(retainedJob.object_key,source.length)).equals(source)).toBe(true);
   expect((await pool.query('SELECT count(*)::int n FROM hayes_preopen_terminal_bindings')).rows[0].n).toBe(1);
   await expect(pool.query('DELETE FROM hayes_preopen_terminals WHERE tenant_id=$1',[tenantId])).rejects.toThrow('immutable revision');

   const staged=await create();
   const objectKey=`${tenantId}/hayes-output/${staged.binding.attemptId}/${hash}`;
   await pool.query('INSERT INTO hayes_output_stages VALUES($1,$2,$3,$4,$5,10,$6,now())',
    [tenantId,randomUUID(),staged.binding.attemptId,staged.job.id,hash,objectKey]);
   await pool.query('SELECT pg_sleep(1)');
   await scoped(staged.observation,'reject',async(app,url,proofSha256)=>{
    expect((await app.inject({method:'POST',url,headers,payload:{proofSha256}})).statusCode).toBe(409);
   });
   expect((await pool.query('SELECT state FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,staged.job.id])).rows[0].state).toBe('processing');
   const inventory=await transaction(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(82002)');
    return collectServiceInventory(c,blobStore,{tenantId,migrationDirectory:new URL('../../../database/migrations/',import.meta.url).pathname});
   });
   const unresolved=inventory.issues.filter(issue=>issue.code==='HAYES_WORKER_DRAIN_UNCONFIRMED').map(issue=>issue.binding);
   expect(unresolved).toContain(`import_jobs:${tenantId}:${staged.job.id}`);
   expect(unresolved).not.toContain(`import_jobs:${tenantId}:${retained.job.id}`);
   expect(inventory.references).toContainEqual(expect.objectContaining({key:retainedJob.object_key,required:true}));

   const late=await create();
   await pool.query('SELECT pg_sleep(1)');
   await scoped(late.observation,'expired-rights',async(_app,_url,proofSha256,caller)=>{
    await expect(caller.terminalizePreopen({token,csrf},{jobId:late.job.id,proofSha256},rightsExpiry+10000))
     .rejects.toThrow('HAYES_PREOPEN_CLAIM_UNCONFIRMED');
    expect((await pool.query('SELECT state FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,late.job.id])).rows[0].state).toBe('processing');
   });
   await scoped(late.observation,'late-liveness',async(app,url,proofSha256,caller)=>{
    await expect(caller.terminalizePreopen({token,csrf},{jobId:late.job.id,proofSha256},Date.now()+1200))
     .rejects.toThrow('HAYES_OWNER_UNAVAILABLE');
    const receipt=await app.inject({method:'GET',url:`${url}?proofSha256=${proofSha256}`,headers});
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toEqual({jobId:late.job.id,attemptId:late.binding.attemptId,proofSha256,outcome:'preopen-cancelled'});
   });
  }finally{source.fill(0);await pool.end();await rm(root,{recursive:true,force:true});}
 },30000);
