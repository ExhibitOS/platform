import {storedCurrentImageThumbnail,currentImageThumbnailView} from './current-image-thumbnail.ts';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {ApiError,uuid,type Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {allowedRights} from './rights.ts';
import {preparedImageReceipt,productImageDrained,storedPreparedImage} from './product-image-intent.ts';
import {storedImageCoarse} from './image-coarse-intent.ts';

export interface ImageLineageQuery {expectedRevision:number;approvedAssetId:string;cursor?:string}
/** Discover only owned jobs whose actual output ID is the current approved Full.
 * Empty pages say nothing about foreign/historical jobs or unregistered sources.
 * A reviewable receipt never replaces the existing native repair authority. */
export async function imagePreparationLineage(c:PoolClient,s:Session,artworkId:string,input:ImageLineageQuery,
 cms:Pick<Cms,'ownArtwork'|'studioArtwork'>,imports:Pick<Imports,'coarseOwner'|'access'>){
 uuid(artworkId);uuid(input.approvedAssetId);if(input.cursor!==undefined)uuid(input.cursor);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||input.expectedRevision>2147483647)throw new ApiError(400,'INVALID_INPUT');
 artworkId=artworkId.toLowerCase();
 const approvedAssetId=input.approvedAssetId.toLowerCase(),owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 const current=async()=>{
  const art=await cms.ownArtwork(c,s,artworkId);
  if(art.revision!==input.expectedRevision||art.approved_revision!==input.expectedRevision||art.approved_asset_id!==approvedAssetId)throw new ApiError(409,'REVISION_CONFLICT');
  if(!allowedRights(art.metadata?.rights,'display')||!allowedRights(art.metadata?.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
  return art;
 };
 const art=await current(),{artwork}=await cms.studioArtwork(c,s,artworkId);
 const full=artwork.assets.find(asset=>asset.id===approvedAssetId);
 if(artwork.revision!==input.expectedRevision||artwork.primaryAssetId!==approvedAssetId||artwork.artworkType!=='image'||full?.mime!=='image/png'||!isDeepStrictEqual(artwork.rights,art.metadata.rights))throw new ApiError(409,'APPROVAL_INVALID');
 const selected=await c.query('SELECT binding_id,version FROM artwork_thumbnail_selections WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3',[s.tenantId,artworkId,input.expectedRevision]);
 const page=await c.query(`SELECT id FROM import_jobs WHERE tenant_id=$1 AND user_id=$2 AND artwork_id=$3 AND asset_id=$4
  AND mime IN ('image/jpeg','image/png')
  AND (derived->>'workspaceId' IS NULL OR derived->>'workspaceId'=$5)
  AND (derived->'viewerCoarse'->>'workspaceId' IS NULL OR derived->'viewerCoarse'->>'workspaceId'=$5)
  AND ($6::uuid IS NULL OR id>$6::uuid) ORDER BY id LIMIT 21`,[s.tenantId,s.userId,artworkId,approvedAssetId,owner.workspaceId,input.cursor?.toLowerCase()??null]);
 const items=[];
 for(const entry of page.rows.slice(0,20)){
  const row=await imports.access(c,s,String(entry.id));
  if(row.id!==entry.id||row.tenant_id!==s.tenantId||row.user_id!==s.userId||row.artwork_id!==artworkId||row.asset_id!==approvedAssetId)throw new ApiError(409,'IMAGE_PREPARATION_CONTEXT_CHANGED');
  const thumbnail=storedCurrentImageThumbnail(row);
  if(thumbnail){
   if(thumbnail.workspaceId!==owner.workspaceId)throw new ApiError(403,'FORBIDDEN');
   if(thumbnail.source.assetId!==approvedAssetId||thumbnail.source.sha256!==full.sha256||thumbnail.source.bytes!==full.bytes)throw new ApiError(409,'ASSET_INTEGRITY');
   const view=currentImageThumbnailView(row)!;
   const disposition=!isDeepStrictEqual(row.rights,art.metadata.rights)?'rights-changed':selected.rowCount?'thumbnail-already-selected':view.status==='ready'?'reviewable-thumbnail-selection':'not-ready';
   items.push({jobId:row.id,kind:thumbnail.kind,state:row.state,workerDrained:view.workerDrained,disposition,thumbnailPreparation:view,repair:null});
   continue;
  }
  const prepared=storedPreparedImage(row),coarse=storedImageCoarse(row);
  if(prepared&&prepared.workspaceId!==owner.workspaceId||coarse&&coarse.workspaceId!==owner.workspaceId)throw new ApiError(403,'FORBIDDEN');
  const kind=prepared?.kind??(coarse?'client-declared-image-with-coarse':row.derived?'client-declared-image':'image-import');
  const drained=productImageDrained(row),receipt=prepared&&row.state==='approved'?preparedImageReceipt(row):undefined;
  if(receipt&&(receipt.full.assetId!==approvedAssetId||receipt.full.sha256!==full.sha256||receipt.full.bytes!==full.bytes))throw new ApiError(409,'ASSET_INTEGRITY');
  const reason=kind!=='product-image-pair'?'unsupported-repair-kind':!receipt||row.state!=='approved'||!drained?'not-ready':!isDeepStrictEqual(row.rights,art.metadata.rights)?'rights-changed':selected.rowCount?'thumbnail-already-selected':'reviewable-repair';
  items.push({jobId:row.id,kind,state:row.state,workerDrained:drained,disposition:reason,
   ...(receipt?{serverReceipt:receipt}:{}),
   repair:reason==='reviewable-repair'?{kind:'product-image-thumbnail-repair-v1',importJobId:row.id,artworkId,artworkRevision:input.expectedRevision}:null});
 }
 const again=await current();
 if(!isDeepStrictEqual(again.metadata.rights,art.metadata.rights))throw new ApiError(409,'REVISION_CONFLICT');
 return {scope:'current-owner-current-approved-full' as const,artworkId,revision:input.expectedRevision,
  full:{assetId:full.id,sha256:full.sha256,bytes:full.bytes,mime:full.mime},
  selection:{selectionVersion:selected.rows[0]?.version??0,bindingId:selected.rows[0]?.binding_id??null},items,
  nextCursor:page.rows.length>20?String(page.rows[19]!.id):null};
}
