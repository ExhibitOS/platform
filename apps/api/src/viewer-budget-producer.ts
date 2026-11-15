import type {BlobStore} from '@exhibitos/storage';
import {furnishingResourcePairSource} from './furnishings.ts';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE,furnishingsFor,validateFurnishings,type WorkspaceFurnishings,type ViewerBudgetAssetReference} from '@exhibitos/studio-contract';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import type {Cms} from './cms.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
/** Resolve only the fixed local, qualified renderer CPU artifact. */
export async function viewerBudgetProducerURL():Promise<URL|null>{
 const url=new URL(import.meta.url.endsWith('.ts')?'../dist/viewer-budget-geometry.mjs':'./viewer-budget-geometry.mjs',import.meta.url);
 const file=await lstat(url).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(!file)return null;
 if(!file.isFile()||file.isSymbolicLink())throw new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE');
 return url;
}
export type ViewerBudgetAssetSource={sha256:string;bytes:number;mime:string;read:()=>Promise<Uint8Array>};
/** Metadata/rights acquisition runs in a short authenticated transaction. The
 * returned read closes over immutable source metadata, never the DB client. */
export async function viewerBudgetAssetSource(c:PoolClient,s:Session,candidate:Exhibition,ref:ViewerBudgetAssetReference,cms?:Cms,furnishings?:WorkspaceFurnishingIntakes,blobs?:BlobStore):Promise<ViewerBudgetAssetSource>{
 let source:ViewerBudgetAssetSource;
 if(ref.kind==='furnishing'&&ref.furnishingId===undefined){
  if(!validateFurnishings(candidate).valid)throw new ApiError(409,'FURNISHING_INTEGRITY');
  const asset=furnishingsFor(candidate)?.assets.find(x=>x.id===ref.assetId),hint=ref as ViewerBudgetAssetReference&{catalogId?:unknown;catalogVersion?:unknown};
  if(!asset||ref.furnishingVersion!==undefined&&ref.furnishingVersion!==asset.catalogVersion||hint.catalogId!==undefined&&hint.catalogId!==asset.catalogId||hint.catalogVersion!==undefined&&hint.catalogVersion!==asset.catalogVersion)throw new ApiError(409,'FURNISHING_VERSION_MISMATCH');
  const pair=await furnishingResourcePairSource(c,blobs,s.tenantId,candidate.id,asset);
  source={sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime,read:async()=>(await pair.read()).model};
 }else if(ref.kind==='furnishing'){
  const inventory=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const declared=inventory?.furnishings.find(x=>x.id===ref.furnishingId&&x.version===ref.furnishingVersion);
  if(!furnishings||!declared||!isDeepStrictEqual(await furnishings.readVersion(c,s,declared.id,declared.version),declared))throw new ApiError(409,'FURNISHING_VERSION_MISMATCH');
  source=await furnishings.modelSource(c,s,declared.id,declared.version,'display');
 }else{
  const artwork=candidate.artworks.find(x=>x.id===ref.artworkId&&x.revision===ref.artworkRevision),asset=artwork?.assets.find(x=>x.id===ref.assetId);
  if(!cms||!artwork||!asset||!isDeepStrictEqual((await cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
  source=await cms.approvedVariantSource(c,s,artwork.id,asset.id,artwork.revision);
 }
 if(source.sha256!==ref.sha256||source.bytes!==ref.bytes||source.mime!==ref.mime)throw new ApiError(409,'ASSET_INTEGRITY');
 return source;
}
/** Byte I/O and its digest calculation run after authorization COMMIT. */
export async function readViewerBudgetSource(source:ViewerBudgetAssetSource){
 const bytes=await source.read();
 if(bytes.byteLength!==source.bytes||createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 return bytes;
}
