// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {derivative} from './derivative.ts';
import {decode} from './imports.ts';
import {qualifyDemoDisplay,qualifyDemoDisplayAsset} from './demo-display-policy.ts';
import {measureFullVariant} from './viewer-variants.ts';
/** Only an explicitly model-typed exact primary receives a strict immutable copy.
 * Ordinary CMS previews and every unselected GLB retain the default mark. */
export async function publicationModelDerivative(artwork:Artwork,original:Buffer){
 const approval=qualifyDemoDisplay(artwork,original);
 if(approval?.canonicalMime!=='model/gltf-binary')return derivative(original,'model/gltf-binary');
 await decode(original,'model/gltf-binary');
 const metric=measureFullVariant(original,'model/gltf-binary');
 if(metric.triangles!==approval.canonicalTriangles||(metric.textureSize??0)>approval.canonicalMaxTextureSize!)throw Error('DISPLAY_POLICY_INVALID');
 return Buffer.from(original);
}
/** Explicit selected-file branch only. Default display keeps the existing mark. */
export async function publicationImageDerivative(artwork:Artwork,original:Buffer,sourceAssetId=artwork.primaryAssetId){
 const approval=qualifyDemoDisplayAsset(artwork,sourceAssetId,original);
 if(!approval)return derivative(original,'image/png',{maxTextureSize:sourceAssetId.toLowerCase()===artwork.primaryAssetId.toLowerCase()?2048:512});
 // Approval is for exact canonical bytes, not an invitation to silently resize/re-encode.
 // Keep strict decoder/resource checks before the neutral public derivative is returned.
 if(original.length>8388608||original.length<33||original.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||original.toString('ascii',12,16)!=='IHDR')throw Error('DISPLAY_POLICY_INVALID');
 const w=original.readUInt32BE(16),h=original.readUInt32BE(20);
 if(!w||!h||w>approval.maxEdge||h>approval.maxEdge||w*h>approval.maxPixels||original[24]!==8||![2,6].includes(original[25]!))throw Error('DISPLAY_POLICY_INVALID');
 await decode(original,'image/png');return Buffer.from(original);
}
