// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
vi.mock('./workspace-furnishing-glb.ts',()=>({validateWorkspaceFurnishingGlb:vi.fn(async()=>{})}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:true,export:true,commercial:true}};
function fixture(withWriter=false){
 let row:Record<string,unknown>|undefined,version:Record<string,unknown>|undefined;const files=new Map<string,Buffer>(),bytes=Buffer.from('synthetic bounded GLB'),declaration={requestId:id(4),kind:'pedestal',name:'Synthetic',rights,provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:bytes.length,sha256:sha256(bytes)}};
 const blobs={put:vi.fn(async(key:string,data:Buffer)=>{files.set(key,Buffer.from(data));}),get:vi.fn(async(key:string)=>{const data=files.get(key);if(!data)throw Error('missing');return data;}),remove:vi.fn(async(key:string)=>{files.delete(key);})} as unknown as BlobStore;
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('pg_advisory_unlock_shared'))return {rows:[{unlocked:true}],rowCount:1};
  if(sql.startsWith('SELECT count('))return {rows:[{n:0}],rowCount:1};
  if(sql.includes('SELECT * FROM workspace_furnishing_intakes')&&sql.includes('request_id='))return {rows:row&&row.request_id===args[3]?[row]:[],rowCount:row&&row.request_id===args[3]?1:0};
  if(sql.startsWith('INSERT INTO workspace_furnishing_intakes')){row={id:args[3],request_id:args[4],request_sha256:args[5],declaration:args[6],phase:'uploading',furnishing_id:args[7],furnishing_version:1,received:null,error:null,retryable:false};return {rows:[row],rowCount:1};}
  if(sql.includes('SELECT * FROM workspace_furnishing_intakes')&&sql.includes('worker_token IS NULL'))return {rows:row&&['validating','cancelling'].includes(String(row.phase))?[row]:[],rowCount:row&&['validating','cancelling'].includes(String(row.phase))?1:0};
  if(sql.includes('SELECT * FROM workspace_furnishing_intakes'))return {rows:row?[row]:[],rowCount:row?1:0};
  if(sql.startsWith('SELECT phase FROM workspace_furnishing_intakes'))return {rows:[{phase:row!.phase}],rowCount:1};
  if(sql.startsWith('UPDATE workspace_furnishing_intakes SET worker_token=$3,worker_generation=$4')){Object.assign(row!,{worker_token:args[2],worker_generation:args[3],worker_root_device:args[4],worker_root_inode:args[5],worker_lock_device:args[6],worker_lock_inode:args[7]});return {rows:[],rowCount:1};}
  if(sql.startsWith('UPDATE workspace_furnishing_intakes SET received=')){row!.received=args[2];return {rows:[row],rowCount:1};}
  if(sql.includes("SET phase='validating'")){row!.phase='validating';return {rows:[row],rowCount:1};}
  if(sql.includes("SET phase='failed'")){row!.phase='failed';row!.error=args[3];row!.retryable=args[4];return {rows:[row],rowCount:1};}
  if(sql.includes("SET phase='cancelling'")){row!.phase='cancelling';return {rows:[row],rowCount:1};}
  if(sql.includes("SET phase='registered'")){row!.phase='registered';return {rows:[row],rowCount:1};}
  if(sql.startsWith('INSERT INTO workspace_furnishing_versions')){version={descriptor:args[5],object_key:args[6]};return {rows:[],rowCount:1};}
  if(sql.startsWith('SELECT descriptor,object_key FROM workspace_furnishing_versions'))return {rows:version?[version]:[],rowCount:version?1:0};
  return {rows:[],rowCount:1};
 });
 const client={query,release:vi.fn()} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool,owner={workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:vi.fn(async()=>{})},session={id:id(5),tenantId:id(2),userId:id(3),role:'artist'} as Session,writer={writerFd:12,identity:{runtimeGeneration:id(8),rootDevice:'7',rootInode:'9007199254740993',lockDevice:'7',lockInode:'9007199254740997'},assertLive:vi.fn(async()=>{})},service=new WorkspaceFurnishingIntakes(blobs,owner,withWriter?writer:undefined);
 return {bytes,declaration,blobs,query,client,pool,owner,session,service,writer,getRow:()=>row};
}
it('retains one owner-scoped intake across replay and registers original model after worker completion',async()=>{
 const f=fixture(),first=await f.service.create(f.client,f.session,f.declaration),again=await f.service.create(f.client,f.session,structuredClone(f.declaration));expect(again).toEqual(first);expect(f.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO workspace_furnishing_intakes'))).toHaveLength(1);
 await expect(f.service.create(f.client,f.session,{...f.declaration,name:'Changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});await expect(f.service.create(f.client,{...f.session,userId:id(9)},f.declaration)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(f.service.upload(f.client,f.session,first.intakeId,Buffer.from('wrong'))).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);expect(f.blobs.put).toHaveBeenCalledTimes(1);
 await f.service.complete(f.client,f.session,first.intakeId);expect(await f.service.work(f.pool)).toBe(true);const done=await f.service.read(f.client,f.session,first.intakeId);expect(done.phase).toBe('registered');expect(done.furnishing).toMatchObject({kind:'pedestal',model:f.declaration.model,version:1,rights});expect(await f.service.model(f.client,f.session,done.furnishing!.id,1,'display')).toMatchObject({bytes:f.bytes,sha256:f.declaration.model.sha256});
 const reopened=new WorkspaceFurnishingIntakes(f.blobs,f.owner);expect(await reopened.create(f.client,f.session,f.declaration)).toEqual(done);expect(await reopened.readVersion(f.client,f.session,done.furnishing!.id,1)).toEqual(done.furnishing);
});


it('retains uploaded bytes across retryable validation failure and a new service instance',async()=>{
 const f=fixture(),first=await f.service.create(f.client,f.session,f.declaration);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.complete(f.client,f.session,first.intakeId);
 vi.mocked(validateWorkspaceFurnishingGlb).mockRejectedValueOnce(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));expect(await f.service.work(f.pool)).toBe(true);const failed=await f.service.read(f.client,f.session,first.intakeId);expect(failed).toMatchObject({phase:'failed',retryable:true,received:{bytes:f.bytes.length,sha256:f.declaration.model.sha256}});
 const reopened=new WorkspaceFurnishingIntakes(f.blobs,f.owner);await reopened.retry(f.client,f.session,first.intakeId);expect(await reopened.work(f.pool)).toBe(true);expect((await reopened.read(f.client,f.session,first.intakeId)).phase).toBe('registered');expect(f.blobs.put).toHaveBeenCalledTimes(1);
});
it('rejects malformed model validation without treating it as a retryable worker failure',async()=>{
 const f=fixture(),first=await f.service.create(f.client,f.session,f.declaration);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.complete(f.client,f.session,first.intakeId);
 vi.mocked(validateWorkspaceFurnishingGlb).mockRejectedValueOnce(new ApiError(422,'FORMAT_REJECTED'));expect(await f.service.work(f.pool)).toBe(true);expect(await f.service.read(f.client,f.session,first.intakeId)).toMatchObject({phase:'failed',retryable:false,error:{code:'FORMAT_REJECTED'}});await expect(f.service.retry(f.client,f.session,first.intakeId)).rejects.toMatchObject({code:'JOB_STATE'});
});
it('binds a worker claim to its generation and passes the writer FD to validation',async()=>{
 const f=fixture(true),first=await f.service.create(f.client,f.session,f.declaration);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.complete(f.client,f.session,first.intakeId);expect(await f.service.work(f.pool)).toBe(true);
 const claim=f.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE workspace_furnishing_intakes SET worker_token=$3,worker_generation=$4'));expect(claim?.[1]?.slice(3)).toEqual([f.writer.identity.runtimeGeneration,f.writer.identity.rootDevice,f.writer.identity.rootInode,f.writer.identity.lockDevice,f.writer.identity.lockInode]);expect(validateWorkspaceFurnishingGlb).toHaveBeenLastCalledWith(f.declaration.model,f.bytes,expect.objectContaining({writerFd:12}));expect(f.writer.assertLive).toHaveBeenCalled();
});
it('does not attach a model after its claim identity is changed',async()=>{
 const f=fixture(true),first=await f.service.create(f.client,f.session,f.declaration);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.complete(f.client,f.session,first.intakeId);
 await expect(f.service.work(f.pool,{afterClaim:()=>{f.getRow()!.worker_generation=id(9);}})).rejects.toThrow('FURNISHING_WORKER_OWNERSHIP');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO workspace_furnishing_versions'))).toBe(false);
});
it('checks the claimed generation before cancelling and removing its model',async()=>{
 const f=fixture(true),first=await f.service.create(f.client,f.session,f.declaration);await f.service.upload(f.client,f.session,first.intakeId,f.bytes);await f.service.cancel(f.client,f.session,first.intakeId);await expect(f.service.work(f.pool,{afterClaim:()=>{f.getRow()!.worker_lock_inode='999';}})).rejects.toThrow('FURNISHING_WORKER_OWNERSHIP');expect(f.blobs.remove).not.toHaveBeenCalled();
});
