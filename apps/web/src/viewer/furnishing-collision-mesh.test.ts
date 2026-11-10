// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as Three from 'three';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {furnishingCollisionMesh,mountedFurnishingCollision} from './furnishing-collision-mesh';
import {createNavigationController} from './navigation';

test('mounted furniture blocks its two spans, leaves the opening and ends clear, and stops colliding when hidden',async()=>{
 const draft=newDraft(),state=createGeometryState(draft.candidate);
 const document=applyGeometryCommand(state,{type:'white-cube',roomId:state.present.rooms[0]!.id}).present;
 const root=new Three.Group(),geometry=new Three.BoxGeometry(.8,1,.12),material=new Three.MeshBasicMaterial();
 for(const x of [-.9,.9]){
  const segment=new Three.Mesh(geometry,material);segment.position.set(x,.5,0);root.add(segment);
 }
 const mesh=furnishingCollisionMesh(Three,root);
 expect(mesh).toBeDefined();
 const navigation=await createNavigationController(document,{position:[0,1.65,2]});
 const canCross=(x:number)=>navigation.standingSegmentClear(navigation.qualifiedStandingEye([x,1.65,1])!,navigation.qualifiedStandingEye([x,1.65,-1])!);
 let visible=true;
 try{
  expect(canCross(.9)).toBe(true);
  navigation.setFurnishingCollisions([{id:'barrier',mesh:mesh!,active:()=>visible}]);
  expect(canCross(-.9)).toBe(false);
  expect(canCross(.9)).toBe(false);
  expect(canCross(0)).toBe(true);
  expect(canCross(1.9)).toBe(true);
  visible=false;
  expect(canCross(.9)).toBe(true);
  visible=true;
  expect(canCross(.9)).toBe(false);
  navigation.setFurnishingCollisions([]);
  expect(canCross(.9)).toBe(true);
 }finally{navigation.dispose();geometry.dispose();material.dispose();}
});

test('replacing a visible fixture on one host removes its old collision geometry',async()=>{
 const draft=newDraft(),state=createGeometryState(draft.candidate);
 const document=applyGeometryCommand(state,{type:'white-cube',roomId:state.present.rooms[0]!.id}).present;
 const room=new Three.Group(),geometry=new Three.BoxGeometry(.6,1,.12),material=new Three.MeshBasicMaterial();
 const fallback=new Three.Mesh(geometry,material),replacement=new Three.Mesh(geometry,material);
 fallback.position.set(-.9,.5,0);replacement.position.set(.9,.5,0);room.add(fallback,replacement);
 const old=mountedFurnishingCollision(Three,'light:host',fallback,()=>false)!;
 const next=mountedFurnishingCollision(Three,'light:host',replacement,()=>false)!;
 const navigation=await createNavigationController(document,{position:[0,1.65,2],furnishingCollisions:[old]});
 const canCross=(x:number)=>navigation.standingSegmentClear(navigation.qualifiedStandingEye([x,1.65,1])!,navigation.qualifiedStandingEye([x,1.65,-1])!);
 try{
  expect(canCross(-.9)).toBe(false);
  expect(canCross(.9)).toBe(true);
  navigation.setFurnishingCollisions([next]);
  expect(canCross(-.9)).toBe(true);
  expect(canCross(.9)).toBe(false);
  room.visible=false;
  expect(canCross(.9)).toBe(true);
 }finally{navigation.dispose();geometry.dispose();material.dispose();}
});
