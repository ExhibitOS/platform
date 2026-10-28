// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {decode} from './imports.ts';
import {qualifyDemoDisplay,qualifyDemoDisplayAsset} from './demo-display-policy.ts';
import {measureFullVariant} from './viewer-variants.ts';
import {normalizeDisplayWatermark,type DisplayWatermark} from '@exhibitos/studio-contract';
import {cachedDisplayDerivative,type DisplayDerivativeCache} from './display-derivative-cache.ts';
export interface PublicationDisplayOptions {watermark?:DisplayWatermark;cache?:DisplayDerivativeCache}
/** Selected-file authority remains source-bound. Clean model distribution never
 * adds geometry; original access and required credits remain independent. */
export async function publicationModelDerivative(artwork:Artwork,original:Buffer,options:PublicationDisplayOptions={}){
 const watermark=normalizeDisplayWatermark(options.watermark);
 const approval=qualifyDemoDisplay(artwork,original);
 if(approval?.canonicalMime!=='model/gltf-binary')return cachedDisplayDerivative(original,'model/gltf-binary',{watermark},options.cache);
 await decode(original,'model/gltf-binary');
 const metric=measureFullVariant(original,'model/gltf-binary');
 if(metric.triangles!==approval.canonicalTriangles||(metric.textureSize??0)>approval.canonicalMaxTextureSize!)throw Error('DISPLAY_POLICY_INVALID');
 return Buffer.from(original);
}
/** Reuse exact suitable approved bytes for none/overlay; explicit image labels
 * use the same bounded quality/recipe cache as ordinary authorized images. */
export async function publicationImageDerivative(artwork:Artwork,original:Buffer,sourceAssetId=artwork.primaryAssetId,options:PublicationDisplayOptions={}){
 const watermark=normalizeDisplayWatermark(options.watermark);
 const approval=qualifyDemoDisplayAsset(artwork,sourceAssetId,original);
 const quality={maxTextureSize:sourceAssetId.toLowerCase()===artwork.primaryAssetId.toLowerCase()?2048 as const:512 as const,watermark};
 if(!approval)return cachedDisplayDerivative(original,'image/png',quality,options.cache);
 // Approval is for exact canonical bytes, not an invitation to silently resize/re-encode.
 // Keep strict decoder/resource checks before the neutral public derivative is returned.
 if(original.length>8388608||original.length<33||original.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||original.toString('ascii',12,16)!=='IHDR')throw Error('DISPLAY_POLICY_INVALID');
 const w=original.readUInt32BE(16),h=original.readUInt32BE(20);
 if(!w||!h||w>approval.maxEdge||h>approval.maxEdge||w*h>approval.maxPixels||original[24]!==8||![2,6].includes(original[25]!))throw Error('DISPLAY_POLICY_INVALID');
 await decode(original,'image/png');
 return watermark.mode==='embedded'?cachedDisplayDerivative(original,'image/png',quality,options.cache):Buffer.from(original);
}
