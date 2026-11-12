// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {MAX_ARTWORK_THUMBNAIL_BYTES} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {Cms,validMetadata} from './cms.ts';
import {allowedRights} from './rights.ts';
import {parseThumbnailCandidate,parseRenderedThumbnail,validateThumbnailBytes,RENDERED_ARTWORK_THUMBNAIL_PROFILE,RENDERED_ARTWORK_THUMBNAIL_RECIPE,RENDERED_ARTWORK_THUMBNAIL_TOOL} from './artwork-thumbnail.ts';

export interface FrozenThumbnailPin {artworkId:string;revision:number;bindingId:string;sourceAssetId:string;sourceSha256:string;thumbnailAssetId:string;thumbnailSha256:string;bytes:number}
export function validFrozenThumbnailPin(pin:FrozenThumbnailPin){
 const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 return !!pin&&typeof pin==='object'&&!Array.isArray(pin)&&Object.keys(pin).sort().join(',')==='artworkId,bindingId,bytes,revision,sourceAssetId,sourceSha256,thumbnailAssetId,thumbnailSha256'&&[pin.artworkId,pin.bindingId,pin.sourceAssetId,pin.thumbnailAssetId].every(x=>typeof x==='string'&&uuidPattern.test(x))&&[pin.sourceSha256,pin.thumbnailSha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))&&Number.isSafeInteger(pin.revision)&&pin.revision>=1&&pin.revision<=2147483647&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=1&&pin.bytes<=512*1024;
}

