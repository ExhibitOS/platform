// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {DISPLAY_POLICY_NAMESPACE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import type {PoolClient} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {float32BoundsEqual} from './approved-lod-pair.ts';
import {ApiError} from './api-error.ts';
import type {Session} from './auth.ts';
import {validMetadata,type ArtworkMetadata,type Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {replaceArtworkReferences} from './artwork-snapshot-replacement.ts';
import {IMPORTED_DISPLAY_REFERENCE} from './imported-artwork-metadata.ts';
import {inspectCompactModelSource} from './oam-original-preparation.ts';
import {readNativeAdoptionBrokerBlob,type NativeAdoptionBroker} from './native-model-adoption-broker.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {parseNativeModelAdoptionGrant,type NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';
import {allowedRights} from './rights.ts';
import {etag,insertStudioReceipt,type Draft,type Studio,type StudioResponse} from './studio.ts';

/** Revalidate the target in the transaction that will consume the grant.
 * The caller must first obtain explicit approval from the authenticated target
 * owner for this exact grant. The grant itself only describes source custody. */
export async function lockNativeModelAdoptionTarget(
 c:PoolClient,s:Session,input:NativeModelAdoptionGrant,studio:Studio,cms:Cms,imports:Imports,
){
 const grant=parseNativeModelAdoptionGrant(input);
 const {target}=grant;
 if(s.tenantId!==target.tenantId||s.userId!==target.principalId)throw new ApiError(403,'FORBIDDEN');
 await imports.requiredModelReady(c,s);
 await imports.coarseOwner(c,s.tenantId,s.userId,target.workspaceId);
 const exhibition=await studio.access(c,s,target.exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 if(etag(exhibition.revision,exhibition.metadata)!==target.etag)throw new ApiError(412,'REMOTE_CONFLICT');
 const artwork=await cms.ownArtwork(c,s,target.artworkId);
 if(artwork.revision!==target.artworkRevision||artwork.approved_revision!==target.artworkRevision||
    artwork.revision>=2147483647||!validMetadata(artwork.metadata))throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');
 const {artwork:prior}=await cms.studioArtwork(c,s,target.artworkId);
 if(!isDeepStrictEqual(artwork.metadata.rights,prior.rights)||
    modelReceiptDigest(prior.rights)!==grant.rightsSha256||
    !(['download','display','export'] as const).every(permission=>allowedRights(prior.rights,permission)))
  throw new ApiError(403,'RIGHTS_DENIED');
 const {candidate}=exhibition.metadata as Draft;
 const placements=candidate.placements.filter(placement=>placement.artworkRevisionId===prior.revisionId);
 if(prior.id!==target.artworkId||prior.revision!==target.artworkRevision||prior.artworkType!=='sculpture'||
    !isDeepStrictEqual(candidate.artworks.find(item=>item.id===target.artworkId),prior)||
    placements.length!==1||placements[0]!.id!==target.placementId||placements[0]!.assetId!==prior.primaryAssetId)
  throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');
 return {grant,artwork,prior,candidate};
}

/** Verify the exact staged pair without invoking the producer again.
 * The caller owns the returned buffers until target storage settles. */
export async function readNativeModelAdoptionPair(
 broker:NativeAdoptionBroker,input:NativeModelAdoptionGrant,signal:AbortSignal,
){
 const grant=parseNativeModelAdoptionGrant(input);
 const original=await readNativeAdoptionBrokerBlob(broker,grant,'original',signal);
 let display:Buffer|undefined;
 try{
  display=await readNativeAdoptionBrokerBlob(broker,grant,'display',signal);
  const source=inspectCompactModelSource(original,grant.original),compact=inspectCompactModelSource(display,grant.display);
  const {validateBytes}=await import('gltf-validator');
  for(const bytes of grant.original.sha256===grant.display.sha256?[original]:[original,display]){
   signal.throwIfAborted();
   const report=await validateBytes(bytes,{maxIssues:64,externalResourceFunction:async()=>{throw new ApiError(422,'MODEL_ADOPTION_PAIR_INVALID');}});
   if(report.issues.numErrors!==0)throw new ApiError(422,'MODEL_ADOPTION_PAIR_INVALID');
  }
  const compactTexture=(image:typeof compact.images[number])=>{
   const {bytes,mime}=image;
   if(mime!=='image/png'||bytes.length<24||bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR')return false;
   const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
   return width>=1&&width<=512&&height>=1&&height<=512;
  };
  if(compact.indices.length/3>20_000||!compact.images.every(compactTexture)||!isDeepStrictEqual(source.bounds,compact.bounds))
   throw new ApiError(422,'MODEL_ADOPTION_PAIR_INVALID');
  signal.throwIfAborted();
  parseNativeModelAdoptionGrant(grant);
  return {original,display,rawBounds:source.bounds};
 }catch(error){
  original.fill(0);
  display?.fill(0);
  throw error;
 }
}

/** Commit under the authenticated target's write transaction after its
 * explicit confirmation of this grant. The durable Studio receipt is the
 * authority for replay after a lost acknowledgment, even after expiry. */
export async function commitNativeModelAdoptionTarget(input:{
 client:PoolClient;session:Session;grant:NativeModelAdoptionGrant;confirmedGrantSha256:string;
 broker:NativeAdoptionBroker;blobs:BlobStore;
 cms:Cms;imports:Imports;studio:Studio;signal:AbortSignal;assertLive:()=>Promise<void>;
}){
 const {client:c,session:s,blobs,cms,imports,studio,signal}=input;
 const grant=parseNativeModelAdoptionGrant(input.grant,input.grant?.issuedAt);
 const grantSha256=modelReceiptDigest(grant),{target}=grant;
 if(input.confirmedGrantSha256!==grantSha256||s.tenantId!==target.tenantId||s.userId!==target.principalId)
  throw new ApiError(403,'FORBIDDEN');
 const live=async()=>{signal.throwIfAborted();await input.assertLive();signal.throwIfAborted();};
 await live();
 await imports.requiredModelReady(c,s);
 await imports.coarseOwner(c,s.tenantId,s.userId,target.workspaceId);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${s.userId}:${grant.operationId}`]);
 const priorResponse=await readNativeModelAdoptionReceipt(c,s,grant.operationId,grantSha256,target.exhibitionId);
 if(priorResponse){await live();return priorResponse;}
 const receiptHash=modelReceiptDigest(['native-model-adoption-v1',grantSha256]);
 const {artwork,prior,candidate}=await lockNativeModelAdoptionTarget(c,s,grant,studio,cms,imports);
 if(!blobs.putDurable||!blobs.getBounded)throw new ApiError(503,'NATIVE_MODEL_ADOPTION_UNAVAILABLE');
 const pair=await readNativeModelAdoptionPair(input.broker,grant,signal);
 try{
  const reused=grant.original.sha256===grant.display.sha256;
  const now=new Date(),revision=target.artworkRevision+1,displayId=randomUUID(),originalId=reused?displayId:randomUUID(),rightsId=randomUUID();
  const metadata=structuredClone(artwork.metadata) as ArtworkMetadata;
  if(metadata.displayReference){
   // The existing provisional pose stays valid only on equal raw bounds.
   const expected=metadata.displayReference.rawBounds;
   if(!(['min','max'] as const).every(edge=>float32BoundsEqual(expected[edge],pair.rawBounds[edge])))throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');
   metadata.displayReference.assetSha256=grant.display.sha256;
  }
  const next=structuredClone(prior);
  next.revision=revision;next.revisionId=randomUUID();next.createdAt=now.toISOString();
  next.primaryAssetId=displayId;
  const primary={id:displayId,path:`assets/${displayId}/model.glb`,role:'model' as const,mime:'model/gltf-binary' as const,...grant.display};
  if(prior.assets.some(asset=>asset.role!=='model')||next.extensions?.[DISPLAY_POLICY_NAMESPACE]!==undefined)
   throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');
  next.assets=[primary];
  next.extensions={...next.extensions,'org.exhibitos.studio/cms':{tenantId:s.tenantId,artworkId:target.artworkId,revision}};
  delete next.extensions[LOD_NAMESPACE];
  if(metadata.displayReference){
   const reference=next.extensions[IMPORTED_DISPLAY_REFERENCE];
   if(!reference||typeof reference!=='object'||Array.isArray(reference))throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');
   next.extensions[IMPORTED_DISPLAY_REFERENCE]={...reference,assetSha256:primary.sha256};
  }
  next.provenance.events.push({id:next.revisionId,type:'edited',at:next.createdAt,description:'Approved exact original and display model custody for this artwork.'});
  replaceArtworkReferences(candidate,prior,next,target.placementId,'same-artwork-model');
  await live();
  await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,rightsId,prior.rights]);
  const entries=[
   {role:'display',id:displayId,bytes:pair.display,identity:grant.display},
   ...(!reused?[{role:'original',id:originalId,bytes:pair.original,identity:grant.original}]:[]),
  ];
  for(const entry of entries){
   const key=`${s.tenantId}/approved/model-adoption/${grant.operationId}/${entry.role}.glb`;
   await live();
   await blobs.putDurable(key,entry.bytes);
   const saved=Buffer.from(await blobs.getBounded(key,entry.identity.bytes,signal));
   try{
    if(saved.length!==entry.identity.bytes||sha256(saved)!==entry.identity.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
   }finally{saved.fill(0);}
   await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'approved')",
    [s.tenantId,entry.id,target.artworkId,rightsId,key,entry.identity.sha256,entry.identity.bytes]);
  }
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,randomUUID(),originalId,{
   version:1,kind:'native-model-adoption',operationId:grant.operationId,grantSha256,receiptSha256:grant.receiptSha256,originalId,displayId,
  }]);
  const updated=await c.query('UPDATE artworks SET revision=$3,approved_revision=$3,approved_asset_id=$4,updated_at=$5,metadata=$6 WHERE tenant_id=$1 AND id=$2 AND revision=$7 AND approved_revision=$7 RETURNING id',
   [s.tenantId,target.artworkId,revision,displayId,now,metadata,target.artworkRevision]);
  if(updated.rowCount!==1)throw new ApiError(409,'REVISION_CONFLICT');
  await c.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,$3,$4)',[s.tenantId,target.artworkId,revision,metadata]);
  const asset={id:displayId,sha256:primary.sha256,bytes:primary.bytes,mime:primary.mime,rightsRevision:1};
  await c.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,$3,$4,$5)',[s.tenantId,target.artworkId,revision,displayId,{metadata,asset,importedArtwork:next}]);
  if(!isDeepStrictEqual((await cms.studioArtwork(c,s,target.artworkId)).artwork,next))throw new ApiError(409,'APPROVAL_INVALID');
  const response=await studio.putArtworkReplacement(c,s,target.exhibitionId,prior,next,randomUUID(),target.etag,target.placementId,'same-artwork-model');
  await insertStudioReceipt(c,[s.tenantId,s.userId,grant.operationId,receiptHash,target.exhibitionId,response]);
  parseNativeModelAdoptionGrant(grant);
  if(!(['download','display','export'] as const).every(permission=>allowedRights(prior.rights,permission)))
   throw new ApiError(403,'RIGHTS_DENIED');
  await live();
  return response;
 }finally{
  pair.original.fill(0);
  pair.display.fill(0);
 }
}


/** A missing receipt is unresolved. The caller cannot use it as proof that
 * a prior commit attempt rolled back or that the Manager may retire staging. */
export async function readNativeModelAdoptionReceipt(c:PoolClient,s:Session,operationId:string,grantSha256:string,exhibitionId?:string){
 const receipt=await c.query('SELECT payload_sha256,exhibition_id,response FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,operationId]);
 if(!receipt.rowCount)return undefined;
 const row=receipt.rows[0];
 if(row.payload_sha256!==modelReceiptDigest(['native-model-adoption-v1',grantSha256])||
    exhibitionId!==undefined&&row.exhibition_id!==exhibitionId)throw new ApiError(409,'REQUEST_CONFLICT');
 return row.response as StudioResponse;
}
