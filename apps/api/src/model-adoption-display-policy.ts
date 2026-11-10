// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkDisplayPolicy,DISPLAY_POLICY_NAMESPACE,LOD_NAMESPACE,type ApprovedDemoDisplayPolicy} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
import {qualifyDemoDisplay,type DemoDisplayApproval} from './demo-display-policy.ts';

interface Identity {sha256:string;bytes:number}
const unavailable=():never=>{throw new ApiError(409,'MODEL_ADOPTION_TARGET_CHANGED');};

/** An exact-file exception requires its own approved successor. Source custody
 * alone cannot transfer the old selected-file approval to different bytes. */
export function modelAdoptionDisplayPolicy(prior:Artwork,original:Identity,display:Identity):ApprovedDemoDisplayPolicy|undefined{
 const policy=artworkDisplayPolicy(prior);
 if(!policy)return;
 const previous=qualifyDemoDisplay(prior);
 if(!previous||previous.canonicalMime!=='model/gltf-binary')return unavailable();
 const matches=(APPROVED_DEMO_DISPLAY_FILES as readonly DemoDisplayApproval[]).filter(entry=>
  entry.approvalId.toLowerCase()!==previous.approvalId.toLowerCase()&&
  entry.institutionRecordId===previous.institutionRecordId&&entry.canonicalAssetSha256===display.sha256&&
  entry.canonicalBytes===display.bytes&&entry.rawSourceSha256===original.sha256&&
  entry.canonicalMime==='model/gltf-binary'&&entry.canonicalRole==='model'&&entry.artworkType==='sculpture'&&
  entry.allowedPublicUses.staticAssets&&entry.allowedPublicUses.OEXIncludingAsset);
 if(matches.length!==1)return unavailable();
 const successor=matches[0]!;
 const nextPolicy:ApprovedDemoDisplayPolicy={version:1,profile:'approved-open-access-demo-v1',
  approvalId:successor.approvalId,sourceAssetSha256:successor.canonicalAssetSha256,rightsEvidenceSha256:successor.rightsEvidenceSha256};
 const primary=prior.assets.find(asset=>asset.id===prior.primaryAssetId);
 if(!primary)return unavailable();
 const next=structuredClone(prior);
 next.assets=[{...primary,...display}];
 next.extensions={...next.extensions,[DISPLAY_POLICY_NAMESPACE]:{...nextPolicy}} as Artwork['extensions'];
 delete next.extensions![LOD_NAMESPACE];
 qualifyDemoDisplay(next);
 return nextPolicy;
}
