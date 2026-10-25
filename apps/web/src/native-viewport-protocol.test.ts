// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction,geometryProposal,type NativeViewportFrame,type NativeGeometryAction} from './native-viewport-protocol';
import {newDoor,applyGeometryCommand,createGeometryState,undoGeometry} from './geometry/model';
import {MATERIAL_NAMESPACE,materialFor,DEFAULT_MATERIAL} from '@exhibitos/studio-contract';
const uuid=()=>crypto.randomUUID();
const frame=():NativeViewportFrame=>({version:1,epoch:uuid(),sequence:1,tenantId:uuid(),principalId:uuid(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
function selectedArchitecture() {
 const f=frame(),roomId=f.draft.candidate.rooms[0]!.id;
 f.draft.candidate=nativeGeometryAction(f,{type:'white-cube',roomId});
 const surface=f.draft.candidate.surfaces.find(s=>s.type==='wall')!;
 f.draft.candidate.openings.push(newDoor(surface.id,{width:1,height:2},[0,0]));
 f.draft.candidate.extensions={'example.org/preserved':{note:'unchanged'}};
 const {id:roomId2,...room}=f.draft.candidate.rooms[0]!;
 const {id:surfaceId,...surfaceValue}=surface;
 const {id:openingId,...opening}=f.draft.candidate.openings[0]!;
 const actions:NativeGeometryAction[]=[
  {type:'set-room',id:roomId2,room:{...room,name:'편집한 방',dimensions:{...room.dimensions,width:room.dimensions.width+1}}},
  {type:'set-surface',id:surfaceId,surface:{...surfaceValue,dimensions:{...surfaceValue.dimensions,width:surfaceValue.dimensions.width-.1}}},
  {type:'set-opening',id:openingId,opening:{...opening,offset:[.1,0]}},
 ];
 return {f,actions};
}
describe('native viewport frame and shared geometry proposal boundary',()=>{
 it('sets and removes only the selected surface material through the existing validated command path',()=>{
  const {f}=selectedArchitecture(),surfaceId=f.draft.candidate.surfaces[0]!.id,otherId=f.draft.candidate.surfaces[1]!.id;
  const other={color:'#123456',roughness:.3,metalness:.1},material={color:'#abcdef',roughness:0,metalness:1};
  f.draft.candidate.extensions![MATERIAL_NAMESPACE]={version:1,surfaces:{[surfaceId.toUpperCase()]:other,[otherId]:other}};
  const selected:NativeViewportFrame={...f,selection:{kind:'surface',id:surfaceId}},original=structuredClone(selected);
  const command={type:'set-material' as const,surfaceId,material},state=applyGeometryCommand(createGeometryState(f.draft.candidate),command);
  const result=nativeGeometryAction(selected,command),expected=structuredClone(f.draft.candidate);
  expected.extensions![MATERIAL_NAMESPACE]={version:1,surfaces:{[surfaceId]:material,[otherId]:other}};
  expect(result).toEqual(expected);expect(result).toEqual(state.present);expect(undoGeometry(state).present).toEqual(f.draft.candidate);
  expect(checkedFrame({...selected,draft:{...f.draft,candidate:result}}).draft.candidate).toEqual(result);
  const removed=nativeGeometryAction({...selected,draft:{...f.draft,candidate:result}},{...command,material:null});
  expected.extensions![MATERIAL_NAMESPACE]={version:1,surfaces:{[otherId]:other}};
  expect(removed).toEqual(expected);expect(materialFor(removed,surfaceId)).toEqual(DEFAULT_MATERIAL);expect(selected).toEqual(original);
 });
 it('denies material edits outside the enabled current selected surface and closed action envelope',()=>{
  const {f}=selectedArchitecture(),surfaceId=f.draft.candidate.surfaces[0]!.id;
  const selected:NativeViewportFrame={...f,selection:{kind:'surface',id:surfaceId}},original=structuredClone(selected);
  const command={type:'set-material' as const,surfaceId,material:{color:'#abcdef',roughness:.8,metalness:0}};
  for(const invalid of [{...selected,disabled:true},{...selected,selection:null},{...selected,selection:{kind:'room' as const,id:surfaceId}},{...selected,selection:{kind:'surface' as const,id:uuid()}}])expect(()=>nativeGeometryAction(invalid,command)).toThrow('VIEWPORT_COMMAND_DENIED');
  for(const action of [{...command,surfaceId:'invalid'},{...command,surfaceId:uuid()},{...command,extra:true},{type:command.type,surfaceId},...['',0,false,[],undefined].map(material=>({...command,material}))])expect(()=>nativeGeometryAction(selected,action as NativeGeometryAction)).toThrow('VIEWPORT_COMMAND_DENIED');
  expect(()=>nativeGeometryAction(checkedFrame(selected,selected),command)).toThrow('VIEWPORT_FRAME_STALE');
  const missing=uuid();expect(()=>nativeGeometryAction({...selected,selection:{kind:'surface',id:missing}},{...command,surfaceId:missing})).toThrow();
  expect(selected).toEqual(original);
 });
 it('keeps strict material metadata validation without mutating the source on refusal',()=>{
  const {f}=selectedArchitecture(),surfaceId=f.draft.candidate.surfaces[0]!.id;
  const selected:NativeViewportFrame={...f,selection:{kind:'surface',id:surfaceId}},original=structuredClone(selected),valid={color:'#abcdef',roughness:.8,metalness:0};
  for(const material of [{...valid,color:'#ABCDEF'},{...valid,color:'#fff'},{...valid,roughness:-.1},{...valid,roughness:1.1},{...valid,metalness:NaN},{...valid,metalness:Infinity},{...valid,roughness:'0.8'},{...valid,extra:true},{color:valid.color,roughness:.8},{}])expect(()=>nativeGeometryAction(selected,{type:'set-material',surfaceId,material} as NativeGeometryAction)).toThrow('INVALID_GEOMETRY');
  expect(selected).toEqual(original);
 });
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
 it('applies only the selected complete architecture record through the existing geometry validator',()=>{
  const {f,actions}=selectedArchitecture(),original=structuredClone(f);
  for(const action of actions){
   if(action.type!=='set-room'&&action.type!=='set-surface'&&action.type!=='set-opening')throw Error('fixture');
   const kind=action.type==='set-room'?'room':action.type==='set-surface'?'surface':'opening';
   const result=nativeGeometryAction({...f,selection:{kind,id:action.id}},action),expected=structuredClone(f.draft.candidate);
   if(action.type==='set-room')expected.rooms[0]={...action.room,id:action.id};
   if(action.type==='set-surface')expected.surfaces[expected.surfaces.findIndex(s=>s.id===action.id)]={...action.surface,id:action.id};
   if(action.type==='set-opening')expected.openings[0]={...action.opening,id:action.id};
   expect(result).toEqual(expected);expect(checkedFrame({...f,draft:{...f.draft,candidate:result}}).draft.candidate).toEqual(expected);
  }
  expect(f).toEqual(original);
 });
 it('denies disabled, stale, mismatched selections and unrelated outer changes for architecture actions',()=>{
  const {f,actions}=selectedArchitecture(),original=structuredClone(f);
  for(const action of actions){
   if(action.type!=='set-room'&&action.type!=='set-surface'&&action.type!=='set-opening')throw Error('fixture');
   const kind=action.type==='set-room'?'room':action.type==='set-surface'?'surface':'opening';
   const selected:NativeViewportFrame={...f,selection:{kind,id:action.id}};
   expect(()=>nativeGeometryAction({...selected,disabled:true},action)).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction(f,action)).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction({...selected,selection:{kind:kind==='room'?'surface':'room',id:action.id}},action)).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction({...selected,selection:{kind,id:uuid()}},action)).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction(selected,{...action,id:'invalid'})).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction(selected,{...action,title:'unrelated'} as unknown as NativeGeometryAction)).toThrow('VIEWPORT_COMMAND_DENIED');
   expect(()=>nativeGeometryAction(checkedFrame(selected,selected),action)).toThrow('VIEWPORT_FRAME_STALE');
  }
  expect(f).toEqual(original);
 });
 it('rejects incomplete and invalid architecture payloads without weakening the core validator',()=>{
  const {f,actions}=selectedArchitecture(),original=structuredClone(f);
  for(const action of actions){
   if(action.type==='set-room'){
    const selected={...f,selection:{kind:'room' as const,id:action.id}};
    expect(()=>nativeGeometryAction(selected,{...action,room:{...action.room,dimensions:{...action.room.dimensions,width:-1}}})).toThrow();
    expect(()=>nativeGeometryAction(selected,{type:action.type,id:action.id} as NativeGeometryAction)).toThrow();
   }
   if(action.type==='set-surface')expect(()=>nativeGeometryAction({...f,selection:{kind:'surface',id:action.id}},{...action,surface:{...action.surface,roomId:uuid()}})).toThrow();
   if(action.type==='set-opening')expect(()=>nativeGeometryAction({...f,selection:{kind:'opening',id:action.id}},{...action,opening:{...action.opening,dimensions:{...action.opening.dimensions,height:-1}}})).toThrow();
  }
  expect(f).toEqual(original);
 });
});
