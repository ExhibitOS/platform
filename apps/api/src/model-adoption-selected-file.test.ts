// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {DISPLAY_POLICY_NAMESPACE} from '@exhibitos/studio-contract';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
import {modelAdoptionDisplayPolicy} from './model-adoption-display-policy.ts';

it('qualifies the separately selected Old Arrow source/display without rebinding its prior approval',()=>{
 const previous=APPROVED_DEMO_DISPLAY_FILES.find(entry=>entry.approvalId==='2963550d-61e7-55ab-9be9-19813e8e5ea4')!;
 const successor=APPROVED_DEMO_DISPLAY_FILES.find(entry=>entry.approvalId==='b2d9ab8d-8f4c-48a8-8d55-9f025be91cd5')!;
 const prior=syntheticArtwork('sculpture');
 prior.assets=[{...prior.assets[0]!,sha256:previous.canonicalAssetSha256,bytes:previous.canonicalBytes}];
 prior.extensions={[DISPLAY_POLICY_NAMESPACE]:{version:1,profile:'approved-open-access-demo-v1',
  approvalId:previous.approvalId,sourceAssetSha256:previous.canonicalAssetSha256,rightsEvidenceSha256:previous.rightsEvidenceSha256}};
 const snapshot=structuredClone(prior);
 expect(modelAdoptionDisplayPolicy(prior,{sha256:successor.rawSourceSha256,bytes:8285292},
  {sha256:successor.canonicalAssetSha256,bytes:successor.canonicalBytes})).toEqual({
  version:1,profile:'approved-open-access-demo-v1',approvalId:successor.approvalId,
  sourceAssetSha256:successor.canonicalAssetSha256,rightsEvidenceSha256:successor.rightsEvidenceSha256,
 });
 expect(prior).toEqual(snapshot);
 expect(successor.rightsEvidenceSha256).not.toBe(previous.rightsEvidenceSha256);
 expect(successor.rawSourceSha256).not.toBe(previous.rawSourceSha256);
});
