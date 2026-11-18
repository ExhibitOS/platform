// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as three from 'three';
import {ARCHITECTURAL_FINISH_NAMESPACE,applyArchitecturalFinishCommand,applyFurnishingWalkingCollisionOverride,wallFinishesFor,validateWorkspaceFurnishings} from '@exhibitos/studio-contract';
import {modularBaseboardFixture} from '../../../packages/studio-contract/test-fixtures/modular-baseboard';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {surfaceTexturePlan} from './surface-texture-renderer';
import {createNavigationController} from './viewer/navigation';
import {createPresenceGeometry} from '../../api/src/realtime-geometry';

function pairedPortal(){
 const f=modularBaseboardFixture(true);
 const document=applyArchitecturalFinishCommand(f.document,{type:'set-wall-finish',wall:{...f.settings,plainBaseboard:true}});
 return {...f,document,a:f.wall,first:f.opening};
}

test('the ordinary renderer cuts only the opted-in band outside fitted portal feet without altering the paired reveal or reserve',()=>{
 const f=pairedPortal(),before=structuredClone(f.document);
 expect(validateWorkspaceFurnishings(f.document).valid).toBe(true);
 const world=new three.Group(),surfaces=new Map<string,three.Group>(),materials=new Map<string,three.MeshStandardMaterial>();
 for(const room of f.document.rooms){
  const parent=new three.Group();parent.position.fromArray(room.transform.position);world.add(parent);
  for(const wall of f.document.surfaces.filter(s=>s.roomId===room.id)){
   const host=new three.Group();host.position.fromArray(wall.transform.position);host.quaternion.fromArray(wall.transform.rotation);parent.add(host);
   surfaces.set(wall.id,host);materials.set(wall.id,new three.MeshStandardMaterial());
  }
 }
 const installed=installArchitecturalFinishes(three,f.document,surfaces,materials);
 try{
  const mesh=installed.meshes.find(m=>m.userData.architecturalFinish.surfaceId===f.a.id&&m.userData.architecturalFinish.kind==='finish') as three.InstancedMesh;
  expect(mesh).toBeInstanceOf(three.InstancedMesh);expect(mesh.count).toBe(2);
  expect(installed.meshes.filter(m=>m.userData.architecturalFinish.kind==='finish').every(m=>m.material===mesh.material)).toBe(true);
  const matrix=new three.Matrix4(),point=new three.Vector3(),scale=new three.Vector3(),rotation=new three.Quaternion();
  for(let i=0;i<mesh.count;i++){
   mesh.getMatrixAt(i,matrix);matrix.decompose(point,rotation,scale);
   const left=point.x<f.opening.offset[0];
   expect(point.x+(left?1:-1)*scale.x/2).toBeCloseTo(f.opening.offset[0]+(left?-1:1)*(f.opening.dimensions.width/2+.04),6);
   expect(point.y-scale.y/2).toBeCloseTo(-2,6);expect(point.y+scale.y/2).toBeCloseTo(-1.96,6);
   expect(point.z).toBeGreaterThan(0);
  }
  const baseline=structuredClone(f.document),walls=wallFinishesFor(baseline);delete walls[0]!.plainBaseboard;
  baseline.extensions![ARCHITECTURAL_FINISH_NAMESPACE]={version:1,walls} as unknown as NonNullable<typeof baseline.extensions>[string];
  expect(surfaceTexturePlan(f.document,512,1).geometryReserve).toBe(surfaceTexturePlan(baseline,512,1).geometryReserve);
  expect(f.document).toEqual(before);
 }finally{installed.dispose();for(const m of materials.values())m.dispose();}
});

test.each([false,true])('Rapier and authoritative presence keep the paired doorway clear with opted-in baseboard collision=%s',async enabled=>{
 const f=pairedPortal(),document=applyFurnishingWalkingCollisionOverride(f.document,{kind:'baseboard',id:f.a.id},enabled);
 const navigation=await createNavigationController(document,{position:[0,1.65,0]}),presence=createPresenceGeometry(document);
 try{
  for(const [position,expected]of [[[.7,1.65,-3.8],true],[[2,1.65,-3.8],false]] as const){
   expect(navigation.isWalkable([...position])).toBe(expected);
   expect(presence.valid({roomId:f.room.id,position:[...position],yaw:0})).toBe(expected);
  }
 }finally{navigation.dispose();}
});
