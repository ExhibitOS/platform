import {assertCompactVariantContext,workCompactVariant} from './compact-model-variant.ts';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {assertIssuedFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {artworkAccess,transaction,sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError} from './api-error.ts';
import {allowedRights} from './rights.ts';
import {LARGE_MODEL_RECIPE} from './oam-original-preparation.ts';
import {prepareCompactModelInWorker} from './oam-original-preparation-process.ts';
import {storedModelPreparation,createModelPreparationReceipt,modelPreparationReceipt} from './model-preparation-intent.ts';

export interface ModelPreparationWriter {writerFd:number;identity:Readonly<{workspaceId:string;tenantId:string;principalId:string;runtimeGeneration:string;rootDevice:string;rootInode:string;lockDevice:string;lockInode:string}>;assertLive:()=>Promise<void>}
export function assertModelPreparationWriter(writer:ModelPreparationWriter){assertIssuedFurnishingWriterLease(writer);}
export interface ModelPreparationExecution {readonly mode:'native'|'service';readonly blobs:BlobStore;readonly workspace?:NativeOexWorkspaceContext;readonly writer?:ModelPreparationWriter;isActive:()=>boolean;assertReady:(c:PoolClient,actor?:{tenantId:string;userId:string})=>Promise<void>}
const executions=new WeakSet<ModelPreparationExecution>();
function execution(blobs:BlobStore,active:()=>boolean,workspace?:NativeOexWorkspaceContext,writer?:ModelPreparationWriter):ModelPreparationExecution {
 if(!blobs.getBounded||typeof active!=='function')throw Error('MODEL_PREPARATION_UNAVAILABLE');
 const result:ModelPreparationExecution=Object.freeze({mode:writer?'native':'service',blobs,workspace,writer,isActive:active,assertReady:async(c:PoolClient,actor?:{tenantId:string;userId:string})=>{
  if(!active())throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');
  if(writer&&workspace){assertModelPreparationWriter(writer);if(actor&&(writer.identity.tenantId!==actor.tenantId||writer.identity.principalId!==actor.userId))throw new ApiError(403,'FORBIDDEN');await writer.assertLive();await workspace.assertDatabase(c);}
  if(!await modelPreparationSupported(c)||!active())throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');
 }});executions.add(result);return result;
}
export function createNativeModelPreparationExecution(blobs:BlobStore,workspace:NativeOexWorkspaceContext,writer:ModelPreparationWriter,active:()=>boolean){
 assertModelPreparationWriter(writer);if(!workspace||writer.identity.workspaceId!==workspace.workspaceId||writer.identity.tenantId!==workspace.tenantId||writer.identity.principalId!==workspace.principalId)throw Error('FURNISHING_LEASE_INVALID');return execution(blobs,active,workspace,writer);
}
/** Explicit service execution, used by isolated service tests. Absence of a
 * native context NEVER selects this mode implicitly. */
export function createServiceModelPreparationExecution(blobs:BlobStore,active:()=>boolean){return execution(blobs,active);}
export function assertModelPreparationExecution(value:ModelPreparationExecution,blobs:BlobStore,workspace?:NativeOexWorkspaceContext){if(!executions.has(value)||value.blobs!==blobs||value.workspace!==workspace||value.mode==='native'&&!value.writer)throw Error('MODEL_PREPARATION_UNAVAILABLE');}

export async function modelPreparationSupported(c:PoolClient){
 const result=await c.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='import_jobs'::regclass AND attname='model_preparation' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='import_jobs'::regclass AND conname='import_model_preparation_shape') AS supported");return result.rows[0]?.supported===true;
}
/** Caller holds the artwork row lock, shared with CMS approval and revision. */
export async function assertModelPreparationSlot(c:PoolClient,tenantId:string,artworkId:string,revision:number,exceptJob?:string){
 const active=await c.query("SELECT id FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND model_preparation->'request'->>'artworkRevision'=$3 AND ($4::uuid IS NULL OR id<>$4) AND (state NOT IN ('failed','cancelled') OR lease_id IS NOT NULL OR cardinality(png_worker_tokens)>0) LIMIT 1",[tenantId,artworkId,String(revision),exceptJob??null]);
 if(active.rowCount)throw new ApiError(409,'MODEL_PREPARATION_ACTIVE_IMPORT');
}
export async function assertModelPreparationContext(c:PoolClient,row:Record<string,unknown>){
 if(storedModelPreparation(row)?.sourceFull){await assertCompactVariantContext(c,row);return;}
 const intent=storedModelPreparation(row);if(!intent)throw new ApiError(409,'MODEL_PREPARATION_STATE_INVALID');
 const artwork=await artworkAccess(c,{tenantId:String(row.tenant_id),userId:String(row.user_id)},String(row.artwork_id),true);
 if(!isDeepStrictEqual(artwork.metadata?.rights,row.rights)||!allowedRights(row.rights,'display'))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
 if(intent.sourceDisplayReference){
  const source=(await c.query('SELECT snapshot FROM artwork_revisions WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[row.tenant_id,row.artwork_id,intent.artworkRevision])).rows[0]?.snapshot;
  if(!source||source.provenance?.sourceUnits!=='unknown'||source.provenance?.scaleApplied!==false||Number(row.scale_meters)!==1||intent.sourceDisplayReference.assetSha256!==row.expected_hash||!isDeepStrictEqual(source.displayReference,intent.sourceDisplayReference)||!isDeepStrictEqual(source.rights,row.rights))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
  if(artwork.revision===intent.artworkRevision){if(!isDeepStrictEqual(artwork.metadata,source))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');}
  else {
   if(row.state!=='approved'||artwork.revision!==intent.artworkRevision+1||artwork.approved_revision!==artwork.revision||artwork.approved_asset_id!==row.asset_id)throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
   const receipt=modelPreparationReceipt(row),expected={...source,displayReference:receipt.displayReference};
   const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[row.tenant_id,row.artwork_id,artwork.revision])).rows[0]?.snapshot;
   if(!isDeepStrictEqual(artwork.metadata,expected)||!isDeepStrictEqual(approval?.metadata,expected)||!isDeepStrictEqual(approval?.requiredModelPreparation,receipt)||approval?.asset?.id!==row.asset_id||approval?.asset?.sha256!==receipt.display.sha256||approval?.asset?.bytes!==receipt.display.bytes)throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
  }
 }else if(artwork.revision!==intent.artworkRevision||artwork.metadata?.displayReference)throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
 if(artwork.approved_revision===artwork.revision&&(row.state!=='approved'||artwork.approved_asset_id!==row.asset_id))throw new ApiError(409,'MODEL_PREPARATION_REVISION_APPROVED');
 if(row.state==='approved')await assertModelPreparationAssets(c,row);
}
export async function assertModelPreparationAssets(c:PoolClient,row:Record<string,unknown>){
 const receipt=modelPreparationReceipt(row),ids=[...new Set([receipt.original.assetId,receipt.display.assetId])];
 const assets=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[row.tenant_id,row.artwork_id,ids])).rows;
 if(assets.length!==ids.length)throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');
 for(const binding of [receipt.original,receipt.display]){const asset=assets.find(a=>a.id===binding.assetId);if(!asset||asset.mime!==binding.mime||asset.sha256!==binding.sha256||Number(asset.bytes)!==binding.bytes||!isDeepStrictEqual(asset.rights,row.rights)||Number(asset.scale_meters)!==Number(row.scale_meters)||asset.state!==(binding.assetId===receipt.display.assetId?'approved':'quarantine')||asset.object_key!==(binding.assetId===receipt.display.assetId?row.approved_key:row.object_key))throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');}
 const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='required-model-preparation' AND deleted_at IS NULL",[row.tenant_id,receipt.original.assetId])).rows;
 if(lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:'required-model-preparation',originalAssetId:receipt.original.assetId,displayAssetId:receipt.display.assetId,serverReceipt:receipt,provenance:'server-generated'}))throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');
}
/** Runs inside the existing import invocation/lease. This function never clears
 * its invocation token: Imports.work's finally owns that after actual close. */
