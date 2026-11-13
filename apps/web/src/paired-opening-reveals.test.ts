// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {architecturalSolids,architecturalWallBoxes,ARCHITECTURAL_FINISH_NAMESPACE,wallFinishesFor} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {newDoor} from './geometry/model';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {pairedOpeningRevealCoverage,wallOpeningShell} from './wall-opening-shell';
import {surfaceTexturePlan} from './surface-texture-renderer';

function fixture(){
 const document=newDraft().candidate,room=document.rooms[0]!;room.dimensions={width:8,height:4,depth:8};room.transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
 const other=structuredClone(room);other.id=crypto.randomUUID();other.transform.position=[0,0,-8];document.rooms=[room,other];document.placements=[];document.artworks=[];
 const a={id:crypto.randomUUID(),roomId:room.id,type:'wall' as const,dimensions:{width:8,height:4},transform:{position:[0,2,-3.99] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]}},b={...structuredClone(a),id:crypto.randomUUID(),roomId:other.id};b.transform.position=[0,2,3.99];b.transform.rotation=[0,1,0,0];document.surfaces=[a,b];
 const first=newDoor(a.id,{width:2.4,height:3},[0,-.5]),second=newDoor(b.id,{width:2.4,height:3},[0,-.5]);first.connectsToOpeningId=second.id;second.connectsToOpeningId=first.id;document.openings=[first,second];
 document.extensions={...document.extensions,[ARCHITECTURAL_FINISH_NAMESPACE]:{version:1,walls:[a,b].map(w=>({surfaceId:w.id,depth:.12,preset:'plain',trimWidth:.02,ceilingBand:false,baseboardHeight:.04}))}};
 const world=new three.Group(),surfaces=new Map<string,three.Group>(),materials=new Map<string,three.MeshStandardMaterial>();
 for(const room of document.rooms){const parent=new three.Group();parent.position.fromArray(room.transform.position);parent.quaternion.fromArray(room.transform.rotation);parent.scale.fromArray(room.transform.scale);world.add(parent);for(const surface of document.surfaces.filter(s=>s.roomId===room.id)){const group=new three.Group();group.position.fromArray(surface.transform.position);group.quaternion.fromArray(surface.transform.rotation);group.scale.fromArray(surface.transform.scale);parent.add(group);surfaces.set(surface.id,group);materials.set(surface.id,new three.MeshStandardMaterial({side:three.DoubleSide}));}}
 return {document,a,b,first,second,world,surfaces,materials};
}
it.each([false,true])('draws each connected reveal once across the entire depth union; preserves exterior panels, metre UVs, physical hulls and budget (reversed=%s)',reverse=>{
 const f=fixture();if(reverse){f.document.openings.reverse();(f.document.extensions![ARCHITECTURAL_FINISH_NAMESPACE] as unknown as {walls:unknown[]}).walls.reverse();}
 const input=JSON.stringify(f.document),physical=JSON.stringify(architecturalSolids(f.document)),walls=wallFinishesFor(f.document),binding={repeatMeters:[2,4] as [number,number],rotation:0},targets=new Map([f.a,f.b].map(s=>[s.id,binding])),budget=surfaceTexturePlan(f.document,512,32*1024*1024,targets);
 const result=installArchitecturalFinishes(three,f.document,f.surfaces,f.materials,targets);f.world.updateMatrixWorld(true);
 try{
  expect(result.meshes).toHaveLength(2);const meshes=result.meshes;
  for(const offset of [-.069,-.055,-.035,-.015,0,.015,.035,.055,.069]){
   for(const [direction,distance]of [[new three.Vector3(-1,0,0),1.2],[new three.Vector3(0,1,0),1.5]] as const){const hits=new three.Raycaster(new three.Vector3(0,1.5,-4+offset),direction).intersectObjects(meshes,false).filter(h=>Math.abs(h.distance-distance)<1e-6);expect(new Set(hits.map(h=>h.object.userData.architecturalFinish.surfaceId)).size).toBe(1);expect(hits.every(h=>h.object.userData.architecturalFinish.surfaceId===f.a.id)).toBe(true);}
  }
  expect(new three.Raycaster(new three.Vector3(0,1.5,-3),new three.Vector3(0,0,-1)).intersectObjects(meshes,false)).toEqual([]);
  let resident=0;
  for(const mesh of meshes){const surface=f.document.surfaces.find(s=>s.id===mesh.userData.architecturalFinish.surfaceId)!,wall=walls.find(w=>w.surfaceId===surface.id)!,original=wallOpeningShell(three,architecturalWallBoxes(surface,f.document.openings,wall)),p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal'),uv=mesh.geometry.getAttribute('uv');
   const exterior=(g:three.BufferGeometry)=>{const p=g.getAttribute('position'),n=g.getAttribute('normal');return Array.from({length:p.count},(_,i)=>i).filter(i=>Math.abs(n.getZ(i))>.5).map(i=>[p.getX(i),p.getY(i),p.getZ(i),n.getZ(i)]);};expect(exterior(mesh.geometry)).toEqual(exterior(original));original.dispose();
   expect(mesh.material).toBe(f.materials.get(surface.id));for(let i=0;i<p.count;i++){expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1);expect(uv.getX(i)).toBeCloseTo((Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/2);expect(uv.getY(i)).toBeCloseTo((Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/4);}
   resident+=2*(p.count*32+mesh.geometry.index!.count*4);
  }
  expect(resident).toBeLessThanOrEqual(budget.geometryReserve);const bounds=new three.Box3().setFromObject(f.world),points=architecturalSolids(f.document).flatMap(s=>s.vertices);for(const axis of [0,1,2]){expect(bounds.min.getComponent(axis)).toBeCloseTo(Math.min(...points.map(p=>p[axis]!)),6);expect(bounds.max.getComponent(axis)).toBeCloseTo(Math.max(...points.map(p=>p[axis]!)),6);}
  expect(JSON.stringify(f.document)).toBe(input);expect(JSON.stringify(architecturalSolids(f.document))).toBe(physical);
 }finally{result.dispose();for(const material of f.materials.values())material.dispose();}
});
it.each(['unpaired','oneway','width','height','shift','tilt','disjoint','unstyled'])('leaves %s geometry on its original safe path',kind=>{
 const f=fixture();if(kind==='unpaired')delete f.first.connectsToOpeningId;if(kind==='oneway')delete f.second.connectsToOpeningId;if(kind==='width')f.second.dimensions.width=2;if(kind==='height')f.second.dimensions.height=2.5;if(kind==='shift')f.second.offset[0]=.1;if(kind==='tilt')f.surfaces.get(f.b.id)!.rotation.x=.1;if(kind==='disjoint')f.surfaces.get(f.b.id)!.position.z=3.7;
 const walls=wallFinishesFor(f.document);if(kind==='unstyled')walls.pop();expect(pairedOpeningRevealCoverage(three,f.document,f.surfaces,walls).size).toBe(0);for(const material of f.materials.values())material.dispose();
});
