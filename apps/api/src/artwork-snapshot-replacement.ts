// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork,Exhibition} from '@exhibitos/spec';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import {artworkThumbnailFor,ENTRANCE_NAMESPACE} from '@exhibitos/studio-contract';

/** Build the narrowly scoped draft change after the caller independently verifies
 * current owner, approval, original/derived bytes and new policy. This function
 * grants no asset authority and performs no persistence. */
export function replaceArtworkReferences(candidate:Exhibition,prior:Artwork,next:Artwork,placementId?:string,mode?:'same-artwork-model'):Exhibition {
 const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 if(mode==='same-artwork-model'){
  if(!placementId||prior.artworkType!=='sculpture'||next.artworkType!=='sculpture'||!same(prior.id,next.id)||
     next.revision!==prior.revision+1||prior.units!==next.units||prior.coordinates!==next.coordinates||
     !isDeepStrictEqual(prior.transform,next.transform)||!isDeepStrictEqual(prior.dimensions,next.dimensions)||
     !isDeepStrictEqual(prior.rights,next.rights)||same(prior.primaryAssetId,next.primaryAssetId))
   throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 }else if(placementId===undefined){
  if(prior.artworkType!=='image'||next.artworkType!=='image'||!same(prior.id,next.id)||next.revision!==prior.revision+1)throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 }else if(prior.artworkType!=='sculpture'||next.artworkType!=='sculpture'||same(prior.id,next.id)||prior.units!==next.units||prior.coordinates!==next.coordinates||!isDeepStrictEqual(prior.transform,next.transform)||candidate.artworks.some(a=>same(a.id,next.id))){
  throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 }
 const retainsPrimary=same(prior.primaryAssetId,next.primaryAssetId);
 const preview=retainsPrimary?artworkThumbnailFor(next):undefined;
 if(same(prior.revisionId,next.revisionId)||retainsPrimary&&(
  placementId!==undefined||!preview||artworkThumbnailFor(prior)||prior.assets.some(asset=>asset.role==='preview')||
  !isDeepStrictEqual(next.assets.filter(asset=>!same(asset.id,preview.id)),prior.assets)
 ))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const matches=candidate.artworks.filter(a=>same(a.id,prior.id));
 if(matches.length!==1||!same(matches[0]!.revisionId,prior.revisionId)||!isDeepStrictEqual(matches[0],prior))throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
 const retiredAssets=retainsPrimary?[]:prior.assets.map(asset=>asset.id);
 const oldIds=new Set([prior.revisionId,...retiredAssets].map(id=>id.toLowerCase()));
 if(next.assets.some(a=>oldIds.has(a.id.toLowerCase()))||!next.assets.some(a=>same(a.id,next.primaryAssetId)))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const unrelated=candidate.artworks.filter(a=>!same(a.id,prior.id)),usedRevisions=new Set(unrelated.map(a=>a.revisionId.toLowerCase())),usedAssets=new Set(unrelated.flatMap(a=>a.assets.map(asset=>asset.id.toLowerCase()))),newIds=next.assets.map(a=>a.id.toLowerCase());
 if(usedRevisions.has(next.revisionId.toLowerCase())||new Set(newIds).size!==newIds.length||newIds.some(id=>usedAssets.has(id)))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const copy=structuredClone(candidate),index=copy.artworks.findIndex(a=>same(a.id,prior.id));copy.artworks[index]=structuredClone(next);
 let replaced=0;for(const placement of copy.placements){if(same(placement.artworkRevisionId,prior.revisionId)&&(placementId===undefined||same(placement.id,placementId))){
  if(!same(placement.assetId,prior.primaryAssetId))throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
  placement.artworkRevisionId=next.revisionId;placement.assetId=next.primaryAssetId;replaced++;
 }}
 if(!replaced||placementId!==undefined&&replaced!==1)throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 // The existing entrance contract permits selecting this exact primary image.
 // Preserve all authored entrance text and presentation, changing only its
 // primary binding. The caller validates the complete draft before saving.
 const entrance=copy.extensions?.[ENTRANCE_NAMESPACE] as {imageAssetId?:unknown}|undefined;
 if(placementId===undefined&&entrance&&typeof entrance.imageAssetId==='string'&&same(entrance.imageAssetId,prior.primaryAssetId))entrance.imageAssetId=next.primaryAssetId;
 // Refuse unsupported cover, thumbnail, frame or other references. The
 // legacy image update retains its artwork ID; the model candidate differs.
 if(placementId!==undefined&&mode!=='same-artwork-model')oldIds.add(prior.id.toLowerCase());
 const containsOld=(value:string)=>[...oldIds].some(id=>value.toLowerCase().includes(id));
 // An unchanged historical event can legitimately use the prior revision ID
 // as its own event identity (the CMS projection does this). Ignore only
 // that exact inherited event's id field; every other value and key remains
 // subject to the old-reference check.
 const historicalEvents=new WeakSet<object>();
 for(const [i,event] of (copy.artworks[index]!.provenance?.events??[]).entries()){if(typeof event.id==='string'&&same(event.id,prior.revisionId)&&isDeepStrictEqual(prior.provenance?.events?.[i],event))historicalEvents.add(event);}
 const hasOldReference=(value:unknown):boolean=>typeof value==='string'?containsOld(value):Array.isArray(value)?value.some(hasOldReference):!!value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>containsOld(key)||!(key==='id'&&historicalEvents.has(value))&&hasOldReference(item));
 if(hasOldReference(copy))throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 return copy;
}