/** A receipt authorizes a representative image; it does not prove pixel derivation. */
export class ArtworkThumbnailReceipts {
 readonly cms:Cms;
 readonly blobs:BlobStore;
 constructor(blobs:BlobStore){this.blobs=blobs;this.cms=new Cms(blobs);}
 /** Revalidate an immutable receipt by ID, never the mutable current selection. */
 async pinnedForExport(c:PoolClient,s:Session,pin:FrozenThumbnailPin){
  if(!validFrozenThumbnailPin(pin))throw new ApiError(409,'OEX_SOURCE_CHANGED');
  const current=await this.cms.ownArtwork(c,s,pin.artworkId);
  const row=(await c.query(`SELECT b.*,a.sha256 AS current_hash,a.bytes AS current_bytes,a.object_key AS current_key,a.mime,a.state,a.deleted_at,r.metadata AS rights,r.deleted_at AS rights_deleted,ap.snapshot AS approval
   FROM artwork_thumbnail_bindings b JOIN artwork_approvals ap ON (ap.tenant_id,ap.artwork_id,ap.revision)=(b.tenant_id,b.artwork_id,b.artwork_revision)
   JOIN assets a ON (a.tenant_id,a.id,a.artwork_id)=(b.tenant_id,b.thumbnail_asset_id,b.artwork_id) JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id)
   WHERE b.tenant_id=$1 AND b.id=$2 AND b.artwork_id=$3 FOR SHARE OF a,r`,[s.tenantId,pin.bindingId,pin.artworkId])).rows[0];
  if(!row||!current.cms_managed||!validMetadata(current.metadata)||!validMetadata(row.approval?.metadata)||row.artwork_revision!==pin.revision||row.source_asset_id!==pin.sourceAssetId||row.source_sha256!==pin.sourceSha256||row.thumbnail_asset_id!==pin.thumbnailAssetId||row.sha256!==pin.thumbnailSha256||Number(row.bytes)!==pin.bytes||row.approval.asset?.id!==pin.sourceAssetId||row.approval.asset?.sha256!==pin.sourceSha256||row.current_hash!==pin.thumbnailSha256||Number(row.current_bytes)!==pin.bytes||row.current_key!==row.object_key||row.mime!=='image/png'||row.state!=='approved'||row.deleted_at||row.rights_deleted)throw new ApiError(409,'OEX_SOURCE_CHANGED');
  const rights=[current.metadata.rights,row.approval.metadata.rights,row.rights];
  if(rights.some(r=>!allowedRights(r,'display')||!allowedRights(r,'export')))throw new ApiError(403,'RIGHTS_DENIED');
  return {rights,objectKey:row.object_key as string};
 }
 /** Read only the pinned bytes, with a bounded store read and a fresh rights check. */
 async bytesForPinnedExport(c:PoolClient,s:Session,pin:FrozenThumbnailPin,signal:AbortSignal){
  if(!this.blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  const authority=await this.pinnedForExport(c,s,pin);
  const bytes=Buffer.from(await this.blobs.getBounded(authority.objectKey,pin.bytes,signal));
  if(bytes.length!==pin.bytes||sha256(bytes)!==pin.thumbnailSha256)throw new ApiError(409,'ASSET_INTEGRITY');
  await validateThumbnailBytes(bytes);
  const {rights}=await this.pinnedForExport(c,s,pin);
  return {bytes,rights};
 }
 /** Pin the selected receipt while publication prepares its optional derivative. */
 async selectedForPublication(c:PoolClient,s:Session,artworkId:string,revision:number,sourceId:string,sourceHash:string,signal?:AbortSignal){
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
  const expected=Number(row.bytes);
  if(!Number.isSafeInteger(expected)||expected<1||expected>MAX_ARTWORK_THUMBNAIL_BYTES)throw new ApiError(409,'ASSET_INTEGRITY');
  if(signal&&!this.blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  const bytes=Buffer.from(signal&&this.blobs.getBounded?await this.blobs.getBounded(row.object_key,expected,signal):await this.blobs.get(row.object_key));
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
 /** A card reads one exact current selection. The generic model preview and
  * immutable approval graph retain their existing roles. */
 async selectedPreview(c:PoolClient,s:Session,artworkId:string,revision:number,bindingId:string,selectionVersion:number,signal:AbortSignal){
  uuid(bindingId);bindingId=bindingId.toLowerCase();
  if(!Number.isSafeInteger(selectionVersion)||selectionVersion<1||selectionVersion>2147483647)throw new ApiError(400,'INVALID_INPUT');
  const check=async()=>{
   const current=await this.current(c,s,artworkId,revision);
   if(current.bindingId!==bindingId||current.selectionVersion!==selectionVersion)throw new ApiError(409,'SELECTION_CONFLICT');
  };
  const checkAbort=()=>{if(signal.aborted)throw new ApiError(503,'THUMBNAIL_READ_UNAVAILABLE');};
  await check();checkAbort();
  const {artwork}=await this.cms.studioArtwork(c,s,artworkId),primary=artwork.assets.find(asset=>asset.id===artwork.primaryAssetId);
  if(artwork.revision!==revision||!primary)throw new ApiError(409,'REVISION_CONFLICT');
  const selected=await this.selectedForPublication(c,s,artworkId,revision,primary.id,primary.sha256,signal).catch((error:unknown)=>{
   if(error instanceof ApiError)throw error;checkAbort();throw new ApiError(409,'ASSET_INTEGRITY');
  });
  if(!selected||selected.id!==bindingId)throw new ApiError(409,'SELECTION_CONFLICT');
  await check();checkAbort();
  return {...selected,revision,selectionVersion};
 }
 async select(c:PoolClient,s:Session,artworkId:string,value:unknown){
  return this.selectBound(c,s,artworkId,value);
 }
 /** Persist the reviewed client PNG without changing artwork approval or revision. */
 async selectRendered(c:PoolClient,s:Session,artworkId:string,value:unknown){
  const input=parseRenderedThumbnail(value),{png,...claims}=input;
  if(sha256(png)!==input.pngSha256)throw new ApiError(422,'ARTWORK_THUMBNAIL_INVALID');
  if(!this.blobs.putDurable||!this.blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:rendered-thumbnail:${s.userId}:${input.requestId}`]);
  const art=await this.cms.ownArtwork(c,s,artworkId);
  if(!validMetadata(art.metadata)||art.revision!==input.expectedRevision||art.approved_revision!==art.revision||art.approved_asset_id!==input.sourceAssetId)throw new ApiError(409,'REVISION_CONFLICT');
  if(!allowedRights(art.metadata.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');
  const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,art.revision])).rows[0]?.snapshot;
  if(approval?.asset?.id!==input.sourceAssetId||approval.asset.sha256!==input.sourceSha256||!isDeepStrictEqual(approval.metadata,art.metadata))throw new ApiError(409,'APPROVAL_INVALID');
  const source=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,artworkId,input.sourceAssetId])).rows[0];
  if(!source||!allowedRights(source.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');
  if(source.mime!=='model/gltf-binary'||source.sha256!==input.sourceSha256||Number(source.bytes)!==approval.asset.bytes||source.mime!==approval.asset.mime||!Number.isSafeInteger(Number(source.bytes))||Number(source.bytes)<28||Number(source.bytes)>32*1024*1024)throw new ApiError(409,'ASSET_INTEGRITY');
  // Recompute the same approved preview used by the existing renderer. Its hash
  // may differ from the approved primary (for example, a display watermark).
  const display=await this.cms.display(c,s,artworkId,true,input.expectedRevision) as {bytes:Buffer;mime:string;revision:number};
  if(display.mime!=='model/gltf-binary'||display.revision!==input.expectedRevision||display.bytes.length<28||display.bytes.length>16*1024*1024||sha256(display.bytes)!==input.displaySha256)throw new ApiError(409,'ASSET_INTEGRITY');
  const dimensions=await validateThumbnailBytes(png);
  if(dimensions.width!==256||dimensions.height!==256)throw new ApiError(422,'ARTWORK_THUMBNAIL_INVALID');
  const digest=sha256(Buffer.from(JSON.stringify({kind:RENDERED_ARTWORK_THUMBNAIL_PROFILE,artworkId,...claims})));
  const prior=(await c.query('SELECT * FROM artwork_thumbnail_bindings WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0];
  if(prior&&prior.payload_sha256!==digest)throw new ApiError(409,'REQUEST_CONFLICT');
  const signal=AbortSignal.timeout(10000);
  let thumbnailAssetId:string;
  if(prior){
   thumbnailAssetId=prior.thumbnail_asset_id;
   const bytes=Buffer.from(await this.blobs.getBounded(prior.object_key,png.length,signal));
   if(Number(prior.bytes)!==png.length||prior.sha256!==input.pngSha256||bytes.length!==png.length||sha256(bytes)!==input.pngSha256)throw new ApiError(409,'ASSET_INTEGRITY');
  }else{
   const selection=(await c.query('SELECT binding_id,version FROM artwork_thumbnail_selections WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3 FOR UPDATE',[s.tenantId,artworkId,input.expectedRevision])).rows[0];
   if((selection?.version??0)!==input.expectedSelectionVersion||input.expectedSelectionVersion>=2147483647)throw new ApiError(409,'SELECTION_CONFLICT');
   const key=`${s.tenantId}/artwork-thumbnails/${s.userId}/${input.requestId}/${digest}.png`;
   // The immutable key is reusable after uncertain transaction failure. Never
   // delete it on SQL rollback: a retry may already be using these exact bytes.
   await this.blobs.putDurable(key,png);
   const stored=Buffer.from(await this.blobs.getBounded(key,png.length,signal));
   if(stored.length!==png.length||sha256(stored)!==input.pngSha256)throw new ApiError(409,'ASSET_INTEGRITY');
   thumbnailAssetId=randomUUID();
   await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'image/png',1,'approved')",[s.tenantId,thumbnailAssetId,artworkId,source.rights_id,key,input.pngSha256,png.length]);
  }
  const recipe={version:1,kind:'authorized-rendered-representative-image',profile:RENDERED_ARTWORK_THUMBNAIL_PROFILE,recipeId:RENDERED_ARTWORK_THUMBNAIL_RECIPE,toolId:RENDERED_ARTWORK_THUMBNAIL_TOOL,view:input.view,
   source:{assetId:source.id,sha256:source.sha256,bytes:Number(source.bytes)},display:{sha256:input.displaySha256,bytes:display.bytes.length},output:{sha256:input.pngSha256,bytes:png.length,width:256,height:256}};
  const receipt=await this.selectBound(c,s,artworkId,{requestId:input.requestId,expectedRevision:input.expectedRevision,expectedSelectionVersion:input.expectedSelectionVersion,
   sourceAssetId:input.sourceAssetId,sourceSha256:input.sourceSha256,thumbnailAssetId,thumbnailSha256:input.pngSha256,view:input.view},{digest,recipe});
  return {...receipt,thumbnailAssetId,thumbnailSha256:input.pngSha256};
 }
 private async selectBound(c:PoolClient,s:Session,artworkId:string,value:unknown,rendered?:{digest:string;recipe:Record<string,unknown>}){
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
  const digest=rendered?.digest??sha256(Buffer.from(JSON.stringify(payload)));
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
  await c.query('INSERT INTO artwork_thumbnail_bindings(tenant_id,id,artwork_id,artwork_revision,source_asset_id,source_sha256,thumbnail_asset_id,selection_version,sha256,bytes,object_key,view,recipe,created_by,request_id,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[s.tenantId,id,artworkId,art.revision,source.id,source.sha256,thumb.id,version,thumb.sha256,Number(thumb.bytes),thumb.object_key,input.view,rendered?.recipe??{version:1,kind:'authorized-representative-image'},s.userId,input.requestId,digest]);
  if(selection){const updated=await c.query('UPDATE artwork_thumbnail_selections SET binding_id=$4,version=$5 WHERE tenant_id=$1 AND artwork_id=$2 AND artwork_revision=$3 AND version=$6',[s.tenantId,artworkId,art.revision,id,version,input.expectedSelectionVersion]);if(!updated.rowCount)throw new ApiError(409,'SELECTION_CONFLICT');}
  else await c.query('INSERT INTO artwork_thumbnail_selections(tenant_id,artwork_id,artwork_revision,version,binding_id) VALUES($1,$2,$3,$4,$5)',[s.tenantId,artworkId,art.revision,version,id]);
  await c.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action:'cms.thumbnail-selected',actor:s.userId,target:artworkId,revision:art.revision,bindingId:id}]);
  return {id,selectionVersion:version,selected:true};
 }
}
