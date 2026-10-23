// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
export const DISPLAY_POLICY_NAMESPACE='org.exhibitos.viewer/display-policy';
export interface ApprovedDemoDisplayPolicy {version:1;profile:'approved-open-access-demo-v1';approvalId:string;sourceAssetSha256:string;rightsEvidenceSha256:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,sha=/^[a-f0-9]{64}$/;
/** Structure/inventory binding only. A producer must additionally match the immutable
 * selected-file approval and actual verified primary bytes; client assertions grant no exception.
 */
export function validateArtworkDisplayPolicy(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))return {valid:true,errors:[]};
 const artwork=input as Artwork;
 const value=artwork.extensions?.[DISPLAY_POLICY_NAMESPACE];if(value===undefined)return {valid:true,errors:[]};
 const fail=()=>({valid:false,errors:[{code:'DISPLAY_POLICY_INVALID',path:'/extensions/org.exhibitos.viewer~1display-policy',message:'Expected a closed selected-demo policy bound to the exact primary inventory SHA'}]});
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='approvalId,profile,rightsEvidenceSha256,sourceAssetSha256,version'||value.version!==1||value.profile!=='approved-open-access-demo-v1'||typeof value.approvalId!=='string'||!uuid.test(value.approvalId)||typeof value.sourceAssetSha256!=='string'||!sha.test(value.sourceAssetSha256)||typeof value.rightsEvidenceSha256!=='string'||!sha.test(value.rightsEvidenceSha256))return fail();
 if(!Array.isArray(artwork.assets)||typeof artwork.primaryAssetId!=='string')return fail();
 const primary=artwork.assets.find(a=>a&&typeof a.id==='string'&&a.id.toLowerCase()===artwork.primaryAssetId.toLowerCase());
 if(!primary||primary.sha256!==value.sourceAssetSha256)return fail();return {valid:true,errors:[]};
}
export function artworkDisplayPolicy(artwork:Artwork):ApprovedDemoDisplayPolicy|undefined{
 if(!validateArtworkDisplayPolicy(artwork).valid)throw Error('DISPLAY_POLICY_INVALID');
 const value=artwork.extensions?.[DISPLAY_POLICY_NAMESPACE];return value===undefined?undefined:structuredClone(value) as unknown as ApprovedDemoDisplayPolicy;
}
