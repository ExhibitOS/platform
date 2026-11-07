// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Artwork} from '@exhibitos/spec';
import {Cms} from './cms.ts';
import type {ChildProcess} from 'node:child_process';
import type {Pool,PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {artworkFrameModel,validWorkspaceFurnishingDeclaration,type WorkspaceFurnishingDeclaration,type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights,validRights} from './rights.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {FRAME_PREPARATION_POLICY,framePreparationPair} from './frame-preparation.ts';
import {prepareFrameInWorker} from './frame-preparation-process.ts';
import {assertIssuedFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';

type Owner={workspaceId:string;tenantId:string;principalId:string;workspaceFurnishingStool?:true;workspaceFurnishingRoomVisual?:true;workspaceFurnishingArtworkFrame?:true;workspaceFurnishingArtworkFrameModels?:true;workspaceArtworkFramePreparation?:true;assertDatabase:(client:PoolClient)=>Promise<void>};
type Writer={writerFd:number;identity:Readonly<{workspaceId:string;tenantId:string;principalId:string;runtimeGeneration:string;rootDevice:string;rootInode:string;lockDevice:string;lockInode:string}>;assertLive:()=>Promise<void>};
type Receipt={bytes:number;sha256:string;key:string};
type Row={id:string;request_id:string;request_sha256:string;declaration:WorkspaceFurnishingDeclaration;phase:string;received:Receipt|null;error:unknown;retryable:boolean;furnishing_id:string;furnishing_version:number;worker_token?:string|null;worker_generation?:string|null;worker_root_device?:string|null;worker_root_inode?:string|null;worker_lock_device?:string|null;worker_lock_inode?:string|null};
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
function verifiedPreparationPair(model:WorkspaceFurnishingDeclaration['model']){
 const pair=framePreparationPair(model);if(!pair)return undefined;
 const original=artworkFrameModel(pair.source.sha256,pair.source.bytes),derived=artworkFrameModel(pair.renderable.sha256,pair.renderable.bytes),binding=derived?.derivedFrom;
 if(!original||original.version!==1||original.id!==pair.id||!derived||derived.version!==2||derived.id!==pair.id||!binding||binding.version!==1||binding.sha256!==pair.source.sha256||binding.bytes!==pair.source.bytes||binding.recipe!==FRAME_PREPARATION_POLICY)return undefined;
 return pair;
}


/** Owner-scoped foundation. A caller must separately qualify schema, runtime,
 * preview/placement and export before exposing any route or capability. */
export class WorkspaceFurnishingIntakes {
 private readonly blobs:BlobStore;private readonly owner:Owner;private readonly writer:Writer|undefined;
 constructor(blobs:BlobStore,owner:Owner,writer?:Writer){if(writer){assertIssuedFurnishingWriterLease(writer);if(writer.identity.workspaceId!==owner.workspaceId||writer.identity.tenantId!==owner.tenantId||writer.identity.principalId!==owner.principalId)throw Error('FURNISHING_LEASE_INVALID');}this.blobs=blobs;this.owner=owner;this.writer=writer;}
 private checkClaim(row:Row,token:string){const writer=this.writer;if(writer&&(row.worker_token!==token||row.worker_generation!==writer.identity.runtimeGeneration||row.worker_root_device!==writer.identity.rootDevice||row.worker_root_inode!==writer.identity.rootInode||row.worker_lock_device!==writer.identity.lockDevice||row.worker_lock_inode!==writer.identity.lockInode))throw Error('FURNISHING_WORKER_OWNERSHIP');}
 private async checkOwner(c:PoolClient,s:Session){if(!['admin','artist','curator'].includes(s.role)||s.tenantId!==this.owner.tenantId||s.userId!==this.owner.principalId)throw new ApiError(403,'FORBIDDEN');await this.writer?.assertLive();await this.owner.assertDatabase(c);await this.writer?.assertLive();}
 matchesBinding(owner:unknown,store:unknown){return this.owner===owner&&this.blobs===store;}
 hasWriterLease(){return this.writer!==undefined;}
 supportsStool(){return this.owner.workspaceFurnishingStool===true;}
 supportsRoomVisual(){return this.owner.workspaceFurnishingRoomVisual===true&&this.supportsStool();}
 supportsArtworkFrame(){return this.owner.workspaceFurnishingArtworkFrame===true&&this.supportsRoomVisual();}
 supportsArtworkFrameModels(){return this.owner.workspaceFurnishingArtworkFrameModels===true&&this.supportsArtworkFrame();}
 supportsFramePreparation(){return this.owner.workspaceArtworkFramePreparation===true&&this.supportsArtworkFrameModels();}
 private admittedDeclaration(value:unknown):value is WorkspaceFurnishingDeclaration{
  return validWorkspaceFurnishingDeclaration(value,{allowStool:this.supportsStool(),allowRoomVisual:this.supportsRoomVisual(),allowArtworkFrame:this.supportsArtworkFrame(),allowFramePreparation:this.supportsFramePreparation()})&&validRights(value.rights)&&
   (value.kind!=='artwork-frame'||(value.model.bytes===7892&&value.model.sha256==='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4'||this.supportsArtworkFrameModels()&&!!artworkFrameModel(value.model.sha256,value.model.bytes)));
 }
 async authorize(c:PoolClient,s:Session){await this.checkOwner(c,s);}
 private async access(c:PoolClient,s:Session,id:string){uuid(id);await this.checkOwner(c,s);const result=await c.query('SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 FOR UPDATE',[this.owner.workspaceId,s.tenantId,s.userId,id]);if(result.rowCount!==1)throw new ApiError(403,'FORBIDDEN');return result.rows[0] as Row;}
 private receipt(row:Row):Receipt{
  const receipt=row.received,model=row.declaration.model,key=`${this.owner.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${model.sha256}`;
  if(!receipt||receipt.key!==key||receipt.bytes!==model.bytes||receipt.sha256!==model.sha256)throw new ApiError(409,'UPLOAD_INCOMPLETE');return receipt;
 }
 private async view(c:PoolClient,row:Row){
  const {requestId:_requestId,preparationPolicy,...fields}=row.declaration;void _requestId;
  let preparation:undefined|{sourceModel:typeof fields.model;recipe:typeof FRAME_PREPARATION_POLICY;renderableModel:typeof fields.model};
  if(preparationPolicy&&row.phase==='registered'){
   const pair=verifiedPreparationPair(fields.model),result=await c.query("SELECT p.*,v.descriptor AS stored_descriptor,v.object_key AS stored_key FROM workspace_frame_preparations p LEFT JOIN workspace_furnishing_versions v ON v.workspace_id=p.workspace_id AND v.tenant_id=p.tenant_id AND v.user_id=p.user_id AND v.id=p.furnishing_id AND v.version=p.furnishing_version WHERE p.workspace_id=$1 AND p.intake_id=$2 AND p.state='registered'",[this.owner.workspaceId,row.id]);
   const p=result.rows[0];if(!pair||result.rowCount!==1||p.tenant_id!==this.owner.tenantId||p.user_id!==this.owner.principalId||p.furnishing_id!==row.furnishing_id||p.furnishing_version!==row.furnishing_version||p.recipe!==FRAME_PREPARATION_POLICY||p.source_key!==this.receipt(row).key||p.source_sha256!==pair.source.sha256||Number(p.source_bytes)!==pair.source.bytes||p.renderable_sha256!==pair.renderable.sha256||Number(p.renderable_bytes)!==pair.renderable.bytes||p.renderable_key!==`${this.owner.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${pair.renderable.sha256}`)throw new ApiError(409,'ASSET_INTEGRITY');
   if(p.stored_key!==p.renderable_key||!isDeepStrictEqual(p.stored_descriptor,{id:row.furnishing_id,version:row.furnishing_version,...fields,model:pair.renderable}))throw new ApiError(409,'ASSET_INTEGRITY');
   preparation={sourceModel:pair.source,recipe:FRAME_PREPARATION_POLICY,renderableModel:pair.renderable};
  }
  return {intakeId:row.id,requestId:row.request_id,phase:row.phase,declaration:fields,received:row.received?{bytes:row.received.bytes,sha256:row.received.sha256}:null,retryable:row.retryable,error:row.error,...(preparationPolicy?{preparationPolicy}:{}),...(preparation?{preparation}:{}),furnishing:row.phase==='registered'?{id:row.furnishing_id,version:row.furnishing_version,...fields,model:preparation?.renderableModel??fields.model}:null};
 }
 async create(c:PoolClient,s:Session,value:unknown){
  await this.checkOwner(c,s);if(!validWorkspaceFurnishingDeclaration(value,{allowStool:this.supportsStool(),allowRoomVisual:this.supportsRoomVisual(),allowArtworkFrame:this.supportsArtworkFrame(),allowFramePreparation:this.supportsFramePreparation()})||!validRights(value.rights))throw new ApiError(400,'FURNISHING_DECLARATION');
  if(value.preparationPolicy){
   if(!verifiedPreparationPair(value.model))throw new ApiError(422,'FRAME_PREPARATION_SOURCE_UNSUPPORTED');
   const r=value.rights as {holder?:unknown;ownership?:unknown;licenseId?:unknown};
   if(r.holder!=='ExhibitOS'||r.ownership!=='owner'||r.licenseId!=='CC0-1.0')throw new ApiError(403,'FRAME_PREPARATION_RIGHTS_DENIED');
  }
  if(!this.admittedDeclaration(value))throw new ApiError(400,'FURNISHING_DECLARATION');
  const declaration=structuredClone(value),requestHash=createHash('sha256').update(canonical(declaration)).digest('hex');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.owner.workspaceId}:${declaration.requestId}`]);
  const previous=await c.query('SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND request_id=$4 FOR UPDATE',[this.owner.workspaceId,s.tenantId,s.userId,declaration.requestId]);
  if(previous.rowCount){const row=previous.rows[0] as Row;if(row.request_sha256!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return this.view(c,row);}
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`furnishing-cap:${this.owner.workspaceId}`]);const count=await c.query("SELECT count(*)::int AS n FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND phase IN ('uploading','validating','cancelling','failed')",[this.owner.workspaceId]);if(count.rows[0].n>=16)throw new ApiError(409,'FURNISHING_INTAKE_LIMIT');
  const result=await c.query("INSERT INTO workspace_furnishing_intakes(workspace_id,tenant_id,user_id,id,request_id,request_sha256,declaration,phase,furnishing_id,furnishing_version) VALUES($1,$2,$3,$4,$5,$6,$7,'uploading',$8,1) RETURNING *",[this.owner.workspaceId,s.tenantId,s.userId,randomUUID(),declaration.requestId,requestHash,declaration,randomUUID()]);return this.view(c,result.rows[0] as Row);
 }
 async read(c:PoolClient,s:Session,id:string){return this.view(c,await this.access(c,s,id));}
 async upload(c:PoolClient,s:Session,id:string,bytes:Buffer){
  const row=await this.access(c,s,id);if(!Buffer.isBuffer(bytes))throw new ApiError(400,'INVALID_INPUT');const digest=sha256(bytes),expected=row.declaration.model;
  if(row.received){if(bytes.length!==row.received.bytes||digest!==row.received.sha256)throw new ApiError(409,'MODEL_CONFLICT');return this.view(c,row);}
  if(row.phase!=='uploading')throw new ApiError(409,'JOB_STATE');if(bytes.length!==expected.bytes||digest!==expected.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
  const key=`${s.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${digest}`;await this.writer?.assertLive();if(row.declaration.preparationPolicy){if(!this.blobs.putDurable)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');await this.blobs.putDurable(key,bytes);}else await this.blobs.put(key,bytes);const result=await c.query('UPDATE workspace_furnishing_intakes SET received=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *',[this.owner.workspaceId,row.id,{bytes:bytes.length,sha256:digest,key}]);return this.view(c,result.rows[0] as Row);
 }
 async complete(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id);if(['validating','registered'].includes(row.phase))return this.view(c,row);if(row.phase!=='uploading')throw new ApiError(409,'JOB_STATE');const receipt=this.receipt(row);let bytes:Uint8Array;try{bytes=await this.blobs.get(receipt.key);}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}if(bytes.length!==row.declaration.model.bytes||sha256(bytes)!==row.declaration.model.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');const result=await c.query("UPDATE workspace_furnishing_intakes SET phase='validating',error=NULL,retryable=false,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *",[this.owner.workspaceId,row.id]);return this.view(c,result.rows[0] as Row);}
 async cancel(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id);if(['cancelling','cancelled'].includes(row.phase))return this.view(c,row);if(row.phase==='registered')throw new ApiError(409,'JOB_STATE');const result=await c.query("UPDATE workspace_furnishing_intakes SET phase='cancelling',retryable=false,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *",[this.owner.workspaceId,row.id]);return this.view(c,result.rows[0] as Row);}
 async retry(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id);if(row.phase!=='failed'||!row.retryable)throw new ApiError(409,'JOB_STATE');const result=await c.query("UPDATE workspace_furnishing_intakes SET phase='validating',retryable=false,error=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token IS NULL RETURNING *",[this.owner.workspaceId,row.id]);if(result.rowCount!==1)throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');return this.view(c,result.rows[0] as Row);}
 async listIntakes(c:PoolClient,s:Session,cursor?:string){await this.checkOwner(c,s);let after='00000000-0000-0000-0000-000000000000';if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>128||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new ApiError(400,'INVALID_CURSOR');const decoded=Buffer.from(cursor,'base64url').toString('utf8');if(Buffer.from(decoded).toString('base64url')!==cursor)throw new ApiError(400,'INVALID_CURSOR');uuid(decoded);after=decoded;}const result=await c.query('SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id>$4::uuid ORDER BY id LIMIT 51',[this.owner.workspaceId,s.tenantId,s.userId,after]);const rows=result.rows.slice(0,50) as Row[],last=rows.at(-1);return {items:await Promise.all(rows.map(row=>this.view(c,row))),nextCursor:result.rows.length>50&&last?Buffer.from(last.id).toString('base64url'):null};}
 async list(c:PoolClient,s:Session,cursor?:string){await this.checkOwner(c,s);let after='00000000-0000-0000-0000-000000000000';if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>128||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new ApiError(400,'INVALID_CURSOR');const decoded=Buffer.from(cursor,'base64url').toString('utf8');if(Buffer.from(decoded).toString('base64url')!==cursor)throw new ApiError(400,'INVALID_CURSOR');uuid(decoded);after=decoded;}const result=await c.query('SELECT id,version,descriptor FROM workspace_furnishing_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id>$4::uuid ORDER BY id,version LIMIT 51',[this.owner.workspaceId,s.tenantId,s.userId,after]);const rows=result.rows.slice(0,50),last=rows.at(-1);return {items:rows.map(row=>({id:row.id,version:row.version,kind:row.descriptor.kind,name:row.descriptor.name,rightsAvailability:{display:allowedRights(row.descriptor.rights,'display'),download:allowedRights(row.descriptor.rights,'download'),export:allowedRights(row.descriptor.rights,'export')}})),nextCursor:result.rows.length>50&&last?Buffer.from(last.id).toString('base64url'):null};}
 private async version(c:PoolClient,s:Session,id:string,version:number){await this.checkOwner(c,s);uuid(id);if(!Number.isSafeInteger(version)||version!==1)throw new ApiError(400,'INVALID_INPUT');const result=await c.query('SELECT descriptor,object_key FROM workspace_furnishing_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 FOR SHARE',[this.owner.workspaceId,s.tenantId,s.userId,id,version]);if(result.rowCount!==1)throw new ApiError(404,'FURNISHING_NOT_FOUND');return result.rows[0] as {descriptor:WorkspaceFurnishingDescriptor;object_key:string};}
 async readVersion(c:PoolClient,s:Session,id:string,version:number){return (await this.version(c,s,id,version)).descriptor;}
 /** Revalidate the registered owner, current display grant and original bytes.
  * A descriptor alone is not a display grant, even for an owner preview. */
 async checkDisplay(c:PoolClient,s:Session,id:string,version:number){
  const before=await this.readVersion(c,s,id,version),model=await this.model(c,s,id,version,'display'),after=await this.readVersion(c,s,id,version);
  if(canonical(before)!==canonical(after)||model.sha256!==after.model.sha256||model.bytes.length!==after.model.bytes||model.mime!==after.model.mime||!allowedRights(after.rights,'display'))throw new ApiError(409,'ASSET_INTEGRITY');
  return after;
 }
 /** A draft's self-declared image metadata is not an artwork approval. */
 async checkArtwork(c:PoolClient,s:Session,artwork:Artwork){
  await this.checkOwner(c,s);
  const approved=(await new Cms(this.blobs).studioArtwork(c,s,artwork.id)).artwork;
  if(!isDeepStrictEqual(approved,artwork))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
 }
 async model(c:PoolClient,s:Session,id:string,version:number,purpose:'display'|'export'){const row=await this.version(c,s,id,version),denied=purpose==='display'?'DISPLAY_PERMISSION_REQUIRED':'RIGHTS_DENIED';if(!allowedRights(row.descriptor.rights,purpose))throw new ApiError(403,denied);const prefix=`${s.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/`,suffix=row.object_key.startsWith(prefix)?row.object_key.slice(prefix.length).split('/'):[];if(suffix.length!==2||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(suffix[0]!)||suffix[1]!==row.descriptor.model.sha256)throw new ApiError(409,'ASSET_INTEGRITY');let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(row.object_key));}catch{throw new ApiError(409,'ASSET_INTEGRITY');}if(bytes.length!==row.descriptor.model.bytes||sha256(bytes)!==row.descriptor.model.sha256)throw new ApiError(409,'ASSET_INTEGRITY');if(!allowedRights(row.descriptor.rights,purpose))throw new ApiError(403,denied);return {bytes,mime:row.descriptor.model.mime,sha256:row.descriptor.model.sha256};}
 /** Fence the complete publication after I/O so one model cannot expire
  * while another model is being read. The caller holds the policy locks. */
 async publicationFence(c:PoolClient,descriptors:readonly WorkspaceFurnishingDescriptor[]){
  if(!this.writer)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.writer.assertLive();await this.owner.assertDatabase(c);await this.writer.assertLive();
  const now=Date.now();if(descriptors.some(item=>!allowedRights(item.rights,'display',now)||!allowedRights(item.rights,'export',now)))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 }
 /** Read a publication-bound source without manufacturing an authenticated
  * session. Only the configured live workspace owner and the exact immutable
  * registered descriptor can authorize these bytes. */
 async publicationModel(c:PoolClient,binding:{workspaceId:string;tenantId:string;userId:string;descriptor:WorkspaceFurnishingDescriptor},signal?:AbortSignal){
  signal?.throwIfAborted();
  const {workspaceId,tenantId,userId,descriptor}=binding;
  if(!this.writer||workspaceId!==this.owner.workspaceId||tenantId!==this.owner.tenantId||userId!==this.owner.principalId||!descriptor)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.writer?.assertLive();await this.owner.assertDatabase(c);await this.writer?.assertLive();
  uuid(descriptor.id);if(descriptor.version!==1)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const result=await c.query('SELECT descriptor,object_key FROM workspace_furnishing_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 FOR SHARE',[workspaceId,tenantId,userId,descriptor.id,descriptor.version]);
  const row=result.rows[0] as {descriptor:WorkspaceFurnishingDescriptor;object_key:string}|undefined;
  if(result.rowCount!==1||!row||!isDeepStrictEqual(row.descriptor,descriptor)||!allowedRights(descriptor.rights,'display')||!allowedRights(descriptor.rights,'export'))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const prefix=`${tenantId}/workspace-furnishing-intake/${workspaceId}/`,suffix=row.object_key.startsWith(prefix)?row.object_key.slice(prefix.length).split('/'):[];
  if(suffix.length!==2||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(suffix[0]!)||suffix[1]!==descriptor.model.sha256)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  signal?.throwIfAborted();let bytes:Buffer;try{if(signal&&!this.blobs.getBounded)throw Error('BOUNDED_READ_UNAVAILABLE');bytes=Buffer.from(await (this.blobs.getBounded?this.blobs.getBounded(row.object_key,descriptor.model.bytes,signal):this.blobs.get(row.object_key,signal)));}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}signal?.throwIfAborted();
  if(bytes.length!==descriptor.model.bytes||sha256(bytes)!==descriptor.model.sha256||!allowedRights(descriptor.rights,'display')||!allowedRights(descriptor.rights,'export'))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.writer?.assertLive();await this.owner.assertDatabase(c);await this.writer?.assertLive();
  if(!allowedRights(descriptor.rights,'display')||!allowedRights(descriptor.rights,'export'))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  return {bytes,mime:descriptor.model.mime,sha256:descriptor.model.sha256};
 }
 async work(pool:Pool,hooks?:{afterClaim?:()=>void|Promise<void>;onSpawn?:(child:ChildProcess)=>void;writerFd?:number}){
  await this.writer?.assertLive();const fence=await pool.connect();let locked=false,broken=false;try{await fence.query('SELECT pg_advisory_lock_shared(82002)');locked=true;await this.writer?.assertLive();return await this.workLocked(fence,hooks);}catch(error){broken=true;throw error;}finally{if(locked)try{const result=await fence.query('SELECT pg_advisory_unlock_shared(82002) AS unlocked');if(result.rows[0]?.unlocked!==true)broken=true;}catch{broken=true;}fence.release(broken);}
 }
 private async workLocked(c:PoolClient,hooks?:{afterClaim?:()=>void|Promise<void>;onSpawn?:(child:ChildProcess)=>void;writerFd?:number}){
  const transact=async<T>(fn:()=>Promise<T>)=>{await c.query('BEGIN');try{const value=await fn();await this.writer?.assertLive();await c.query('COMMIT');return value;}catch(error){await c.query('ROLLBACK');throw error;}};const token=randomUUID(),writer=this.writer,clearWriter=writer?',worker_generation=NULL,worker_root_device=NULL,worker_root_inode=NULL,worker_lock_device=NULL,worker_lock_inode=NULL':'';
  const row=await transact(async()=>{await this.owner.assertDatabase(c);const result=await c.query("SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND phase IN ('validating','cancelling') AND worker_token IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId]);if(!result.rowCount)return undefined;const value=result.rows[0] as Row;if(writer){const w=writer.identity;await c.query('UPDATE workspace_furnishing_intakes SET worker_token=$3,worker_generation=$4,worker_root_device=$5,worker_root_inode=$6,worker_lock_device=$7,worker_lock_inode=$8,updated_at=now() WHERE workspace_id=$1 AND id=$2',[this.owner.workspaceId,value.id,token,w.runtimeGeneration,w.rootDevice,w.rootInode,w.lockDevice,w.lockInode]);}else await c.query('UPDATE workspace_furnishing_intakes SET worker_token=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2',[this.owner.workspaceId,value.id,token]);return value;});if(!row)return false;await hooks?.afterClaim?.();
  let error:unknown,cleanup=row.phase==='cancelling',prepared:{key:string;model:typeof row.declaration.model}|undefined;
  if(!cleanup)try{
   const receipt=this.receipt(row),bytes=Buffer.from(await this.blobs.get(receipt.key));await this.writer?.assertLive();
   if(row.declaration.preparationPolicy){
    const pair=verifiedPreparationPair(row.declaration.model);if(!pair||!this.supportsFramePreparation())throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');
    const result=await prepareFrameInWorker(bytes,{...hooks,...(writer?{writerFd:writer.writerFd}:{})});
    try{await validateWorkspaceFurnishingGlb(pair.renderable,result,{...hooks,...(writer?{writerFd:writer.writerFd}:{})});}catch(e){if(e instanceof ApiError&&e.code==='FORMAT_REJECTED')throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');throw e;}
    const key=`${this.owner.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${pair.renderable.sha256}`;
    await transact(async()=>{
     await this.owner.assertDatabase(c);const current=await c.query('SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 FOR UPDATE',[this.owner.workspaceId,row.id,token]);
     if(current.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');this.checkClaim(current.rows[0] as Row,token);
     if(current.rows[0].phase!=='validating'||canonical(current.rows[0].declaration)!==canonical(row.declaration)||canonical(this.receipt(current.rows[0] as Row))!==canonical(receipt))throw Error('FURNISHING_WORKER_OWNERSHIP');
     await c.query(`INSERT INTO workspace_frame_preparations(workspace_id,tenant_id,user_id,intake_id,furnishing_id,furnishing_version,source_key,source_bytes,source_sha256,renderable_key,renderable_bytes,renderable_sha256,recipe,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staged') ON CONFLICT(workspace_id,intake_id) DO NOTHING`,[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId,row.id,row.furnishing_id,row.furnishing_version,receipt.key,pair.source.bytes,pair.source.sha256,key,pair.renderable.bytes,pair.renderable.sha256,FRAME_PREPARATION_POLICY]);
     const existing=await c.query('SELECT * FROM workspace_frame_preparations WHERE workspace_id=$1 AND intake_id=$2 FOR UPDATE',[this.owner.workspaceId,row.id]);const stage=existing.rows[0];
     if(existing.rowCount!==1||stage.state!=='staged'||stage.tenant_id!==this.owner.tenantId||stage.user_id!==this.owner.principalId||stage.furnishing_id!==row.furnishing_id||stage.furnishing_version!==row.furnishing_version||stage.source_key!==receipt.key||stage.source_sha256!==pair.source.sha256||Number(stage.source_bytes)!==pair.source.bytes||stage.renderable_key!==key||stage.renderable_sha256!==pair.renderable.sha256||Number(stage.renderable_bytes)!==pair.renderable.bytes||stage.recipe!==FRAME_PREPARATION_POLICY)throw Error('FURNISHING_WORKER_OWNERSHIP');
    });
    await this.writer?.assertLive();if(!this.blobs.putDurable)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');await this.blobs.putDurable(key,result);
    const stored=Buffer.from(await this.blobs.get(key));if(stored.length!==pair.renderable.bytes||sha256(stored)!==pair.renderable.sha256)throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');
    prepared={key,model:pair.renderable};
   }else await validateWorkspaceFurnishingGlb(row.declaration.model,bytes,{...hooks,...(writer?{writerFd:writer.writerFd}:{})});
   const state=await transact(async()=>{await this.owner.assertDatabase(c);return c.query(writer?'SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3':'SELECT phase FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3',[this.owner.workspaceId,row.id,token]);});
   if(state.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');this.checkClaim(state.rows[0] as Row,token);if(state.rows[0].phase==='cancelling')cleanup=true;
  }catch(e){error=e;}
  if(!cleanup){await transact(async()=>{
   await this.owner.assertDatabase(c);const result=await c.query('SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 FOR UPDATE',[this.owner.workspaceId,row.id,token]);
   if(result.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');const current=result.rows[0] as Row;this.checkClaim(current,token);if(current.phase==='cancelling'){cleanup=true;return;}if(current.phase!=='validating')throw Error('FURNISHING_WORKER_OWNERSHIP');
   if(error){const code=error instanceof ApiError?error.code:'FURNISHING_VALIDATION_UNAVAILABLE',retryable=!(error instanceof ApiError)||error.code==='FURNISHING_VALIDATION_UNAVAILABLE';await c.query(`UPDATE workspace_furnishing_intakes SET phase='failed',error=$4,retryable=$5,worker_token=NULL${clearWriter},updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3`,[this.owner.workspaceId,row.id,token,{code},retryable]);return;}
   if(!this.admittedDeclaration(current.declaration)||canonical(current.declaration)!==canonical(row.declaration)||current.furnishing_id!==row.furnishing_id||current.furnishing_version!==row.furnishing_version||canonical(this.receipt(current))!==canonical(this.receipt(row))||!!current.declaration.preparationPolicy!==!!prepared)throw Error('FURNISHING_WORKER_OWNERSHIP');
   const {requestId:_requestId,preparationPolicy:_policy,...fields}=current.declaration;void _requestId;void _policy;
   const descriptor={id:current.furnishing_id,version:current.furnishing_version,...fields,model:prepared?.model??fields.model};
   await c.query('INSERT INTO workspace_furnishing_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId,current.furnishing_id,current.furnishing_version,descriptor,prepared?.key??this.receipt(current).key]);
   if(prepared){const linked=await c.query("UPDATE workspace_frame_preparations SET state='registered' WHERE workspace_id=$1 AND intake_id=$2 AND state='staged' AND renderable_key=$3 RETURNING intake_id",[this.owner.workspaceId,row.id,prepared.key]);if(linked.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');}
   await c.query(`UPDATE workspace_furnishing_intakes SET phase='registered',worker_token=NULL${clearWriter},updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3`,[this.owner.workspaceId,row.id,token]);
  });}
  if(cleanup){
   const stage=await transact(async()=>{
    await this.owner.assertDatabase(c);const current=await c.query("SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 AND phase='cancelling' FOR UPDATE",[this.owner.workspaceId,row.id,token]);
    if(current.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');this.checkClaim(current.rows[0] as Row,token);
    if(!row.declaration.preparationPolicy)return undefined;
    const staged=await c.query('SELECT * FROM workspace_frame_preparations WHERE workspace_id=$1 AND intake_id=$2 FOR UPDATE',[this.owner.workspaceId,row.id]);
    if(staged.rowCount===0)return undefined;
    const p=staged.rows[0],pair=verifiedPreparationPair(row.declaration.model);
    if(staged.rowCount!==1||!pair||p.state!=='staged'||p.tenant_id!==this.owner.tenantId||p.user_id!==this.owner.principalId||p.renderable_key!==`${this.owner.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${pair.renderable.sha256}`)throw Error('FURNISHING_WORKER_OWNERSHIP');return p;
   });
   let failed=false;const key=`${this.owner.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${row.declaration.model.sha256}`;
   for(const target of [stage?.renderable_key,key].filter((value):value is string=>typeof value==='string')){
    await writer?.assertLive();try{await this.blobs.remove(target);}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))failed=true;}
   }
   await transact(async()=>{
    await this.owner.assertDatabase(c);const current=await c.query("SELECT * FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 AND phase='cancelling' FOR UPDATE",[this.owner.workspaceId,row.id,token]);
    if(current.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');this.checkClaim(current.rows[0] as Row,token);
    if(!failed&&stage){const deleted=await c.query("DELETE FROM workspace_frame_preparations WHERE workspace_id=$1 AND intake_id=$2 AND state='staged' RETURNING intake_id",[this.owner.workspaceId,row.id]);if(deleted.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');}
    const result=await c.query(`UPDATE workspace_furnishing_intakes SET phase=CASE WHEN $4 THEN 'cancelling' ELSE 'cancelled' END,worker_token=NULL${clearWriter},updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 AND phase='cancelling' RETURNING id`,[this.owner.workspaceId,row.id,token,failed]);if(result.rowCount!==1)throw Error('FURNISHING_WORKER_OWNERSHIP');
   });
  }
  return true;
 }
}
