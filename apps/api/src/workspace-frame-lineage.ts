// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {artworkFrameModel,type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights,validRights} from './rights.ts';
import {FRAME_PREPARATION_POLICY,framePreparationPair,type FramePreparationModel} from './frame-preparation.ts';
import {prepareFrameInWorker} from './frame-preparation-process.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {assertIssuedFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';

type Owner={workspaceId:string;tenantId:string;principalId:string;assertDatabase:(client:PoolClient)=>Promise<void>};
type Writer={writerFd:number;identity:Readonly<{workspaceId:string;tenantId:string;principalId:string;runtimeGeneration:string;rootDevice:string;rootInode:string;lockDevice:string;lockInode:string}>;assertLive:()=>Promise<void>};
type Begin={requestId:string;furnishingId:string;furnishingVersion:1;sourceModel:FramePreparationModel;recipe:typeof FRAME_PREPARATION_POLICY};
type Target={id:string;request_id:string;request_sha256:string;phase:string;declaration:Record<string,unknown>;received:{key:string;bytes:number;sha256:string};furnishing_id:string;furnishing_version:number;descriptor:WorkspaceFurnishingDescriptor;object_key:string};
type Stage={workspace_id:string;tenant_id:string;user_id:string;intake_id:string;furnishing_id:string;furnishing_version:number;source_key:string;source_bytes:number;source_sha256:string;renderable_key:string;renderable_bytes:number;renderable_sha256:string;recipe:string;state:'staged'|'registered';created_at:Date|string};
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const exactKeys=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const missing=(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='ENOENT';

/** A separate, present-day producer receipt for an already registered frame.
 * All methods run in the ordinary authenticated transaction. No historical
 * intake, descriptor, request, grant, or object is rewritten by this operation. */
export class WorkspaceFrameLineage {
 private readonly blobs:BlobStore;private readonly owner:Owner;private readonly writer:Writer;
 constructor(blobs:BlobStore,owner:Owner,writer:Writer){
  this.blobs=blobs;this.owner=owner;this.writer=writer;
  assertIssuedFurnishingWriterLease(writer);
  if(writer.identity.workspaceId!==owner.workspaceId||writer.identity.tenantId!==owner.tenantId||writer.identity.principalId!==owner.principalId)throw Error('FURNISHING_LEASE_INVALID');
 }
 private async fence(c:PoolClient,s:Session){
  if(!['admin','artist','curator'].includes(s.role)||s.tenantId!==this.owner.tenantId||s.userId!==this.owner.principalId)throw new ApiError(403,'FORBIDDEN');
  await this.writer.assertLive();await this.owner.assertDatabase(c);await this.writer.assertLive();
 }
 private async target(c:PoolClient,s:Session,id:string){
  uuid(id);await this.fence(c,s);
  const rows=await c.query(`SELECT i.*,v.descriptor,v.object_key FROM workspace_furnishing_intakes i
   JOIN workspace_furnishing_versions v ON v.workspace_id=i.workspace_id AND v.tenant_id=i.tenant_id AND v.user_id=i.user_id AND v.id=i.furnishing_id AND v.version=i.furnishing_version
   WHERE i.workspace_id=$1 AND i.tenant_id=$2 AND i.user_id=$3 AND i.id=$4 FOR UPDATE OF i,v`,[this.owner.workspaceId,s.tenantId,s.userId,id]);
  if(rows.rowCount!==1)throw new ApiError(404,'FURNISHING_NOT_FOUND');
  const row=rows.rows[0] as Target,d=row.declaration,descriptor=row.descriptor,model=descriptor?.model,known=model&&artworkFrameModel(model.sha256,model.bytes),origin=known?.derivedFrom;
  const pair=origin&&framePreparationPair(origin);
  if(row.phase!=='registered'||row.furnishing_version!==1||d.kind!=='artwork-frame'||Object.hasOwn(d,'preparationPolicy')||!pair||origin?.recipe!==FRAME_PREPARATION_POLICY||known?.version!==2||known.id!==pair.id||!isDeepStrictEqual(model,pair.renderable))throw new ApiError(409,'FRAME_LINEAGE_TARGET');
  const {requestId,...fields}=d,expected={id:row.furnishing_id,version:1,...fields},key=`${s.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${pair.renderable.sha256}`;
  if(requestId!==row.request_id||sha256(Buffer.from(canonical(d)))!==row.request_sha256||!isDeepStrictEqual(descriptor,expected)||row.object_key!==key||!isDeepStrictEqual(row.received,{key,bytes:pair.renderable.bytes,sha256:pair.renderable.sha256}))throw new ApiError(409,'ASSET_INTEGRITY');
  const rights=descriptor.rights as Record<string,unknown>;
  if(!validRights(rights)||rights.holder!=='ExhibitOS'||rights.ownership!=='owner'||rights.licenseId!=='CC0-1.0'||!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(403,'FRAME_PREPARATION_RIGHTS_DENIED');
  const bytes=Buffer.from(await this.blobs.get(key));
  if(bytes.length!==pair.renderable.bytes||sha256(bytes)!==pair.renderable.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  await this.fence(c,s);
  return {row,pair,renderable:bytes,sourceKey:`${s.tenantId}/workspace-furnishing-intake/${this.owner.workspaceId}/${row.id}/${pair.source.sha256}`};
 }
 private async stage(c:PoolClient,target:Awaited<ReturnType<WorkspaceFrameLineage['target']>>){
  const {row,pair,sourceKey}=target,result=await c.query('SELECT * FROM workspace_frame_preparations WHERE workspace_id=$1 AND intake_id=$2 FOR UPDATE',[this.owner.workspaceId,row.id]);
  if(result.rowCount===0)return undefined;
  const p=result.rows[0] as Stage;
  if(result.rowCount!==1||p.workspace_id!==this.owner.workspaceId||p.tenant_id!==this.owner.tenantId||p.user_id!==this.owner.principalId||p.intake_id!==row.id||p.furnishing_id!==row.furnishing_id||p.furnishing_version!==1||p.source_key!==sourceKey||Number(p.source_bytes)!==pair.source.bytes||p.source_sha256!==pair.source.sha256||p.renderable_key!==row.object_key||Number(p.renderable_bytes)!==pair.renderable.bytes||p.renderable_sha256!==pair.renderable.sha256||p.recipe!==FRAME_PREPARATION_POLICY||!['staged','registered'].includes(p.state))throw new ApiError(409,'FRAME_LINEAGE_CONFLICT');
  return p;
 }
 private async original(target:Awaited<ReturnType<WorkspaceFrameLineage['target']>>){
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(target.sourceKey));}catch(e){if(missing(e))return undefined;throw e;}
  if(bytes.length!==target.pair.source.bytes||sha256(bytes)!==target.pair.source.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  return bytes;
 }
 private async view(c:PoolClient,s:Session,target:Awaited<ReturnType<WorkspaceFrameLineage['target']>>,stage:Stage|undefined){
  const original=stage?await this.original(target):undefined;
  if(stage?.state==='registered'&&!original)throw new ApiError(409,'ASSET_INTEGRITY');
  await this.fence(c,s);
  return {version:1,kind:'registered-frame-original-lineage-v1',workspaceId:this.owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,intakeId:target.row.id,requestId:target.row.request_id,furnishingId:target.row.furnishing_id,furnishingVersion:1,recipe:FRAME_PREPARATION_POLICY,
   phase:!stage?'not-started':stage.state==='registered'?'registered':original?'ready-to-prepare':'awaiting-original',sourceModel:target.pair.source,renderableModel:target.pair.renderable,
   historicalRequestSHA256:target.row.request_sha256,descriptorSHA256:sha256(Buffer.from(canonical(target.row.descriptor))),
   ...(stage?.state==='registered'?{receipt:{workspaceId:this.owner.workspaceId,intakeId:stage.intake_id,recipe:stage.recipe,sourceSHA256:stage.source_sha256,renderableSHA256:stage.renderable_sha256},workerDrained:true}:{})};
 }
 async begin(c:PoolClient,s:Session,id:string,value:unknown){
  const target=await this.target(c,s,id);
  if(!exactKeys(value,['requestId','furnishingId','furnishingVersion','sourceModel','recipe'])||!exactKeys(value.sourceModel,['mime','bytes','sha256']))throw new ApiError(400,'FRAME_LINEAGE_INPUT');
  const input=value as unknown as Begin;
  if(input.requestId!==target.row.request_id||input.furnishingId!==target.row.furnishing_id||input.furnishingVersion!==1||input.recipe!==FRAME_PREPARATION_POLICY||!isDeepStrictEqual(input.sourceModel,target.pair.source))throw new ApiError(409,'FRAME_LINEAGE_CONFLICT');
  let stage=await this.stage(c,target);
  if(!stage){
   const {row,pair,sourceKey}=target;
   await c.query(`INSERT INTO workspace_frame_preparations(workspace_id,tenant_id,user_id,intake_id,furnishing_id,furnishing_version,source_key,source_bytes,source_sha256,renderable_key,renderable_bytes,renderable_sha256,recipe,state)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,'staged')`,[this.owner.workspaceId,s.tenantId,s.userId,row.id,row.furnishing_id,sourceKey,pair.source.bytes,pair.source.sha256,row.object_key,pair.renderable.bytes,pair.renderable.sha256,FRAME_PREPARATION_POLICY]);
   stage=await this.stage(c,target);
  }
  return this.view(c,s,target,stage);
 }
 async read(c:PoolClient,s:Session,id:string){const target=await this.target(c,s,id);return this.view(c,s,target,await this.stage(c,target));}
 async upload(c:PoolClient,s:Session,id:string,bytes:Buffer){
  const target=await this.target(c,s,id),stage=await this.stage(c,target);
  if(!stage)throw new ApiError(409,'JOB_STATE');
  if(!Buffer.isBuffer(bytes)||bytes.length!==target.pair.source.bytes||sha256(bytes)!==target.pair.source.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
  if(!await this.original(target)){
   if(stage.state==='registered')throw new ApiError(409,'ASSET_INTEGRITY');
   if(!this.blobs.putDurable)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
   await this.fence(c,s);await this.blobs.putDurable(target.sourceKey,bytes);
  }
  return this.view(c,s,target,stage);
 }
 async complete(c:PoolClient,s:Session,id:string){
  const target=await this.target(c,s,id),stage=await this.stage(c,target);
  if(!stage)throw new ApiError(409,'JOB_STATE');
  if(stage.state==='registered')return this.view(c,s,target,stage);
  const original=await this.original(target);if(!original)throw new ApiError(409,'UPLOAD_INCOMPLETE');
  const hooks={writerFd:this.writer.writerFd},produced=await prepareFrameInWorker(original,hooks);
  await validateWorkspaceFurnishingGlb(target.pair.renderable,produced,hooks);
  if(!produced.equals(target.renderable))throw new ApiError(409,'FRAME_LINEAGE_OUTPUT_MISMATCH');
  // Both worker promises resolve only after close. Recheck current owner,
  // immutable input, stored output and rights before the final transaction write.
  const current=await this.target(c,s,id);
  if(!isDeepStrictEqual(current.row,target.row)||!current.renderable.equals(produced)||!await this.original(current))throw new ApiError(409,'ASSET_INTEGRITY');
  const result=await c.query("UPDATE workspace_frame_preparations SET state='registered' WHERE workspace_id=$1 AND intake_id=$2 AND state='staged' RETURNING intake_id",[this.owner.workspaceId,id]);
  if(result.rowCount!==1)throw new ApiError(409,'FRAME_LINEAGE_CONFLICT');
  return this.view(c,s,current,await this.stage(c,current));
 }
 async cancel(c:PoolClient,s:Session,id:string){
  const target=await this.target(c,s,id),stage=await this.stage(c,target);
  if(!stage)return this.view(c,s,target,undefined);
  if(stage.state==='registered')throw new ApiError(409,'JOB_STATE');
  if(!this.blobs.removeDurable)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
  await this.fence(c,s);await this.blobs.removeDurable(target.sourceKey);
  const result=await c.query("DELETE FROM workspace_frame_preparations WHERE workspace_id=$1 AND intake_id=$2 AND state='staged' RETURNING intake_id",[this.owner.workspaceId,id]);
  if(result.rowCount!==1)throw new ApiError(409,'FRAME_LINEAGE_CONFLICT');
  return this.view(c,s,target,undefined);
 }
}
