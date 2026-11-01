// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterAll,afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {PublicationAttempts} from './publication-attempt.ts';
import {PublicationByteStage} from './publication-byte-stage.ts';
import {PublicationFileOperation,PublicationAdmissionFailure,type PublicationOperationRequest} from './publication-file-operation.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-publication-file-op-')));
afterAll(()=>rm(root,{recursive:true,force:true}));afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const coordinatorRoot=await mkdtemp(join(root,'budget-')),scratchRoot=await mkdtemp(join(root,'scratch-')),journalRoot=await mkdtemp(join(root,'journal-')),storeRoot=await mkdtemp(join(root,'blobs-'));
 // Synthetic DB identity for unit boundaries only; actual PostgreSQL fence
 // evidence is separate and these tests grant no runtime/worker authority.
 const query=vi.fn(async()=>({rows:[{system_id:'123',database_oid:'456'}]})),c={query} as unknown as PoolClient;
 const request:PublicationOperationRequest={kind:'publish',attemptId:randomUUID(),runtimeGeneration:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),exhibitionId:randomUUID(),requestId:randomUUID(),etag:'"studio-r2-'+ 'c'.repeat(64)+'"'};
 const config={coordinator:await PublicationDiskBudget.open(coordinatorRoot),journal:new PublicationAttempts(journalRoot),blobs:new FileBlobStore(storeRoot),scratchRoot};
 const s={tenantId:request.tenantId,userId:request.userId} as Session;
 return {coordinatorRoot,c,query,request,config,s};
}
function pause<T>(){let enter!:()=>void,resume!:(value:T)=>void;const entered=new Promise<void>(r=>{enter=r;}),result=new Promise<T>(r=>{resume=r;});return {entered,resume,run:()=>{enter();return result;}};}
it('claims only once, preserves immutable receipt bindings and retains reservation after local closure',async()=>{
 const {c,request,config,s}=await fixture(),op=await PublicationFileOperation.admit(c,config,request),receipt=op.receipt();
 request.requestId=randomUUID();receipt.request.etag='mutated';receipt.reservation.plan[0]!.bytes=1;
 const bound=op.receipt().request,claim=op.claim(c,s,config.blobs,'publish',bound.exhibitionId,bound.etag,bound.requestId);
 await expect(op.claim(c,s,config.blobs,'publish',bound.exhibitionId,bound.etag,bound.requestId)).rejects.toThrow('PUBLICATION_FILE_STATE');
 const stage=await claim,ref=await stage.append(Buffer.from('exact'));expect(await stage.read(ref)).toEqual(Buffer.from('exact'));
 await op.close();expect(op.localStageDrained).toBe(true);await config.coordinator.verifyActive(op.receipt().reservation);
 await expect(op.verify(c,s,config.blobs,'publish',bound.exhibitionId,bound.etag,bound.requestId)).rejects.toThrow('PUBLICATION_FILE_BINDING');
});
it('refuses a foreign transaction, request or publication store before using staged bytes',async()=>{
 for(const mismatch of ['client','request','store'] as const){const {c,request,config,s}=await fixture(),op=await PublicationFileOperation.admit(c,config,request);
  await expect(op.claim(mismatch==='client'?{} as PoolClient:c,s,mismatch==='store'?new FileBlobStore(config.blobs.root):config.blobs,'publish',request.exhibitionId,request.etag,mismatch==='request'?randomUUID():request.requestId)).rejects.toThrow('PUBLICATION_FILE_BINDING');
  expect(op.localStageDrained).toBe(true);await config.coordinator.verifyActive(op.receipt().reservation);
 }
});
it('durably records the exact reservation/runtime generation and owned object list before final put',async()=>{
 const {c,request,config,s}=await fixture(),op=await PublicationFileOperation.admit(c,config,request),publicationId=randomUUID(),bytes=Buffer.from('owned'),key=`${request.tenantId}/publications/${publicationId}/${randomUUID()}/${sha256(bytes)}`;
 try{await op.claim(c,s,config.blobs,'publish',request.exhibitionId,request.etag,request.requestId);await op.manifest(publicationId,'a'.repeat(64),[{key,sha256:sha256(bytes),bytes:bytes.length}]);
  const record=await config.journal.read(request.attemptId);expect(record).toMatchObject({generation:op.receipt().reservation.generation,runtimeGeneration:request.runtimeGeneration,objects:[{key,sha256:sha256(bytes),bytes:bytes.length}]});
  await expect(config.blobs.get(key)).rejects.toMatchObject({code:'ENOENT'});await expect(op.manifest(publicationId,'a'.repeat(64),[])).rejects.toThrow('PUBLICATION_FILE_STATE');
 }finally{await op.close();}
});
it('retains a reservation and its generation if stage creation fails after acquisition',async()=>{
 const {c,request,config,coordinatorRoot}=await fixture();vi.spyOn(PublicationByteStage,'create').mockRejectedValue(Error('disk I/O failed'));
 let caught:unknown;try{await PublicationFileOperation.admit(c,config,request);}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(PublicationAdmissionFailure);if(!(caught instanceof PublicationAdmissionFailure))throw Error('missing admission error');
 expect(caught.cause).toBeInstanceOf(Error);await config.coordinator.verifyActive(caught.reservation);expect(await readdir(coordinatorRoot)).toContain('lease-'+request.attemptId+'.json');
});
it.each(['verify-db','verify-fs','claim-db','manifest-provider','manifest-write'])('refuses progress if close completes during %s',async phase=>{
 const {c,query,request,config,s}=await fixture(),op=await PublicationFileOperation.admit(c,config,request),args=[c,s,config.blobs,'publish',request.exhibitionId,request.etag,request.requestId] as const;
 if(phase!=='claim-db')await op.claim(...args);
 const gate=pause<void>(),dbGate=pause<{rows:{system_id:string;database_oid:string}[]}>();
 if(phase.endsWith('-db'))query.mockImplementationOnce(()=>dbGate.run());
 else if(phase==='manifest-write'){const create=config.journal.create.bind(config.journal);vi.spyOn(config.journal,'create').mockImplementationOnce(async a=>{await create(a);await gate.run();});}
 else vi.spyOn(config.coordinator,'verifyActive').mockImplementationOnce(()=>gate.run());
 const waiting=phase==='claim-db'?op.claim(...args):phase.startsWith('manifest-')?op.manifest(randomUUID(),'a'.repeat(64),[]):op.verify(...args);
 const rejected=expect(waiting).rejects.toThrow('PUBLICATION_FILE_STATE');
 await (phase.endsWith('-db')?dbGate.entered:gate.entered);await op.close();
 if(phase.endsWith('-db'))dbGate.resume({rows:[{system_id:'123',database_oid:'456'}]});else gate.resume();
 await rejected;expect(op.localStageDrained).toBe(true);await config.coordinator.verifyActive(op.receipt().reservation);
 if(phase==='manifest-provider')await expect(config.journal.read(request.attemptId)).rejects.toMatchObject({code:'ENOENT'});
 if(phase==='manifest-write')expect((await config.journal.read(request.attemptId)).generation).toBe(op.receipt().reservation.generation);
});
it('rejects store subclasses, root accessors and instance overrides before reserving capacity',async()=>{
 for(const kind of ['subclass','override','accessor']){const {c,request,config,coordinatorRoot}=await fixture();
  if(kind==='subclass'){class Wrapped extends FileBlobStore{}config.blobs=new Wrapped(config.blobs.root);}
  else if(kind==='accessor')Object.defineProperty(config.blobs,'root',{get:()=>{throw Error('must not evaluate getter');}});
  else Object.defineProperty(config.blobs,'put',{value:async()=>{}});
  await expect(PublicationFileOperation.admit(c,config,request)).rejects.toThrow('PUBLICATION_FILE_CONFIG');expect((await readdir(coordinatorRoot)).some(n=>n.startsWith('lease-'))).toBe(false);
 }
});
