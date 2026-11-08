// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical} from '@exhibitos/studio-contract';
import {buildNativeDetailPlan} from './native-detail-plan.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,pub=id(99);
function example(n,bytes=100){const assetId=id(n),featureReport={version:1,inspector:'synthetic-only',assetSha256:'a'.repeat(64),assetBytes:bytes,media:{kind:'image',codec:'jpeg',width:1,height:1,bitDepth:8,channels:3,frameCount:1,interlaced:false,orientation:1,colourProfile:'none'},cost:{model:'synthetic-only',residentBytes:4,peakAdditionalBytes:8}},candidate={candidateId:id(n+100),assetId,tier:'acquired-original',sha256:'a'.repeat(64),bytes,mime:'image/jpeg',sourceBindingSha256:'b'.repeat(64),featureReportSha256:sha(freezeCanonical(featureReport)),featureReport};return {artwork:{artworkType:'image',extensions:{[ARTWORK_DETAIL_QUALITY_NAMESPACE]:{version:1,candidates:[candidate]}}},descriptor:{assetId,url:`/api/v1/publications/${pub}/detail-assets/${assetId}`,mime:'image/jpeg'}};}
test('constructs a closed sorted and detached detail set and digest',async()=>{
 const a=example(2),b=example(1),exhibition={artworks:[a.artwork,b.artwork]},descriptors=[a.descriptor,b.descriptor],plan=await buildNativeDetailPlan(pub,exhibition,[],descriptors);assert.deepEqual(plan.entries.map(x=>x.assetId),[id(1),id(2)]);assert.equal(plan.detailSetSha256,sha(freezeCanonical(plan.entries)));assert.equal(plan.totalBytes,200);a.descriptor.url='/other';assert.equal(plan.entries[1].assetId,id(2));assert(Object.isFrozen(plan.entries[0]));
 const empty=await buildNativeDetailPlan(pub,{artworks:[]},[],[]);assert.equal(empty.detailSetSha256,sha('[]'));
 const single=example(1),fixed=await buildNativeDetailPlan(pub,{artworks:[single.artwork]},[],[single.descriptor]);assert.equal(fixed.detailSetSha256,'2331b683c05fed97d9e862d798390dc6215bdc9bd62713060afa749ecb7d6389');
});
test('refuses missing/duplicate/mis-scoped candidates and aggregate overflow',async()=>{
 const a=example(1),base={artworks:[a.artwork]};for(const [ordinary,descriptors] of [[[],[]],[[],[a.descriptor,a.descriptor]],[[{assetId:id(1)}],[a.descriptor]],[[],[{...a.descriptor,url:'/other'}]]])await assert.rejects(buildNativeDetailPlan(pub,base,ordinary,descriptors),/NATIVE_DETAIL_PLAN/);
 const many=Array.from({length:5},(_,i)=>example(i+1,25*1024*1024));await assert.rejects(buildNativeDetailPlan(pub,{artworks:many.map(x=>x.artwork)},[],many.map(x=>x.descriptor)),/NATIVE_DETAIL_PLAN/);
 const conflicting=example(2,101);await assert.rejects(buildNativeDetailPlan(pub,{artworks:[a.artwork,conflicting.artwork]},[],[a.descriptor,conflicting.descriptor]),/NATIVE_DETAIL_PLAN/);
});
