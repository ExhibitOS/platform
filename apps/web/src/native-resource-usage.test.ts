// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import * as three from 'three';
import {resolveViewerBudgetPolicy} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedResourceUsageRequest,readNativeResourceUsage} from './native-resource-usage';
import {collectSceneResourceUsage} from './viewer/scene-resource-usage';
const sample=()=>{const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:3,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};return {frame,request:{version:1 as const,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID()}};};
test('binds read-only observations and shared evaluation to the accepted candidate/profile; absent renderer stays unknown',async()=>{
 const {frame,request}=sample(),before=structuredClone(frame),policy=resolveViewerBudgetPolicy(frame.draft.candidate,'native');
 const source={document:frame.draft.candidate,policy,read:()=>collectSceneResourceUsage(three,new three.Scene(),new Map(),{settled:false})},authenticate=vi.fn(async()=>{});
 expect(checkedResourceUsageRequest(request,frame)).toEqual(request);
 const result=await readNativeResourceUsage(request,frame,{current:()=>true,source:()=>source,authenticate});
 expect(result).toMatchObject({...request,candidateSha256:expect.stringMatching(/^[a-f0-9]{64}$/),policy:{profile:'native'},observations:{scope:'mounted-scene',residentBytes:null},evaluation:{scope:'analyzedSection',status:'unknown'}});
 expect((await readNativeResourceUsage(request,frame,{current:()=>true,source:()=>null,authenticate})).observations).toBeNull();expect(frame).toEqual(before);
 for(const changed of [{...request,sequence:4},{...request,principalId:crypto.randomUUID()},{...request,extra:true}])expect(()=>checkedResourceUsageRequest(changed,frame)).toThrow();
});
test('discards a late reply after frame changes while authentication is pending',async()=>{
 const {frame,request}=sample();let current=true,finish!:()=>void;
 const pending=readNativeResourceUsage(request,frame,{current:()=>current,source:()=>null,authenticate:()=>new Promise<void>(resolve=>{finish=resolve;})});
 current=false;finish();await expect(pending).rejects.toThrow('RESOURCE_USAGE_STALE');
});
