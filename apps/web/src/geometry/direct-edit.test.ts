import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {newDraft} from '../drafts/example';
import {newPlacement,syntheticArtwork} from '../placement/model';
import {createGeometryState,applyGeometryCommand,undoGeometry} from './model';
import {roomDimensionCommand,planarRoomDimensionCommand,closestEditorSelection,planarCommand,worldMatrix,alignedWall,localPose} from './direct-edit';
function fixture(){let state=createGeometryState(newDraft().candidate);state=applyGeometryCommand(state,{type:'white-cube',roomId:state.present.rooms[0]!.id});const artwork=syntheticArtwork();state=applyGeometryCommand(state,{type:'add-artwork',artwork});return applyGeometryCommand(state,{type:'add-placement',placement:newPlacement(artwork,state.present.rooms[0]!.id)});}
describe('shared direct editing uses existing reversible commands',()=>{
 it('moves in world plan coordinates in a rotated room without resetting local height, tilt or scale; one commit is one undo',()=>{
  const base=fixture(),doc=structuredClone(base.present),room=doc.rooms[0]!,p=doc.placements[0]!;
  room.transform.rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2).toArray();
  p.transform.position=[0,1.25,0];p.transform.rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.3).toArray();p.transform.scale=[1.2,.8,1];
  const s={kind:'placement' as const,id:p.id},before=JSON.stringify(doc),start=new Vector3().setFromMatrixPosition(worldMatrix(doc,s)),state=createGeometryState(doc);
  const command=planarCommand(doc,s,.8,-.4),preview=applyGeometryCommand(state,command),next=preview.present.placements[0]!,end=new Vector3().setFromMatrixPosition(worldMatrix(preview.present,s));
  expect(end.x-start.x).toBeCloseTo(.8);expect(end.z-start.z).toBeCloseTo(-.4);expect(next.transform.position[1]).toBe(1.25);expect(next.transform.rotation).toEqual(p.transform.rotation);expect(next.transform.scale).toEqual(p.transform.scale);expect(JSON.stringify(doc)).toBe(before);expect(state.past).toHaveLength(0);expect(preview.past).toHaveLength(1);expect(undoGeometry(preview).present).toEqual(doc);
 });
 it('zero rotation never translates, and horizontal rotation keeps tilt and scale',()=>{
  const doc=fixture().present,p=doc.placements[0]!,s={kind:'placement' as const,id:p.id};p.transform.rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.2).toArray();
  const unchanged=applyGeometryCommand(createGeometryState(doc),planarCommand(doc,s,0,2,0)).present;
  expect(localPose(unchanged,s)).toEqual(p.transform);
  const rotated=applyGeometryCommand(createGeometryState(doc),planarCommand(doc,s,2,3,.4)).present.placements[0]!;
  expect(rotated.transform.position).toEqual(p.transform.position);expect(rotated.transform.rotation).toEqual(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).multiply(new Quaternion(...p.transform.rotation)).normalize().toArray());expect(rotated.transform.scale).toEqual(p.transform.scale);
 });
 it('keeps uniquely aligned art on the original wall and rejects bounds violations and ambiguous walls',()=>{
  let state=fixture();const p=state.present.placements[0]!,wall=state.present.surfaces[0]!;state=applyGeometryCommand(state,{type:'align-placement',id:p.id,surfaceId:wall.id,offset:[0,0],snap:0});const s={kind:'placement' as const,id:p.id};expect(alignedWall(state.present,s)?.id).toBe(wall.id);
  const next=applyGeometryCommand(state,planarCommand(state.present,s,.5,1));expect(alignedWall(next.present,s)?.id).toBe(wall.id);expect(next.present.placements[0]!.transform.position[1]).toBe(state.present.placements[0]!.transform.position[1]);expect(()=>applyGeometryCommand(state,planarCommand(state.present,s,100,0))).toThrow();
  const duplicate=structuredClone(state.present);duplicate.surfaces.push({...structuredClone(wall),id:crypto.randomUUID()});expect(()=>planarCommand(duplicate,s,.1,0)).toThrow('겹친 벽');
 });
 it('moves an opening along its own wall while keeping existing vertical offset',()=>{
  let state=fixture();const wall=state.present.surfaces[0]!,opening={id:crypto.randomUUID(),surfaceId:wall.id,type:'window' as const,offset:[0,.3] as [number,number],dimensions:{width:1,height:1}};state=applyGeometryCommand(state,{type:'add-opening',opening});const next=applyGeometryCommand(state,planarCommand(state.present,{kind:'opening',id:opening.id},.4,.8));expect(next.present.openings[0]!.offset).toEqual([.4,.3]);expect(state.present.openings[0]!.offset).toEqual([0,.3]);
 });
});

it('selects the visible nearest surface before an artwork behind it, using tie preference only for coincident hits',()=>{
 const wall={kind:'surface' as const,id:'wall'},art={kind:'placement' as const,id:'art'},opening={kind:'opening' as const,id:'door'};
 expect(closestEditorSelection([{distance:5,selection:art},{distance:2,selection:wall}])).toEqual(wall);
 expect(closestEditorSelection([{distance:2,selection:wall},{distance:2.000001,selection:art}])).toEqual(art);
 expect(closestEditorSelection([{distance:2,selection:wall},{distance:2,selection:opening}])).toEqual(opening);expect(closestEditorSelection([])).toBeUndefined();
});

it('resizes authored room dimensions in rotated plan space without scale or child relocation and remains one reversible command',()=>{
 const doc=fixture().present,room=doc.rooms[0]!;room.transform.rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2).toArray();
 const before=structuredClone(doc),state=createGeometryState(doc),s={kind:'room' as const,id:room.id};
 const next=applyGeometryCommand(state,planarRoomDimensionCommand(doc,s,'width',0,-.5));
 expect(next.present.rooms[0]!.dimensions).toEqual({...room.dimensions,width:room.dimensions.width+1});
 expect(next.present.rooms[0]!.transform).toEqual(room.transform);expect(next.present.surfaces).toEqual(doc.surfaces);expect(next.present.placements).toEqual(doc.placements);expect(next.past).toHaveLength(1);expect(undoGeometry(next).present).toEqual(before);expect(doc).toEqual(before);
});
it('room dimension handles preserve existing negative-size and referenced-object bounds validation',()=>{
 const doc=fixture().present,state=createGeometryState(doc),s={kind:'room' as const,id:doc.rooms[0]!.id},before=JSON.stringify(state);
 expect(()=>applyGeometryCommand(state,roomDimensionCommand(doc,s,'width',-100))).toThrow();
 expect(()=>applyGeometryCommand(state,roomDimensionCommand(doc,s,'width',-1))).toThrow();
 expect(()=>roomDimensionCommand(doc,{kind:'placement',id:doc.placements[0]!.id},'width',1)).toThrow();
 expect(JSON.stringify(state)).toBe(before);
});
