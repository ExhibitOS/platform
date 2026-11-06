// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkDisplayPolicy,LOD_NAMESPACE,validateViewerLod} from '@exhibitos/studio-contract';
import {sha256} from '@exhibitos/storage';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
import {ApiError} from './api-error.ts';
import {allowedRights} from './rights.ts';
import {isDeepStrictEqual} from 'node:util';
/** Optional exact-file additions to the same Docs-owned immutable manifest.
 * Existing records keep their original 2 MP admission and primary-only approval. */
export type DemoDisplayApproval = typeof APPROVED_DEMO_DISPLAY_FILES[number] & {
 canonicalMaxPixels?:2097152|4194304;
 coarse?:{sha256:string;bytes:number;width:number;height:number};
 canonicalMime?:'model/gltf-binary';canonicalRole?:'model';artworkType?:'sculpture';
 canonicalTriangles?:number;canonicalMaxTextureSize?:number;
 /** Reserved for a separately reviewed exact private candidate; no current
  * production approval grants this authority. */
 privatePaintingCandidate?:PrivatePaintingProfile;
};
export type PrivatePaintingProfile='painting-1926x2634'|'painting-2419x2552'|'painting-2135x1362';
const privatePaintingProfiles=Object.freeze({'painting-1926x2634':Object.freeze({width:1926,height:2634}),'painting-2419x2552':Object.freeze({width:2419,height:2552}),'painting-2135x1362':Object.freeze({width:2135,height:1362})});
export type PrivatePaintingCapability=Readonly<{profile:PrivatePaintingProfile;width:number;height:number}>;
export type PrivatePaintingContext={artwork:Artwork;currentArtwork:Artwork;tenantId:string;assetId:string;bytes:Buffer;purpose:'full'|'coarse'};
const privatePaintingIssued=new WeakMap<PrivatePaintingCapability,{snapshot:Artwork;tenantId:string;assetId:string;sourceSha256:string;sourceBytes:number}>();
/** Called at the legitimate OEX/publication producer boundary. Inventory declarations
 * alone never prove bytes; a producing caller supplies the observed primary bytes.
 * Current CMS approval/revision/resource rights remain the caller's existing gates.
 */
export function qualifyDemoDisplay(artwork:Artwork,bytes?:Buffer){
 let policy;try{policy=artworkDisplayPolicy(artwork);}catch(error){throw Object.assign(new ApiError(422,'DISPLAY_POLICY_INVALID'),{cause:error});}
 if(!policy)return undefined;
 const approval:DemoDisplayApproval|undefined=APPROVED_DEMO_DISPLAY_FILES.find(a=>a.approvalId.toLowerCase()===policy.approvalId.toLowerCase()),primary=artwork.assets.find(a=>a.id.toLowerCase()===artwork.primaryAssetId.toLowerCase());
 if(!approval||!primary||policy.rightsEvidenceSha256!==approval.rightsEvidenceSha256||policy.sourceAssetSha256!==approval.canonicalAssetSha256||primary.sha256!==approval.canonicalAssetSha256||primary.bytes!==approval.canonicalBytes||!allowedRights(artwork.rights,'display'))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 if(approval.canonicalMime==='model/gltf-binary'){
  if(approval.canonicalRole!=='model'||approval.artworkType!=='sculpture'||primary.mime!=='model/gltf-binary'||primary.role!=='model'||artwork.artworkType!=='sculpture'||!Number.isSafeInteger(approval.canonicalTriangles)||approval.canonicalTriangles!<1||approval.canonicalTriangles!>20000||approval.canonicalMaxTextureSize!==512||approval.coarse||artwork.assets.length!==1||!validateViewerLod(artwork).valid)throw new ApiError(422,'DISPLAY_POLICY_INVALID');
  const lod=artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string;triangles?:number;textureSize?:number}[]}|undefined;
  if(lod&&(lod.variants.length!==1||lod.variants[0]?.detail!=='full'||lod.variants[0]?.assetId.toLowerCase()!==primary.id.toLowerCase()||lod.variants[0]?.triangles!==approval.canonicalTriangles||(lod.variants[0]?.textureSize!==undefined&&lod.variants[0].textureSize!==approval.canonicalMaxTextureSize)))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 }else if(primary.mime!=='image/png'||primary.role!=='image'||artwork.artworkType!=='image')throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 if(bytes&&(bytes.length!==primary.bytes||sha256(bytes)!==primary.sha256))throw new ApiError(409,'ASSET_INTEGRITY');
 if(approval.canonicalMaxPixels!==undefined&&![2097152,4194304].includes(approval.canonicalMaxPixels))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 if(approval.coarse){
  if(!validateViewerLod(artwork).valid)throw new ApiError(422,'DISPLAY_POLICY_INVALID');
  const pair=artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string;textureSize:number}[]}|undefined;
  const low=pair?.variants.find(v=>v.detail==='coarse'),asset=artwork.assets.find(a=>a.id.toLowerCase()===low?.assetId.toLowerCase()),record=approval.coarse;
  // A qualified full-only fallback still has its exact primary approval. If a
  // coarse member is declared, its complete binding must remain exact.
  if(low&&(!asset||asset.mime!=='image/png'||asset.role!=='image'||asset.sha256!==record.sha256||asset.bytes!==record.bytes||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>8388608||![record.width,record.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=512)||Math.max(record.width,record.height)!==low.textureSize))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 }
 return approval;
}
/** A neutral coarse image is allowed only by its own exact-file entry, never
 * inferred merely from the primary approval or an authored LOD declaration. */
