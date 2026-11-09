// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {artworkAccess,transaction,sha256} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import type {Imports,ImportInput} from './imports.ts';
import {allowedRights,validRights} from './rights.ts';
import {freshImageIntent} from './fresh-image-intent.ts';
import {PRODUCT_IMAGE_LIMITS} from './product-image-preparation.ts';
import {prepareFreshImageInWorker,prepareProductImageInWorker} from './product-image-preparation-process.ts';
import {canonicalImageHash,productImageIntent,storedPreparedImage,preparedImageReceipt,type FreshImageState,type ProductImageState,type ProductImageReceipt} from './product-image-intent.ts';
export async function createProductImageImport(imports:Imports,c:PoolClient,s:Session,input:ImportInput){
 if(!imports.blobs.putDurable)throw new ApiError(503,'IMAGE_PREPARATION_STORAGE_UNAVAILABLE');
 const fresh=input.imagePreparation!==undefined;
 if(fresh)await imports.freshImageReady(c,s);else await imports.requiredModelReady(c,s);
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 const binding={workspaceId:owner.workspaceId,principalId:s.userId};
 const state:FreshImageState|ProductImageState=fresh
  ?{...binding,kind:'fresh-product-image',request:freshImageIntent(input.imagePreparation)}
  :{...binding,kind:'product-image-pair',request:productImageIntent(input.coarsePreparation)};
 const request=state.request;
 if((input.mime!=='image/jpeg'&&(!fresh||input.mime!=='image/png'))||fresh&&input.coarsePreparation!==undefined||input.derived!==undefined||input.modelDerivation!==undefined||input.modelPreparation!==undefined||input.scaleMeters!==1||!Number.isSafeInteger(input.bytes)||input.bytes<4||input.bytes>PRODUCT_IMAGE_LIMITS.sourceBytes||!/^[a-f0-9]{64}$/.test(input.sha256)||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<1||input.idempotencyKey.length>128||!validRights(input.rights))throw new ApiError(400,'IMAGE_PREPARATION_INPUT_INVALID');
 await artworkAccess(c,s,input.artworkId,true);await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,input.artworkId]);
 const artwork=await artworkAccess(c,s,input.artworkId,true),requestHash=canonicalImageHash(fresh?{...input,imagePreparation:request}:{...input,coarsePreparation:request});
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
 const prior=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey])).rows[0];
 if(prior){const state=storedPreparedImage(prior);if(!state||state.principalId!==s.userId||state.workspaceId!==owner.workspaceId)throw new ApiError(403,'FORBIDDEN');if(prior.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');await assertProductImageAssets(c,prior);return imports.view(prior);}
 await assertImagePreparationArtwork(c,s,input.artworkId,artwork,state,input.rights);
 const id=randomUUID(),prefix=`${s.tenantId}/quarantine/import-${id}`;
 const row=(await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key,png_drain_version) VALUES($1,$2,$3,$4,$5,$6,$14,$7,$8,$9,$10,$11,1,$12,$13,1) RETURNING *",[s.tenantId,id,s.userId,input.artworkId,input.idempotencyKey,requestHash,input.sha256,input.bytes,input.rights,`${prefix}/${input.sha256}`,`${prefix}/pending-output`,state,`${prefix}/product-full`,input.mime])).rows[0];return imports.view(row);
}
async function assertImagePreparationArtwork(c:PoolClient,s:Pick<Session,'tenantId'|'userId'>,artworkId:string,
 artwork:Awaited<ReturnType<typeof artworkAccess>>,state:ProductImageState|FreshImageState,rights:unknown){
 if(artwork.revision!==state.request.artworkRevision||artwork.metadata?.displayReference||
    !isDeepStrictEqual(artwork.metadata?.rights,rights)||!allowedRights(rights,'display')||!allowedRights(rights,'export')){
  throw new ApiError(409,'IMAGE_PREPARATION_CONTEXT_CHANGED');
 }
 if(state.kind==='fresh-product-image'){
  const prior=await c.query('SELECT 1 FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 LIMIT 1',[s.tenantId,artworkId]);
  if(artwork.approved_revision!=null||artwork.approved_asset_id!=null||prior.rowCount)throw new ApiError(409,'IMAGE_PREPARATION_CONTEXT_CHANGED');
  return;
 }
 const approved=(await c.query("SELECT mime FROM assets WHERE tenant_id=$1 AND artwork_id=$2 AND id=$3 AND state='approved' AND deleted_at IS NULL",
  [s.tenantId,artworkId,artwork.approved_asset_id])).rows[0];
 if(artwork.approved_revision!==artwork.revision||approved?.mime!=='image/png')throw new ApiError(409,'IMAGE_PREPARATION_CONTEXT_CHANGED');
}
export async function assertProductImageAssets(c:PoolClient,row:Record<string,unknown>){
 const state=storedPreparedImage(row);if(!state)return;if(row.state!=='approved'){if(row.asset_id!=null||row.original_asset_id!=null)throw new ApiError(409,'IMAGE_PREPARATION_STATE_INVALID');return;}
 const r=preparedImageReceipt(row),bindings=[r.original,r.full,...(r.coarse?[r.coarse]:[])];
 const assets=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[row.tenant_id,row.artwork_id,bindings.map(x=>x.assetId)])).rows;
 if(assets.length!==bindings.length)throw new ApiError(409,'IMAGE_PREPARATION_RECEIPT_INVALID');
 for(const binding of bindings){const a=assets.find(x=>x.id===binding.assetId),original=binding.assetId===r.original.assetId,key=original?row.object_key:binding.assetId===r.full.assetId?row.approved_key:`${row.tenant_id}/quarantine/import-${row.id}/product-coarse`;if(!a||a.sha256!==binding.sha256||Number(a.bytes)!==binding.bytes||a.mime!==binding.mime||a.object_key!==key||a.state!==(original?'quarantine':'approved')||Number(a.scale_meters)!==1||!isDeepStrictEqual(a.rights,row.rights)||!allowedRights(a.rights,'display')||!allowedRights(a.rights,'export'))throw new ApiError(409,'IMAGE_PREPARATION_RECEIPT_INVALID');}
 const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='product-image-preparation' AND deleted_at IS NULL",[row.tenant_id,r.original.assetId])).rows;
 if(lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:'product-image-preparation',serverReceipt:r,provenance:'server-generated'}))throw new ApiError(409,'IMAGE_PREPARATION_RECEIPT_INVALID');
}
export async function workProductImageImport(imports:Imports,row:Record<string,unknown>,lease:string,hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>}){
 const state=storedPreparedImage(row);if(!state)throw new ApiError(409,'IMAGE_PREPARATION_STATE_INVALID');
 const actor={tenantId:String(row.tenant_id),userId:String(row.user_id)};
 const fresh=state.kind==='fresh-product-image';
 const assertReady=(c:PoolClient)=>fresh?imports.freshImageReady(c,actor):imports.requiredModelReady(c,actor);
 await transaction(imports.pool,async c=>{await assertReady(c);await imports.coarseOwner(c,String(row.tenant_id),String(row.user_id),state.workspaceId);});
 const writer=imports.modelExecution?.writer,source=Buffer.from(await imports.boundedBlob(String(row.object_key),Number(row.expected_bytes)));
 const mime=row.mime;
 if(mime!=='image/jpeg'&&mime!=='image/png')throw new ApiError(409,'IMAGE_PREPARATION_STATE_INVALID');
 const identity={sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)};
 const result=fresh?await prepareFreshImageInWorker(source,{...identity,mime},{writerFd:writer?.writerFd}):
  await prepareProductImageInWorker(source,identity,{writerFd:writer?.writerFd});
 await hooks?.beforeCommit?.();
 await transaction(imports.pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  // Approval/create lock artwork before job; retain the same order.
  await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[row.tenant_id,row.artwork_id]);
  const artwork=await artworkAccess(c,{tenantId:String(row.tenant_id),userId:String(row.user_id)},String(row.artwork_id),true);
  const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];if(!live)return;
  await assertReady(c);await imports.coarseOwner(c,String(row.tenant_id),String(row.user_id),state.workspaceId);if(writer)await writer.assertLive();
  if(!isDeepStrictEqual(live.derived,row.derived))throw new ApiError(409,'IMAGE_PREPARATION_CONTEXT_CHANGED');
  await assertImagePreparationArtwork(c,actor,String(row.artwork_id),artwork,state,row.rights);
  const originalId=randomUUID(),fullId=randomUUID(),coarseId=result.coarse?randomUUID():undefined,rightsId=randomUUID(),approvedKey=`${row.tenant_id}/approved/${result.receipt.full.sha256}`,coarseKey=`${row.tenant_id}/quarantine/import-${row.id}/product-coarse`;
  const body={version:1 as const,jobId:String(row.id),artworkId:String(row.artwork_id),artworkRevision:state.request.artworkRevision,workspaceId:state.workspaceId,principalId:state.principalId,rightsSHA256:canonicalImageHash(row.rights),original:{assetId:originalId,sha256:String(row.expected_hash),bytes:Number(row.expected_bytes),mime},full:{...result.receipt.full,assetId:fullId,mime:'image/png' as const},...(coarseId?{coarse:{...result.receipt.coarse!,assetId:coarseId,mime:'image/png' as const}}:{}),producer:result.receipt} satisfies Omit<ProductImageReceipt<'image/jpeg'|'image/png'>,'sha256'>;
  const receipt:ProductImageReceipt<'image/jpeg'|'image/png'>={...body,sha256:canonicalImageHash(body)},derived={...state,result:receipt};
  preparedImageReceipt({...live,state:'approved',derived,asset_id:fullId,original_asset_id:originalId,approved_key:approvedKey});
  const putDurable=imports.blobs.putDurable?.bind(imports.blobs);
  if(!putDurable)throw new ApiError(503,'IMAGE_PREPARATION_STORAGE_UNAVAILABLE');
  const put=async(key:string,bytes:Buffer)=>{
   await putDurable(key,bytes);
   if(sha256(Buffer.from(await imports.boundedBlob(key,bytes.length)))!==sha256(bytes))throw new ApiError(409,'ASSET_INTEGRITY');
  };
  await put(String(row.derived_object_key),result.full);if(result.coarse)await put(coarseKey,result.coarse);await put(approvedKey,result.full);await hooks?.afterCopy?.();
  await assertReady(c);
  await imports.coarseOwner(c,String(row.tenant_id),String(row.user_id),state.workspaceId);
  if(writer)await writer.assertLive();
  if(!allowedRights(live.rights,'display')||!allowedRights(live.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
  await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rightsId,row.rights]);
  for(const [binding,key,assetState] of [[receipt.original,row.object_key,'quarantine'],[receipt.full,approvedKey,'approved'],...(receipt.coarse?[[receipt.coarse,coarseKey,'approved']]:[])] as const){const b=binding as ProductImageReceipt<'image/jpeg'|'image/png'>['original']|ProductImageReceipt['full'];await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,1,$9)",[row.tenant_id,b.assetId,row.artwork_id,rightsId,key,b.sha256,b.bytes,b.mime,assetState]);}
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),originalId,{version:1,kind:'product-image-preparation',serverReceipt:receipt,provenance:'server-generated'}]);
  const committed=await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,approved_key=$5,derived=$6,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,png_worker_tokens=CASE WHEN $8 THEN array_remove(png_worker_tokens,$7::uuid) ELSE png_worker_tokens END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$7 AND lease_until>clock_timestamp() AND $7::uuid=ANY(png_worker_tokens) RETURNING id",[row.tenant_id,row.id,fullId,originalId,approvedKey,derived,lease,fresh]);if(!committed.rowCount)throw new ApiError(409,'LEASE_EXPIRED');
 });
}
