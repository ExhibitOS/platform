// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork,Exhibition} from '@exhibitos/spec';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';

/** Build the narrowly scoped draft change after the caller independently verifies
 * current owner, approval, original/derived bytes and new policy. This function
 * grants no asset authority and performs no persistence. */
export function replaceArtworkReferences(candidate:Exhibition,prior:Artwork,next:Artwork):Exhibition {
 const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 if(prior.artworkType!=='image'||next.artworkType!=='image'||!same(prior.id,next.id)||same(prior.revisionId,next.revisionId)||next.revision!==prior.revision+1||same(prior.primaryAssetId,next.primaryAssetId))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const matches=candidate.artworks.filter(a=>same(a.id,prior.id));
 if(matches.length!==1||!same(matches[0]!.revisionId,prior.revisionId)||!isDeepStrictEqual(matches[0],prior))throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
 const oldIds=new Set([prior.revisionId,...prior.assets.map(a=>a.id)].map(id=>id.toLowerCase()));
 if(next.assets.some(a=>oldIds.has(a.id.toLowerCase()))||!next.assets.some(a=>same(a.id,next.primaryAssetId)))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const unrelated=candidate.artworks.filter(a=>!same(a.id,prior.id)),usedRevisions=new Set(unrelated.map(a=>a.revisionId.toLowerCase())),usedAssets=new Set(unrelated.flatMap(a=>a.assets.map(asset=>asset.id.toLowerCase()))),newIds=next.assets.map(a=>a.id.toLowerCase());
 if(usedRevisions.has(next.revisionId.toLowerCase())||new Set(newIds).size!==newIds.length||newIds.some(id=>usedAssets.has(id)))throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 const copy=structuredClone(candidate),index=copy.artworks.findIndex(a=>same(a.id,prior.id));copy.artworks[index]=structuredClone(next);
 let replaced=0;for(const placement of copy.placements){if(same(placement.artworkRevisionId,prior.revisionId)){
  if(!same(placement.assetId,prior.primaryAssetId))throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
  placement.artworkRevisionId=next.revisionId;placement.assetId=next.primaryAssetId;replaced++;
 }}
 if(!replaced)throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 // Refuse any unsupported cover, thumbnail, frame or other reference rather
 // than guessing how it should be rebound. Artwork identity itself is stable.
 const containsOld=(value:string)=>[...oldIds].some(id=>value.toLowerCase().includes(id));
 const hasOldReference=(value:unknown):boolean=>typeof value==='string'?containsOld(value):Array.isArray(value)?value.some(hasOldReference):!!value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>containsOld(key)||hasOldReference(item));
 if(hasOldReference(copy))throw new ApiError(409,'ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 return copy;
}
