// SPDX-License-Identifier: AGPL-3.0-or-later
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings,type ViewerBudgetAssetReference,type ViewerBudgetGeometryAnalyzer,type ViewerBudgetGeometryInput} from '@exhibitos/studio-contract';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import type {Cms} from './cms.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
/** This local module is built from the same renderer CPU builders. The URL is
 * fixed by the server build and is never derived from a document or request. */
export async function viewerBudgetProducer():Promise<ViewerBudgetGeometryAnalyzer|null>{
 const url=new URL(import.meta.url.endsWith('.ts')?'../dist/viewer-budget-geometry.mjs':'./viewer-budget-geometry.mjs',import.meta.url);
 const file=await lstat(url).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(!file)return null;
 if(!file.isFile()||file.isSymbolicLink())throw new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE');
 const module=await import(url.href) as {analyzeViewerBudgetGeometry?:ViewerBudgetGeometryAnalyzer};
 if(typeof module.analyzeViewerBudgetGeometry!=='function')throw new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE');
 return module.analyzeViewerBudgetGeometry;
}
/** Per-request source cache. Metadata and client-reported costs are never bytes
 * authority. Missing permission/unsupported source is handled as unknown by the
 * CPU producer, without substituting a different asset or quality level. */
export function viewerBudgetAssetLoader(c:PoolClient,s:Session,candidate:Exhibition,cms?:Cms,furnishings?:WorkspaceFurnishingIntakes):ViewerBudgetGeometryInput['loadVerifiedAsset']{
 const cache=new Map<string,Promise<Uint8Array>>();
 const read=async(ref:ViewerBudgetAssetReference)=>{
  let bytes:Uint8Array;
  if(ref.kind==='furnishing'){
   const inventory=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
   const declared=inventory?.furnishings.find(x=>x.id===ref.furnishingId&&x.version===ref.furnishingVersion);
   if(!furnishings||!declared||!isDeepStrictEqual(await furnishings.readVersion(c,s,declared.id,declared.version),declared))throw new ApiError(409,'FURNISHING_VERSION_MISMATCH');
   if(declared.model.sha256!==ref.sha256||declared.model.bytes!==ref.bytes||declared.model.mime!==ref.mime)throw new ApiError(409,'ASSET_INTEGRITY');
   bytes=(await furnishings.model(c,s,declared.id,declared.version,'display')).bytes;
  }else{
   const artwork=candidate.artworks.find(x=>x.id===ref.artworkId&&x.revision===ref.artworkRevision),asset=artwork?.assets.find(x=>x.id===ref.assetId);
   if(!cms||!artwork||!asset||!isDeepStrictEqual((await cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
   if(asset.sha256!==ref.sha256||asset.bytes!==ref.bytes||asset.mime!==ref.mime)throw new ApiError(409,'ASSET_INTEGRITY');
   bytes=await cms.approvedVariantOriginal(c,s,artwork.id,asset.id,artwork.revision);
  }
  if(bytes.byteLength!==ref.bytes||createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  return bytes;
 };
 return ref=>{const key=JSON.stringify(ref);let result=cache.get(key);if(!result){result=read(ref);cache.set(key,result);}return result;};
}
