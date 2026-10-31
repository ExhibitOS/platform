// SPDX-License-Identifier: AGPL-3.0-or-later
import {FileBlobStore,sha256,type BlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {realpath,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import type {Session} from './auth.ts';
import {PublicationDiskBudget,type DiskReservationBinding,type DiskPlan} from './publication-disk-budget.ts';
import {PublicationAttempts,publicationDiskOwner,isPublicationFileStore,type PublicationAttempt} from './publication-attempt.ts';
import {PublicationByteStage} from './publication-byte-stage.ts';

export interface PublicationOperationRequest {
 kind:'readiness'|'publish';attemptId:string;runtimeGeneration:string;
 tenantId:string;userId:string;exhibitionId:string;requestId:string;etag:string;
}
export interface PublicationFileConfiguration {
 coordinator:PublicationDiskBudget;journal:PublicationAttempts;blobs:FileBlobStore;
 scratchRoot:string;
 /** Existing codec/worker scratch devices must also be explicitly budgeted by
  * the common service; this context covers publication stage/final/cache bytes. */
 additionalDiskPlan?:DiskPlan[];
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
export class PublicationAdmissionFailure extends Error {
 readonly reservation:DiskReservationBinding;
 constructor(cause:unknown,binding:DiskReservationBinding){super('PUBLICATION_FILE_ADMISSION_FAILED',{cause});this.reservation=JSON.parse(canonical(binding)) as DiskReservationBinding;}
}
/** Inactive, one-shot internal consumer context. Only the common native
 * admission service may issue it for an explicitly negotiated operation. It
 * owns no registry or release authority and proves no runtime/child drain. */
export class PublicationFileOperation {
 readonly budget=536870912;
 private readonly c:PoolClient;private readonly config:PublicationFileConfiguration;
 private readonly request:PublicationOperationRequest;private readonly binding:DiskReservationBinding;
 private readonly stage:PublicationByteStage;
 private state:'admitted'|'claimed'|'terminal'='admitted';private drained=false;private journalStarted=false;
 private constructor(c:PoolClient,config:PublicationFileConfiguration,request:PublicationOperationRequest,binding:DiskReservationBinding,stage:PublicationByteStage){this.c=c;this.config=config;this.request=request;this.binding=binding;this.stage=stage;}
 static async admit(c:PoolClient,config:PublicationFileConfiguration,input:PublicationOperationRequest){
  const request=JSON.parse(canonical(input)) as PublicationOperationRequest;
  if(!request||Object.keys(request).sort().join(',')!=='attemptId,etag,exhibitionId,kind,requestId,runtimeGeneration,tenantId,userId'||!['readiness','publish'].includes(request.kind)||![request.attemptId,request.runtimeGeneration,request.tenantId,request.userId,request.exhibitionId,request.requestId].every(v=>typeof v==='string'&&uuid.test(v))||!/^"studio-r[1-9][0-9]*-[0-9a-f]{64}"$/.test(request.etag))throw Error('PUBLICATION_FILE_BINDING');
  // Snapshot configuration values before any await; service-owned instances
  // are shared with OEX, never replaced by a parallel coordinator namespace.
  config={...config,additionalDiskPlan:config.additionalDiskPlan?.map(p=>({...p}))};
  if(!(config.coordinator instanceof PublicationDiskBudget)||!(config.journal instanceof PublicationAttempts)||!isPublicationFileStore(config.blobs))throw Error('PUBLICATION_FILE_CONFIG');
  const scratch=config.scratchRoot,s=await lstat(scratch);
  if(!isAbsolute(scratch)||await realpath(scratch)!==scratch||!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw Error('PUBLICATION_STAGE_ROOT');
  const owner=await publicationDiskOwner(c,config.blobs.root),plan=[{root:scratch,bytes:536870912},{root:owner.storeRoot,bytes:1073741824},...config.additionalDiskPlan??[]];
  const lease=await config.coordinator.acquire('publication',owner,request.attemptId,plan);
  // Failure after acquire deliberately retains the known attempt reservation.
  // Missing context/receipt is uncertainty, never permission to auto-release.
  const binding:DiskReservationBinding={id:lease.id,generation:lease.generation,operation:'publication',owner,plan};
  try{const stage=await PublicationByteStage.create(536870912,scratch);return new PublicationFileOperation(c,config,request,binding,stage);}
  catch(error){throw new PublicationAdmissionFailure(error,binding);}
 }
 /** Independent copies for durable service receipts; mutation cannot alter
  * the private live authority used by subsequent claims and final fences. */
 receipt(){return JSON.parse(canonical({request:this.request,reservation:this.binding})) as {request:PublicationOperationRequest;reservation:DiskReservationBinding};}
 assertClaimed(){if(this.state!=='claimed')throw Error('PUBLICATION_FILE_STATE');}
 async verify(c:PoolClient,s:Session,blobs:BlobStore|undefined,kind:PublicationOperationRequest['kind'],exhibitionId:string,etag:string,requestId?:string){
  if(this.state==='terminal'||c!==this.c||blobs!==this.config.blobs||kind!==this.request.kind||s.tenantId!==this.request.tenantId||s.userId!==this.request.userId||exhibitionId!==this.request.exhibitionId||etag!==this.request.etag||kind==='publish'&&requestId!==this.request.requestId)throw Error('PUBLICATION_FILE_BINDING');
  const state=this.state;
  if(!isPublicationFileStore(blobs)||canonical(await publicationDiskOwner(c,this.config.blobs.root))!==canonical(this.binding.owner))throw Error('PUBLICATION_FILE_BINDING');
  if(this.state!==state)throw Error('PUBLICATION_FILE_STATE');
  await this.config.coordinator.verifyActive(this.binding);
  if(this.state!==state)throw Error('PUBLICATION_FILE_STATE');
 }
 async claim(c:PoolClient,s:Session,blobs:BlobStore|undefined,kind:PublicationOperationRequest['kind'],exhibitionId:string,etag:string,requestId?:string){
  if(this.state!=='admitted')throw Error('PUBLICATION_FILE_STATE');
  // Seal against two concurrent claim callers before the first await.
  this.state='claimed';try{await this.verify(c,s,blobs,kind,exhibitionId,etag,requestId);this.assertClaimed();return this.stage;}catch(error){try{await this.close();}catch(cleanup){throw new AggregateError([error,cleanup],'PUBLICATION_STAGE_CLEANUP_FAILED',{cause:cleanup});}throw error;}
 }
 async manifest(publicationId:string,snapshotHash:string,objects:PublicationAttempt['objects']){
  if(this.state!=='claimed'||this.request.kind!=='publish'||this.journalStarted)throw Error('PUBLICATION_FILE_STATE');this.journalStarted=true;
  objects=JSON.parse(canonical(objects)) as PublicationAttempt['objects'];
  await this.config.coordinator.verifyActive(this.binding);
  this.assertClaimed();
  const r=this.request;
  await this.config.journal.create({version:1,attemptId:r.attemptId,generation:this.binding.generation,runtimeGeneration:r.runtimeGeneration,owner:this.binding.owner,tenantId:r.tenantId,userId:r.userId,requestId:r.requestId,exhibitionId:r.exhibitionId,etag:r.etag,payloadHash:sha256(Buffer.from(JSON.stringify({id:r.exhibitionId,requestId:r.requestId,match:r.etag}))),publicationId,snapshotHash,objects});
  this.assertClaimed();
 }
 /** Only local stage closure is proven. Caller must independently establish
  * parent DB outcome, irreversible service terminal state and real child drain
  * before invoking shared-provider release. This method never releases it. */
 async close(){this.state='terminal';await this.stage.close();this.drained=true;}
 get localStageDrained(){return this.drained;}
}
