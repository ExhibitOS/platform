// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {artworkAccess,transaction,sha256,type BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import {allowedRights} from './rights.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {prepareCompactModelInWorker} from './oam-original-preparation-process.ts';
import {modelReceiptDigest,storedModelPreparation,compactVariantReceipt,createCompactVariantReceipt,type ModelPreparationIntent} from './model-preparation-intent.ts';
import {assertModelPreparationSlot,assertModelPreparationWriter,type ModelPreparationExecution,type ModelPreparationWriter} from './model-preparation-import.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {qualifyApprovedCompactGeometryPair} from './approved-lod-pair.ts';

export interface CompactVariantInput {revision:number;assetId:string;sha256:string;bytes:number;idempotencyKey:string;generation:string}
function invalid():never{throw new ApiError(409,'COMPACT_VARIANT_CONTEXT_CHANGED');}
export async function assertCompactVariantContext(c:PoolClient,row:Record<string,unknown>){
 const request=storedModelPreparation(row),source=request?.sourceFull;if(!request||!source)invalid();
 const artwork=await artworkAccess(c,{tenantId:String(row.tenant_id),userId:String(row.user_id)},String(row.artwork_id),true);
 if(!isDeepStrictEqual(artwork.metadata?.rights,row.rights)||!allowedRights(row.rights,'display'))invalid();
 const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[row.tenant_id,row.artwork_id,request.artworkRevision])).rows[0]?.snapshot;
 if(!approval||modelReceiptDigest(approval)!==source.approvalSHA256||approval.asset?.id!==source.assetId||approval.asset?.sha256!==row.expected_hash||approval.asset?.bytes!==Number(row.expected_bytes)||approval.asset?.mime!=='model/gltf-binary')invalid();
 if(row.state!=='approved'&&(artwork.revision!==request.artworkRevision||artwork.approved_revision!==request.artworkRevision||artwork.approved_asset_id!==source.assetId))invalid();
 const asset=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[row.tenant_id,row.artwork_id,source.assetId])).rows[0];
 if(!asset||asset.sha256!==row.expected_hash||Number(asset.bytes)!==Number(row.expected_bytes)||asset.mime!=='model/gltf-binary'||asset.object_key!==row.object_key||Number(asset.scale_meters)!==Number(row.scale_meters)||!isDeepStrictEqual(asset.rights,row.rights))invalid();
 if(row.state==='approved')await assertCompactVariantAssets(c,row);
 return {artwork,approval,asset};
}
export async function assertCompactVariantAssets(c:PoolClient,row:Record<string,unknown>){
 const receipt=compactVariantReceipt(row);
 const coarse=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[row.tenant_id,row.artwork_id,receipt.coarse.assetId])).rows[0];
 if(!coarse||coarse.sha256!==receipt.coarse.sha256||Number(coarse.bytes)!==receipt.coarse.bytes||coarse.mime!==receipt.coarse.mime||coarse.object_key!==row.approved_key||Number(coarse.scale_meters)!==Number(row.scale_meters)||!isDeepStrictEqual(coarse.rights,row.rights))invalid();
 const links=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='approved-full-compact' AND metadata->'serverReceipt'->>'jobId'=$3 AND deleted_at IS NULL",[row.tenant_id,receipt.sourceFull.assetId,row.id])).rows;
 if(links.length!==1||!isDeepStrictEqual(links[0].metadata,{version:1,kind:'approved-full-compact',serverReceipt:receipt,provenance:'server-generated'}))invalid();
 return receipt;
}
export async function createCompactVariant(c:PoolClient,s:Session,artworkId:string,input:CompactVariantInput,execution:ModelPreparationExecution){
 const keys=['assetId','bytes','generation','idempotencyKey','revision','sha256'];
 if(!input||Object.keys(input).sort().join(',')!==keys.join(',')||!Number.isSafeInteger(input.revision)||input.revision<1||!Number.isSafeInteger(input.bytes)||input.bytes<28||input.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(input.sha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.assetId)||![input.generation,input.idempotencyKey].every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v)))throw new ApiError(400,'INVALID_COMPACT_VARIANT');
 await artworkAccess(c,s,artworkId,true);await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,artworkId]);
 await execution.assertReady(c,s);
 const hash=modelReceiptDigest({purpose:'approved-full-compact',artworkId,...input});
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
 const prior=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey])).rows[0];
 if(prior){if(prior.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');if(prior.request_hash!==hash||!storedModelPreparation(prior)?.sourceFull)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');await assertCompactVariantContext(c,prior);return prior;}
 const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,input.revision])).rows[0]?.snapshot;
 const source=(await c.query('SELECT a.* FROM assets a WHERE tenant_id=$1 AND artwork_id=$2 AND id=$3',[s.tenantId,artworkId,input.assetId])).rows[0];
 if(!approval||!source||source.sha256!==input.sha256||Number(source.bytes)!==input.bytes)invalid();
 const request:ModelPreparationIntent={version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:input.idempotencyKey,generation:input.generation,artworkRevision:input.revision,sourceFull:{assetId:input.assetId,approvalSHA256:modelReceiptDigest(approval)}};
 const id=randomUUID(),row={tenant_id:s.tenantId,id,user_id:s.userId,artwork_id:artworkId,idempotency_key:input.idempotencyKey,request_hash:hash,mime:'model/gltf-binary',expected_hash:input.sha256,expected_bytes:input.bytes,rights:approval.metadata?.rights,object_key:source.object_key,approved_key:source.object_key,scale_meters:Number(source.scale_meters),state:'queued',png_drain_version:1,model_preparation:{kind:'required-model-compact',request}};
 await assertCompactVariantContext(c,row);await assertModelPreparationSlot(c,s.tenantId,artworkId,input.revision);
 return (await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,png_drain_version,model_preparation,state,progress) VALUES($1,$2,$3,$4,$5,$6,'model/gltf-binary',$7,$8,$9,$10,$10,$11,1,$12,'queued',10) RETURNING *",[s.tenantId,id,s.userId,artworkId,input.idempotencyKey,hash,input.sha256,input.bytes,row.rights,row.object_key,row.scale_meters,row.model_preparation])).rows[0];
}
export async function workCompactVariant(pool:Pool,blobs:BlobStore,row:Record<string,unknown>,lease:string,hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>},writer?:ModelPreparationWriter,workspace?:NativeOexWorkspaceContext){
 if(!blobs.getBounded)throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');
 await transaction(pool,c=>assertCompactVariantContext(c,row));
 const full=Buffer.from(await blobs.getBounded(String(row.object_key),Number(row.expected_bytes)));
 if(full.length!==Number(row.expected_bytes)||sha256(full)!==row.expected_hash)throw new ApiError(409,'ASSET_INTEGRITY');
 if(writer){assertModelPreparationWriter(writer);await writer.assertLive();}
 const output=await prepareCompactModelInWorker(full,{bytes:full.length,sha256:String(row.expected_hash)},{writerFd:writer?.writerFd});
 if(output.receipt.output.reusedOriginal)throw new ApiError(409,'COMPACT_VARIANT_ALREADY_SATISFIED');
 qualifyApprovedCompactGeometryPair(full,output.bytes,{fullTriangles:output.receipt.source.triangles,coarseTriangles:output.receipt.output.triangles,fullTextureSize:Math.max(...output.receipt.images.flatMap(i=>[i.width,i.height])),reducedTextureSize:output.receipt.output.textureEdge});
 await hooks?.beforeCommit?.();
 await transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[row.tenant_id,row.artwork_id]);
  const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];if(!live)return;
  if(workspace)await workspace.assertDatabase(c);if(writer){await writer.assertLive();if(!isDeepStrictEqual(live.model_preparation.claim,{token:lease,...writer.identity}))invalid();}
  if(!isDeepStrictEqual(live.model_preparation,row.model_preparation))invalid();await assertCompactVariantContext(c,live);
  const coarseId=randomUUID(),rightsId=randomUUID(),key=`${row.tenant_id}/approved/${output.receipt.output.sha256}`;
  await blobs.put(key,output.bytes);if(!Buffer.from(await blobs.getBounded!(key,output.bytes.length)).equals(output.bytes))throw new ApiError(409,'ASSET_INTEGRITY');await hooks?.afterCopy?.();
  await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rightsId,row.rights]);
  await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',$8,'approved')",[row.tenant_id,coarseId,row.artwork_id,rightsId,key,output.receipt.output.sha256,output.bytes.length,row.scale_meters]);
  const receipt=createCompactVariantReceipt(live,coarseId,output.receipt),request=storedModelPreparation(live)!;
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),receipt.sourceFull.assetId,{version:1,kind:'approved-full-compact',serverReceipt:receipt,provenance:'server-generated'}]);
  const done=await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,approved_key=$5,model_preparation=$6,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$7 AND lease_until>clock_timestamp() RETURNING id",[row.tenant_id,row.id,coarseId,receipt.sourceFull.assetId,key,{kind:'required-model-compact',request,result:receipt},lease]);if(!done.rowCount)throw new ApiError(409,'LEASE_EXPIRED');
 });
}

