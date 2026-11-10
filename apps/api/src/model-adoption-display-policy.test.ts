// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {DISPLAY_POLICY_NAMESPACE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
const approvals=vi.hoisted(()=>{
 const shared={institutionRecordId:'synthetic-work',canonicalMime:'model/gltf-binary',canonicalRole:'model',artworkType:'sculpture',
  canonicalTriangles:20,canonicalMaxTextureSize:512,allowedPublicUses:{staticAssets:true,OEXIncludingAsset:true}};
 return [
  {...shared,approvalId:'11111111-1111-4111-8111-111111111111',canonicalAssetSha256:'a'.repeat(64),canonicalBytes:100,rawSourceSha256:'b'.repeat(64),rightsEvidenceSha256:'c'.repeat(64)},
  {...shared,approvalId:'22222222-2222-4222-8222-222222222222',canonicalAssetSha256:'d'.repeat(64),canonicalBytes:80,rawSourceSha256:'e'.repeat(64),rightsEvidenceSha256:'f'.repeat(64)},
 ];
});
vi.mock('./approved-demo-display-files.ts',()=>({APPROVED_DEMO_DISPLAY_FILES:approvals}));
import {modelAdoptionDisplayPolicy} from './model-adoption-display-policy.ts';
const original={sha256:'e'.repeat(64),bytes:200},display={sha256:'d'.repeat(64),bytes:80};
function fixture(){
 const prior=syntheticArtwork('sculpture'),approval=approvals[0]!;
 prior.assets=[{...prior.assets[0]!,sha256:approval.canonicalAssetSha256,bytes:approval.canonicalBytes}];
 prior.extensions={[DISPLAY_POLICY_NAMESPACE]:{version:1,profile:'approved-open-access-demo-v1',approvalId:approval.approvalId,
  sourceAssetSha256:approval.canonicalAssetSha256,rightsEvidenceSha256:approval.rightsEvidenceSha256}};
 return prior;
}
it('selects a separately approved same-work successor while retaining the historical snapshot',()=>{
 const prior=fixture(),before=structuredClone(prior);
 const policy=modelAdoptionDisplayPolicy(prior,original,display);
 expect(policy).toEqual({version:1,profile:'approved-open-access-demo-v1',approvalId:approvals[1]!.approvalId,
  sourceAssetSha256:display.sha256,rightsEvidenceSha256:approvals[1]!.rightsEvidenceSha256});
 expect(prior).toEqual(before);
});
it('keeps ordinary policy-free user adoption independent of the selected-file registry',()=>{
 const prior=fixture();delete prior.extensions![DISPLAY_POLICY_NAMESPACE];
 expect(modelAdoptionDisplayPolicy(prior,original,display)).toBeUndefined();
});
it('refuses unapproved bytes, source lineage, different institution and invalid prior evidence',()=>{
 for(const identity of [{...display,sha256:'1'.repeat(64)},{...display,bytes:81}])
  expect(()=>modelAdoptionDisplayPolicy(fixture(),original,identity)).toThrow('MODEL_ADOPTION_TARGET_CHANGED');
 expect(()=>modelAdoptionDisplayPolicy(fixture(),{...original,sha256:'2'.repeat(64)},display)).toThrow('MODEL_ADOPTION_TARGET_CHANGED');
 const prior=fixture();(prior.extensions![DISPLAY_POLICY_NAMESPACE] as {rightsEvidenceSha256:string}).rightsEvidenceSha256='3'.repeat(64);
 expect(()=>modelAdoptionDisplayPolicy(prior,original,display)).toThrow('DISPLAY_POLICY_INVALID');
 const entry=approvals[1]!,institution=entry.institutionRecordId;
 entry.institutionRecordId='different-work';
 try{expect(()=>modelAdoptionDisplayPolicy(fixture(),original,display)).toThrow('MODEL_ADOPTION_TARGET_CHANGED');}
 finally{entry.institutionRecordId=institution;}
});
it('does not carry a prior LOD tier onto a newly approved single display',()=>{
 const prior=fixture();
 prior.extensions![LOD_NAMESPACE]={version:1,variants:[{assetId:prior.primaryAssetId,detail:'full',triangles:20}]};
 const before=structuredClone(prior);
 expect(modelAdoptionDisplayPolicy(prior,original,display)?.sourceAssetSha256).toBe(display.sha256);
 expect(prior).toEqual(before);
});

it('refuses the previous selected file approval as its own successor',()=>{
 const previous=approvals[0]!;
 expect(()=>modelAdoptionDisplayPolicy(fixture(),{sha256:previous.rawSourceSha256,bytes:200},
  {sha256:previous.canonicalAssetSha256,bytes:previous.canonicalBytes})).toThrow('MODEL_ADOPTION_TARGET_CHANGED');
});
