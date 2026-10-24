// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction,geometryProposal,type NativeViewportFrame} from './native-viewport-protocol';
const uuid=()=>crypto.randomUUID();
const frame=():NativeViewportFrame=>({version:1,epoch:uuid(),sequence:1,tenantId:uuid(),principalId:uuid(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
describe('native viewport frame and shared geometry proposal boundary',()=>{
 it('refuses stale scopes, invalid document and unknown commands without changing the source',()=>{
  const f=frame(),original=structuredClone(f);expect(checkedFrame(f)).toEqual(f);
  for(const bad of [{...f,version:2},{...f,extra:true},{...f,selection:{kind:'room',id:uuid()}},{...f,sequence:0},{...f,cameraSequence:-1},{...f,cameraSequence:0.5},{...f,transparent:'true'}])expect(()=>checkedFrame(bad)).toThrow();
  expect(()=>checkedFrame(f,f)).toThrow('VIEWPORT_FRAME_STALE');expect(()=>checkedFrame({...f,sequence:2,tenantId:uuid()},f)).toThrow();
  expect(()=>nativeGeometryAction(f,{type:'add-light',roomId:uuid()})).toThrow();
  expect(()=>geometryProposal(f,{type:'set-title',title:'outside native authoring'})).toThrow('VIEWPORT_COMMAND_DENIED');
  expect(()=>nativeGeometryAction({...f,disabled:true},{type:'white-cube',roomId:f.draft.candidate.rooms[0]!.id})).toThrow();expect(f).toEqual(original);
 });
 it('reuses validated architecture/light commands and preserves the exact document inventory/rights',()=>{
  const f=frame(),roomId=f.draft.candidate.rooms[0]!.id;
  const cube=nativeGeometryAction(f,{type:'white-cube',roomId});expect(cube.surfaces.length).toBeGreaterThan(0);expect(cube.artworks).toEqual(f.draft.candidate.artworks);expect(f.draft.candidate.surfaces).toHaveLength(0);
  const lit=nativeGeometryAction({...f,draft:{...f.draft,candidate:cube}},{type:'add-light',roomId});expect(lit.lights).toHaveLength(1);expect(lit.rooms).toEqual(cube.rooms);
  const room=nativeGeometryAction(f,{type:'add-room',name:'두 번째 방'});expect(room.rooms).toHaveLength(2);expect(room.id).toBe(f.draft.candidate.id);
 });
});
