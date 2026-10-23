// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkDisplayPolicy} from '@exhibitos/studio-contract';
import {sha256} from '@exhibitos/storage';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
import {ApiError} from './auth.ts';
import {allowedRights} from './rights.ts';
/** Called at the legitimate OEX/publication producer boundary. Inventory declarations
 * alone never prove bytes; a producing caller supplies the observed primary bytes.
 * Current CMS approval/revision/resource rights remain the caller's existing gates.
 */
export function qualifyDemoDisplay(artwork:Artwork,bytes?:Buffer){
 let policy;try{policy=artworkDisplayPolicy(artwork);}catch(error){throw Object.assign(new ApiError(422,'DISPLAY_POLICY_INVALID'),{cause:error});}
 if(!policy)return undefined;
 const approval=APPROVED_DEMO_DISPLAY_FILES.find(a=>a.approvalId.toLowerCase()===policy.approvalId.toLowerCase()),primary=artwork.assets.find(a=>a.id.toLowerCase()===artwork.primaryAssetId.toLowerCase());
 if(!approval||!primary||policy.rightsEvidenceSha256!==approval.rightsEvidenceSha256||policy.sourceAssetSha256!==approval.canonicalAssetSha256||primary.sha256!==approval.canonicalAssetSha256||primary.bytes!==approval.canonicalBytes||primary.mime!=='image/png'||primary.role!=='image'||artwork.artworkType!=='image'||!allowedRights(artwork.rights,'display'))throw new ApiError(422,'DISPLAY_POLICY_INVALID');
 if(bytes&&(bytes.length!==primary.bytes||sha256(bytes)!==primary.sha256))throw new ApiError(409,'ASSET_INTEGRITY');
 return approval;
}
