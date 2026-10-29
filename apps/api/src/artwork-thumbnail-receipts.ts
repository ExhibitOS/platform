// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {Cms,validMetadata} from './cms.ts';
import {allowedRights} from './rights.ts';
import {parseThumbnailCandidate,validateThumbnailBytes} from './artwork-thumbnail.ts';

/** A receipt authorizes a representative image; it does not prove pixel derivation. */
export class ArtworkThumbnailReceipts {
 readonly cms:Cms;
 readonly blobs:BlobStore;
 constructor(blobs:BlobStore){this.blobs=blobs;this.cms=new Cms(blobs);}
 /** Pin the selected receipt while publication prepares its optional derivative. */
 async selectedForPublication(c:PoolClient,s:Session,artworkId:string,revision:number,sourceId:string,sourceHash:string){
  const approved=await this.cms.studioArtwork(c,s,artworkId);
  const primary=approved.artwork.assets.find(a=>a.id===sourceId);
  if(approved.artwork.revision!==revision||approved.artwork.primaryAssetId!==sourceId||primary?.sha256!==sourceHash)throw new ApiError(409,'REVISION_CONFLICT');
  const art=(await c.query('SELECT * FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',[s.tenantId,artworkId])).rows[0];
  if(!art)throw new ApiError(409,'REVISION_CONFLICT');
  if(art.revision!==revision||art.approved_revision!==revision||art.approved_asset_id!==sourceId||!validMetadata(art.metadata)||!allowedRights(art.metadata.rights,'display'))throw new ApiError(409,'REVISION_CONFLICT');
  const row=(await c.query(`SELECT b.*,a.sha256 AS current_hash,a.bytes AS current_bytes,a.object_key AS current_key,a.mime,a.state,a.deleted_at,r.metadata AS rights,r.deleted_at AS rights_deleted
   FROM artwork_thumbnail_selections sel JOIN artwork_thumbnail_bindings b ON (b.tenant_id,b.id)=(sel.tenant_id,sel.binding_id)
   JOIN assets a ON (a.tenant_id,a.id)=(b.tenant_id,b.thumbnail_asset_id) JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id)
   WHERE sel.tenant_id=$1 AND sel.artwork_id=$2 AND sel.artwork_revision=$3 AND b.artwork_id=$2 AND b.artwork_revision=$3 AND a.artwork_id=$2 FOR SHARE OF sel,a,r`,[s.tenantId,artworkId,revision])).rows[0];
  if(!row)return undefined;
  if(row.source_asset_id!==sourceId||row.source_sha256!==sourceHash||row.current_hash!==row.sha256||Number(row.current_bytes)!==Number(row.bytes)||row.current_key!==row.object_key||row.mime!=='image/png'||row.state!=='approved'||row.deleted_at||row.rights_deleted||!allowedRights(row.rights,'display'))throw new ApiError(409,'ASSET_INTEGRITY');
  const bytes=Buffer.from(await this.blobs.get(row.object_key));
  if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  await validateThumbnailBytes(bytes);
  if(!allowedRights(art.metadata.rights,'display')||!allowedRights(row.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');
  return {id:row.id,assetId:row.thumbnail_asset_id,sha256:row.sha256,bytes};
 }
 async current(c:PoolClient,s:Session,artworkId:string,expectedRevision:number){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483647)throw new ApiError(400,'INVALID_INPUT');
  const art=await this.cms.ownArtwork(c,s,artworkId);
  if(art.revision!==expectedRevision||art.approved_revision!==expectedRevision)throw new ApiError(409,'REVISION_CONFLICT');
  const selected=(await c.query('SELECT binding_id,version FROM artwork_thumbnail_selections WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3',[s.tenantId,artworkId,expectedRevision])).rows[0];
  return {selectionVersion:selected?.version??0,bindingId:selected?.binding_id??null};
 }
 async select(c:PoolClient,s:Session,artworkId:string,value:unknown){
  const input=parseThumbnailCandidate(value),art=await this.cms.ownArtwork(c,s,artworkId);
  if(!validMetadata(art.metadata)||art.revision!==input.expectedRevision||art.approved_revision!==art.revision||art.approved_asset_id!==input.sourceAssetId)throw new ApiError(409,'REVISION_CONFLICT');
  if(!allowedRights(art.metadata.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');
  const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,art.revision])).rows[0]?.snapshot;
  const primary=approval?.asset;
  if(!primary||primary.id!==input.sourceAssetId||primary.sha256!==input.sourceSha256||!isDeepStrictEqual(approval.metadata,art.metadata))throw new ApiError(409,'APPROVAL_INVALID');
  const readAsset=async(id:string)=>{
   const row=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,artworkId,id])).rows[0];
   if(!row||!allowedRights(row.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');return row;
  };
  const source=await readAsset(input.sourceAssetId),thumb=await readAsset(input.thumbnailAssetId);
  if(source.sha256!==input.sourceSha256||Number(source.bytes)!==primary.bytes||source.mime!==primary.mime||thumb.sha256!==input.thumbnailSha256||thumb.mime!=='image/png'||Number(thumb.bytes)>512*1024||input.view.kind==='orbit'&&source.mime!=='model/gltf-binary')throw new ApiError(409,'ASSET_INTEGRITY');
  const payload={artworkId,revision:input.expectedRevision,sourceAssetId:input.sourceAssetId,sourceSha256:input.sourceSha256,thumbnailAssetId:input.thumbnailAssetId,thumbnailSha256:input.thumbnailSha256,expectedSelectionVersion:input.expectedSelectionVersion,view:input.view};
  const digest=sha256(Buffer.from(JSON.stringify(payload)));
  const prior=(await c.query('SELECT id,payload_sha256,selection_version FROM artwork_thumbnail_bindings WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0];
  if(prior){if(prior.payload_sha256!==digest)throw new ApiError(409,'REQUEST_CONFLICT');const current=(await c.query('SELECT binding_id,version FROM artwork_thumbnail_selections WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3',[s.tenantId,artworkId,art.revision])).rows[0];return {id:prior.id,selectionVersion:prior.selection_version,selected:current?.binding_id===prior.id};}
  const selection=(await c.query('SELECT binding_id,version FROM artwork_thumbnail_selections WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3 FOR UPDATE',[s.tenantId,artworkId,art.revision])).rows[0];
  if((selection?.version??0)!==input.expectedSelectionVersion||input.expectedSelectionVersion>=2147483647)throw new ApiError(409,'SELECTION_CONFLICT');
  const sourceBytes=Buffer.from(await this.blobs.get(source.object_key)),thumbBytes=Buffer.from(await this.blobs.get(thumb.object_key));
  if(sourceBytes.length!==Number(source.bytes)||sha256(sourceBytes)!==source.sha256||thumbBytes.length!==Number(thumb.bytes)||sha256(thumbBytes)!==thumb.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  await validateThumbnailBytes(thumbBytes);
  // This lock-backed authority check repeats after asynchronous I/O and decode.
  const current=await this.cms.ownArtwork(c,s,artworkId),sourceAgain=await readAsset(input.sourceAssetId),thumbAgain=await readAsset(input.thumbnailAssetId);
  if(current.revision!==input.expectedRevision||current.approved_revision!==current.revision||current.approved_asset_id!==input.sourceAssetId||!validMetadata(current.metadata)||!isDeepStrictEqual(current.metadata,approval.metadata)||!allowedRights(current.metadata.rights,'display')||sourceAgain.sha256!==source.sha256||thumbAgain.sha256!==thumb.sha256)throw new ApiError(409,'REVISION_CONFLICT');
  const id=randomUUID(),version=input.expectedSelectionVersion+1;
  await c.query('INSERT INTO artwork_thumbnail_bindings(tenant_id,id,artwork_id,artwork_revision,source_asset_id,source_sha256,thumbnail_asset_id,selection_version,sha256,bytes,object_key,view,recipe,created_by,request_id,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[s.tenantId,id,artworkId,art.revision,source.id,source.sha256,thumb.id,version,thumb.sha256,Number(thumb.bytes),thumb.object_key,input.view,{version:1,kind:'authorized-representative-image'},s.userId,input.requestId,digest]);
  if(selection){const updated=await c.query('UPDATE artwork_thumbnail_selections SET binding_id=$4,version=$5 WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3 AND version=$6',[s.tenantId,artworkId,art.revision,id,version,input.expectedSelectionVersion]);if(!updated.rowCount)throw new ApiError(409,'SELECTION_CONFLICT');}
  else await c.query('INSERT INTO artwork_thumbnail_selections(tenant_id,artwork_id,artwork_revision,version,binding_id) VALUES($1,$2,$3,$4,$5)',[s.tenantId,artworkId,art.revision,version,id]);
  await c.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action:'cms.thumbnail-selected',actor:s.userId,target:artworkId,revision:art.revision,bindingId:id}]);
  return {id,selectionVersion:version,selected:true};
 }
}
