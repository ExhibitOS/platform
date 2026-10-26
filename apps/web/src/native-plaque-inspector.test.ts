// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {nativePlaqueInspectorCandidate,checkedPlaqueInspectorRequest,type PlaqueInspectorRequest} from './native-plaque-inspector';
import {plaquesFor} from '@exhibitos/studio-contract';
function sample(){
  const draft=newDraft(),roomId=draft.candidate.rooms[0]!.id;
  const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
  const request:PlaqueInspectorRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'add-plaque',plaque:{id:crypto.randomUUID(),roomId,source:{kind:'exhibition'},position:[0,1.5,0],rotation:[0,0,0,1],dimensions:{width:1,height:.6},visible:true}};
  return {frame,request};
}
test('closed optional inspector creates a plaque without opening ordinary v1 actions',()=>{
  const {frame,request}=sample(),before=structuredClone(frame),candidate=nativePlaqueInspectorCandidate(frame,request);expect(plaquesFor(candidate)).toHaveLength(1);expect(frame).toEqual(before);
  expect(()=>nativeGeometryAction(frame,request as never)).toThrow('VIEWPORT_COMMAND_DENIED');expect(()=>checkedFrame({...frame,selection:{kind:'plaque',id:request.plaque.id}})).toThrow('VIEWPORT_SELECTION_INVALID');
});
test('foreign, stale, oversized, extra-field or disabled requests never mutate source',()=>{
  const {frame,request}=sample(),before=structuredClone(frame);
  for(const value of [{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,extra:true},{...request,plaque:{...request.plaque,extra:'x'.repeat(70000)}},{...request,plaque:{...request.plaque,roomId:crypto.randomUUID()}}])expect(()=>nativePlaqueInspectorCandidate(frame,value)).toThrow();
  expect(()=>checkedPlaqueInspectorRequest(request,{...frame,disabled:true})).toThrow();expect(frame).toEqual(before);
});