export async function workRequiredModelPreparation(pool:Pool,blobs:BlobStore,row:Record<string,unknown>,lease:string,hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>},writer?:ModelPreparationWriter,nativeWorkspace?:NativeOexWorkspaceContext){
 const intent=storedModelPreparation(row);if(!intent||!blobs.getBounded)throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');
 if(intent.sourceFull)return workCompactVariant(pool,blobs,row,lease,hooks,writer,nativeWorkspace);
 await transaction(pool,c=>assertModelPreparationContext(c,row));
 const read=intent.profileId===LARGE_MODEL_RECIPE.id?blobs.getLargeModelSource:blobs.getBounded;
 if(!read)throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');
 const bytes=Buffer.from(await read.call(blobs,String(row.object_key),Number(row.expected_bytes)));if(bytes.length!==Number(row.expected_bytes)||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
 if(writer){assertModelPreparationWriter(writer);await writer.assertLive();if(writer.identity.tenantId!==row.tenant_id||writer.identity.principalId!==row.user_id)throw new ApiError(403,'FORBIDDEN');}
 const prepared=await prepareCompactModelInWorker(bytes,{bytes:bytes.length,sha256:String(row.expected_hash)},{profile:intent.profileId,writerFd:writer?.writerFd});
 await hooks?.beforeCommit?.();
 await transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];
  if(!live)return;
  if(nativeWorkspace)await nativeWorkspace.assertDatabase(c);
  if(writer){await writer.assertLive();if(!isDeepStrictEqual((live.model_preparation as {claim?:unknown}).claim,{token:lease,...writer.identity}))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');}
  if(!isDeepStrictEqual(live.model_preparation,row.model_preparation))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');await assertModelPreparationContext(c,live);
  const assetId=randomUUID(),originalAssetId=prepared.receipt.output.reusedOriginal?assetId:randomUUID(),rightsId=randomUUID(),displayKey=`${row.tenant_id}/approved/${prepared.receipt.output.sha256}`;
  // Validate original/display reference and receipt before any approved blob write.
  const receipt=createModelPreparationReceipt(live,originalAssetId,assetId,prepared.receipt);
  await blobs.put(displayKey,prepared.bytes);const stored=Buffer.from(await blobs.getBounded!(displayKey,prepared.bytes.length));if(!stored.equals(prepared.bytes))throw new ApiError(409,'ASSET_INTEGRITY');await hooks?.afterCopy?.();
  const stillCurrent=(await c.query("SELECT lease_until>clock_timestamp() AND state='processing' AND lease_id=$3 AS valid FROM import_jobs WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,lease])).rows[0];if(!stillCurrent?.valid)throw new ApiError(409,'LEASE_EXPIRED');
  await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rightsId,row.rights]);
  if(originalAssetId!==assetId)await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',$8,'quarantine')",[row.tenant_id,originalAssetId,row.artwork_id,rightsId,row.object_key,row.expected_hash,row.expected_bytes,row.scale_meters]);
  await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',$8,'approved')",[row.tenant_id,assetId,row.artwork_id,rightsId,displayKey,prepared.receipt.output.sha256,prepared.bytes.length,row.scale_meters]);
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),originalAssetId,{version:1,kind:'required-model-preparation',originalAssetId,displayAssetId:assetId,serverReceipt:receipt,provenance:'server-generated'}]);
  const committed=await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,approved_key=$5,model_preparation=$6,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,png_worker_tokens=CASE WHEN $8 THEN array_remove(png_worker_tokens,$7::uuid) ELSE png_worker_tokens END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$7 AND lease_until>clock_timestamp() AND $7::uuid=ANY(png_worker_tokens) RETURNING id",[row.tenant_id,row.id,assetId,originalAssetId===assetId?null:originalAssetId,displayKey,{kind:'required-model-compact',request:intent,result:receipt},lease,intent.profileId===LARGE_MODEL_RECIPE.id]);if(!committed.rowCount)throw new ApiError(409,'LEASE_EXPIRED');
 });
}
