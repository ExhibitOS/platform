// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {APPROVED_DEMO_DISPLAY_FILES as approved} from './approved-demo-display-files.ts';
import {qualifyDemoDisplay,qualifyDemoDisplayAsset,type DemoDisplayApproval} from './demo-display-policy.ts';
const witness=vi.hoisted(()=>({full:Buffer.alloc(100,1),coarse:Buffer.alloc(50,2)}));
// Synthetic admission records only: no actual image decoding or production
// approval entry is fabricated by this metadata/hash boundary test.
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{createHash}=await import('node:crypto');
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,{...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:'10000000-0000-4000-8000-000000000099',canonicalAssetSha256:hash(witness.full),canonicalBytes:100,canonicalMaxPixels:4194304,coarse:{sha256:hash(witness.coarse),bytes:50,width:512,height:512}}]};
});
async function fixture(index=3){
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(v=>v.artworkType==='image')!,entry=approved.at(index)! as DemoDisplayApproval,full={...a.assets[0]!,bytes:entry.canonicalBytes,sha256:entry.canonicalAssetSha256};
 a.assets=[full];a.primaryAssetId=full.id;a.extensions={[N]:{version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256}};
 if(entry.coarse){const coarse={...full,id:'10000000-0000-4000-8000-000000000098',path:'assets/coarse.png',bytes:entry.coarse.bytes,sha256:entry.coarse.sha256};a.assets.push(coarse);a.extensions[LOD_NAMESPACE]={version:1,variants:[{assetId:full.id,detail:'full',textureSize:2048},{assetId:coarse.id,detail:'coarse',textureSize:512}]};}
 return a;
}
test('only an exact newly listed pair receives its bounded full/coarse neutral allowances',async()=>{
 const a=await fixture();expect(qualifyDemoDisplayAsset(a,a.primaryAssetId,witness.full)).toEqual({maxPixels:4194304,maxEdge:2048});
 expect(qualifyDemoDisplayAsset(a,a.assets[1]!.id,witness.coarse)).toEqual({maxPixels:262144,maxEdge:512});
 expect(()=>qualifyDemoDisplayAsset(a,a.assets[1]!.id,Buffer.alloc(50,3))).toThrow('ASSET_INTEGRITY');
 expect(qualifyDemoDisplay(await fixture(0))?.canonicalMaxPixels??2097152).toBe(2097152);
 const fallback=await fixture();fallback.assets.pop();delete fallback.extensions![LOD_NAMESPACE];
 expect(qualifyDemoDisplayAsset(fallback,fallback.primaryAssetId,witness.full)).toEqual({maxPixels:4194304,maxEdge:2048});
});
test('missing or changed approved coarse metadata never inherits the primary neutral approval',async()=>{
 const a=await fixture();a.assets[1]!.sha256='b'.repeat(64);expect(()=>qualifyDemoDisplay(a)).toThrow('DISPLAY_POLICY_INVALID');
 const missing=await fixture();missing.assets.pop();expect(()=>qualifyDemoDisplay(missing)).toThrow('DISPLAY_POLICY_INVALID');
});