export function qualifyDemoDisplayAsset(artwork:Artwork,assetId:string,bytes:Buffer){
 const approval=qualifyDemoDisplay(artwork);if(!approval)return undefined;
 if(approval.canonicalMime==='model/gltf-binary')return undefined;
 if(assetId.toLowerCase()===artwork.primaryAssetId.toLowerCase()){
  qualifyDemoDisplay(artwork,bytes);
  return {maxPixels:approval.canonicalMaxPixels??2097152,maxEdge:2048};
 }
 if(!approval.coarse)return undefined;
 const asset=artwork.assets.find(a=>a.id.toLowerCase()===assetId.toLowerCase());
 const low=(artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]}|undefined)?.variants.find(v=>v.detail==='coarse');
 if(!asset||low?.assetId.toLowerCase()!==assetId.toLowerCase()||bytes.length!==asset.bytes||sha256(bytes)!==asset.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 return {maxPixels:approval.coarse.width*approval.coarse.height,maxEdge:512};
}

/** Internal preparation only: a production caller must obtain currentArtwork
 * from its authorized CMS transaction. This function does not query the CMS,
 * enable a route, or grant admission to a new source by itself. */
export function issuePrivatePaintingCapability(context:PrivatePaintingContext):PrivatePaintingCapability{
 const {artwork,currentArtwork,tenantId,assetId,bytes,purpose}=context;
 const binding=artwork.extensions?.['org.exhibitos.studio/cms'] as unknown as {tenantId?:unknown;artworkId?:unknown;revision?:unknown}|undefined;
 if(purpose!=='full'||!binding||!Number.isSafeInteger(artwork.revision)||artwork.revision<1||binding.tenantId!==tenantId||binding.artworkId!==artwork.id||binding.revision!==artwork.revision||!isDeepStrictEqual(artwork,currentArtwork)||assetId!==artwork.primaryAssetId)throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 const approval=qualifyDemoDisplay(artwork,bytes);qualifyDemoDisplayAsset(artwork,assetId,bytes);
 const profile=approval?.privatePaintingCandidate;
 if(!profile||!Object.hasOwn(privatePaintingProfiles,profile)||bytes.length>8388608)throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 const size=privatePaintingProfiles[profile],capability=Object.freeze({profile,...size});
 privatePaintingIssued.set(capability,{snapshot:structuredClone(artwork),tenantId,assetId,sourceSha256:sha256(bytes),sourceBytes:bytes.length});return capability;
}
/** Recheck the exact source and CMS snapshot before consuming the opaque
 * capability. A copied or deserialized object cannot acquire its authority. */
export function privatePaintingCandidateRecipe(capability:PrivatePaintingCapability,context:PrivatePaintingContext){
 const issued=privatePaintingIssued.get(capability);
 if(!issued||issued.tenantId!==context.tenantId||issued.assetId!==context.assetId||issued.sourceBytes!==context.bytes.length||issued.sourceSha256!==sha256(context.bytes)||!isDeepStrictEqual(issued.snapshot,context.artwork))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 const current=issuePrivatePaintingCapability(context);
 if(current.profile!==capability.profile)throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 return Object.freeze({version:1 as const,profile:capability.profile,sourceSha256:issued.sourceSha256,width:capability.width,height:capability.height});
}