/** An immutable CMS snapshot is the only publication binding; current rights,
 * source custody and the actual drained producer receipt are checked again. */
export async function applyCompactVariantApproval(c:PoolClient,s:Session,artworkId:string,artwork:import('@exhibitos/spec').Artwork,value:unknown){
 const claimed=value as {jobId?:string};if(!claimed||typeof claimed.jobId!=='string')invalid();
 const row=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND id=$3 AND state='approved' FOR SHARE",[s.tenantId,artworkId,claimed.jobId])).rows[0];
 if(!row||row.user_id!==s.userId||row.lease_id!=null||!Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length)invalid();
 await assertCompactVariantContext(c,row);const receipt=compactVariantReceipt(row);
 if(!isDeepStrictEqual(receipt,value)||artwork.primaryAssetId!==receipt.sourceFull.assetId||!isDeepStrictEqual(artwork.rights,row.rights))invalid();
 const full=artwork.assets.find(a=>a.id===receipt.sourceFull.assetId);
 if(!full||full.sha256!==receipt.sourceFull.sha256||full.bytes!==receipt.sourceFull.bytes||full.mime!==receipt.sourceFull.mime||artwork.assets.some(a=>a.id===receipt.coarse.assetId))invalid();
 artwork.assets.push({id:receipt.coarse.assetId,path:`assets/${receipt.coarse.assetId}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:receipt.coarse.bytes,sha256:receipt.coarse.sha256});
 artwork.extensions={...artwork.extensions,'org.exhibitos.viewer/lod':{version:1,profile:receipt.publicationProfile,variants:[{assetId:full.id,detail:'full',triangles:receipt.producer.source.triangles,textureSize:Math.max(...receipt.producer.images.flatMap(i=>[i.width,i.height]))},{assetId:receipt.coarse.assetId,detail:'coarse',triangles:receipt.producer.output.triangles,textureSize:receipt.producer.output.textureEdge}]}};
}
