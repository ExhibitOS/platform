import {whiteCubeSurfaces} from './geometry/model';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {nativeArchitecturalFinishCandidate,checkedArchitecturalFinishRequest,type ArchitecturalFinishRequest} from './native-architectural-finishes';
import {wallFinishesFor} from '@exhibitos/studio-contract';
function sample(){
  const draft=newDraft(),roomId=draft.candidate.rooms[0]!.id;
  draft.candidate.surfaces=whiteCubeSurfaces(draft.candidate.rooms[0]!);
  const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
  const request:ArchitecturalFinishRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'set-wall-finish',wall:{surfaceId:draft.candidate.surfaces[0]!.id,depth:.12,preset:'painted-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:true}};
  return {frame,request};
}
test('closed optional inspector previews a wall finish without mutating source without opening ordinary v1 actions',()=>{
  const {frame,request}=sample(),before=structuredClone(frame),candidate=nativeArchitecturalFinishCandidate(frame,request);expect(wallFinishesFor(candidate)).toHaveLength(1);expect(frame).toEqual(before);
  expect(()=>nativeGeometryAction(frame,request as never)).toThrow('VIEWPORT_COMMAND_DENIED');expect(()=>checkedFrame({...frame,selection:{kind:'finish',id:request.wall.surfaceId}})).toThrow('VIEWPORT_SELECTION_INVALID');
});
test('foreign, stale, oversized, extra-field or disabled requests never mutate source',()=>{
  const {frame,request}=sample(),before=structuredClone(frame);
  for(const value of [{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,extra:true},{...request,wall:{...request.wall,extra:'x'.repeat(70000)}},{...request,wall:{...request.wall,surfaceId:crypto.randomUUID()}}])expect(()=>nativeArchitecturalFinishCandidate(frame,value)).toThrow();
  expect(()=>checkedArchitecturalFinishRequest(request,{...frame,disabled:true})).toThrow();expect(frame).toEqual(before);
});
