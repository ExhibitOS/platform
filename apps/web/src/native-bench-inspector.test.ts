// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {nativeBenchInspectorCandidate,checkedBenchInspectorRequest,type BenchInspectorRequest} from './native-bench-inspector';
import {benchesFor} from '@exhibitos/studio-contract';
function sample(){
  const draft=newDraft(),roomId=draft.candidate.rooms[0]!.id,viewpointId=crypto.randomUUID();
  const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
  const request:BenchInspectorRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'add-bench',bench:{id:crypto.randomUUID(),name:'Bench',roomId,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,depth:.6,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId,position:[0,1.15,0],target:[0,1,-2],fov:50}};
  return {frame,request};
}
test('closed optional inspector creates first camera/bench atomically without opening ordinary v1 actions',()=>{
  const {frame,request}=sample(),before=structuredClone(frame),candidate=nativeBenchInspectorCandidate(frame,request);expect(benchesFor(candidate)).toHaveLength(1);expect(frame).toEqual(before);
  expect(()=>nativeGeometryAction(frame,request as never)).toThrow('VIEWPORT_COMMAND_DENIED');expect(()=>checkedFrame({...frame,selection:{kind:'bench',id:request.bench.id}})).toThrow('VIEWPORT_SELECTION_INVALID');
});
test('foreign, stale, oversized, extra-field or disabled requests never mutate source',()=>{
  const {frame,request}=sample(),before=structuredClone(frame);
  for(const value of [{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,extra:true},{...request,bench:{...request.bench,name:'x'.repeat(70000)}},{...request,bench:{...request.bench,roomId:crypto.randomUUID()}}])expect(()=>nativeBenchInspectorCandidate(frame,value)).toThrow();
  expect(()=>checkedBenchInspectorRequest(request,{...frame,disabled:true})).toThrow();expect(frame).toEqual(before);
});
