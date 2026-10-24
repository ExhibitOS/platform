// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkDisplayPolicy,LOD_NAMESPACE,validateViewerLod} from '@exhibitos/studio-contract';
import {sha256} from '@exhibitos/storage';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
import {ApiError} from './auth.ts';
import {allowedRights} from './rights.ts';
/** Optional exact-file additions to the same Docs-owned immutable manifest.
 * Existing records keep their original 2 MP admission and primary-only approval. */
export type DemoDisplayApproval = typeof APPROVED_DEMO_DISPLAY_FILES[number] & {
 canonicalMaxPixels?:2097152|4194304;
 coarse?:{sha256:string;bytes:number;width:number;height:number};
};
/** Called at the legitimate OEX/publication producer boundary. Inventory declarations
 * alone never prove bytes; a producing caller supplies the observed primary bytes.
 * Current CMS approval/revision/resource rights remain the caller's existing gates.
 */
export function qualifyDemoDisplay(artwork:Artwork,bytes?:Buffer){
 let policy;try{policy=artworkDisplayPolicy(artwork);}catch(error){throw Object.assign(new ApiError(422,'DISPLAY_POLICY_INVALID'),{cause:error});}
 if(!policy)return undefined;
 const approval:DemoDisplayApproval|undefined=APPROVED_DEMO_DISPLAY_FILES.find(a=>a.approvalId.toLowerCase()===policy.approvalId.toLowerCase()),primary=artwork.assets.find(a=>a.id.toLowerCase()===artwork.primaryAssetId.toLowerCase());
 if(!approval||!primary||policy.rightsEvidenceSha256!==approval.rightsEvidenceSha256||policy.sourceAssetSha256!==approval.canonicalAssetSha256||primary.sha256!==approval.canonicalAssetSha256||primary.bytes!==approval.canonicalBytes||primary.mime!=='image/png'||primary.role!=='image'||artwork.artworkType!=='image'||!allowedRights(artwork.rights,'display'))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
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
