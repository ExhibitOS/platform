// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFurnishingOrdinaryAssertion,authenticateFurnishingOrdinaryAssertion,verifyFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
const key=Buffer.alloc(32,7),kind='furnishing-ordinary-admission',ack='furnishing-ordinary-admission-ack';
const fields={runtimeGeneration:'10000000-0000-4000-8000-000000000001',leaseTranscriptSHA256:'a'.repeat(64),admissionKind:'fresh-empty',activeBindingSHA256:'b'.repeat(64)};
test('authenticates each canonical admission kind and separates acknowledgement domain',()=>{
 for(const admissionKind of ['fresh-empty','clean-reopen','verified-restore']){const value={...fields,admissionKind},frame=encodeFurnishingOrdinaryAssertion(kind,value,key);assert.deepEqual(authenticateFurnishingOrdinaryAssertion(frame,kind,key),value);assert.throws(()=>authenticateFurnishingOrdinaryAssertion(frame,ack,key));assert.deepEqual(authenticateFurnishingOrdinaryAssertion(encodeFurnishingOrdinaryAssertion(ack,value,key),ack,key),value);}
});
test('rejects tampering, noncanonical framing and malformed fields',()=>{
 const frame=encodeFurnishingOrdinaryAssertion(kind,fields,key),value=JSON.parse(frame.toString());
 for(const altered of [{...value,admissionKind:'clean-reopen'},{...value,activeBindingSHA256:'c'.repeat(64)},{...value,extra:true}])assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(JSON.stringify(altered)),kind,key));
 assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(' '+frame.toString()),kind,key));
 assert.throws(()=>authenticateFurnishingOrdinaryAssertion(frame,kind,Buffer.alloc(32,8)));
 assert.throws(()=>encodeFurnishingOrdinaryAssertion(kind,{...fields,admissionKind:'unknown'},key));
});
test('stop and drained frames have separate domains and match the exact active context',()=>{
 const stop='furnishing-ordinary-stop',drained='furnishing-ordinary-drained',frame=encodeFurnishingOrdinaryAssertion(stop,fields,key);
 assert.deepEqual(verifyFurnishingOrdinaryAssertion(frame,stop,fields,key),fields);assert.throws(()=>verifyFurnishingOrdinaryAssertion(frame,drained,fields,key));assert.throws(()=>verifyFurnishingOrdinaryAssertion(frame,stop,{...fields,activeBindingSHA256:'c'.repeat(64)},key));
});
test('canonical synthetic protocol vectors remain stable',()=>{
 const expected={'furnishing-ordinary-admission':'7ea9fbf4b22a78457b648baa073a873a3d0c203dcae8b6a75d479492ddec1165','furnishing-ordinary-admission-ack':'820e3430564a206fb41e99c398d9e2c910fa71cde330e90eed08297c21aed29d','furnishing-ordinary-stop':'60abe8c7234306652975f8cf751dc210a685a5dd1585216fe8fefc04027c0215','furnishing-ordinary-drained':'caee6a1be1439a9893bc93ed925fd2b1b9e6751e1b81ea39b5bd0d2f2ab1ce46'};
 for(const [name,mac] of Object.entries(expected))assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion(name,fields,key).toString()).mac,mac);
});
