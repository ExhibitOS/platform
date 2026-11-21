// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {architecturalSolids,architecturalWallBoxes,ARCHITECTURAL_FINISH_NAMESPACE,PAIRED_WALL_STRUCTURE_NAMESPACE,wallFinishesFor} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {newDoor} from './geometry/model';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {pairedOpeningRevealCoverage,wallOpeningShell} from './wall-opening-shell';
import {surfaceTexturePlan} from './surface-texture-renderer';
import {createNavigationController} from './viewer/navigation';

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
it.each([['painted-edge','plain'],['plain','painted-edge'],['dark-edge','painted-edge']] as const)('preserves exterior %s / %s finishes while removing only buried trim from the common reveal',(...presets)=>{
 const f=fixture(),walls=wallFinishesFor(f.document);walls.forEach((w,i)=>{w.preset=presets[i]!;});f.document.extensions![ARCHITECTURAL_FINISH_NAMESPACE]={version:1,walls:walls.map(w=>({...w}))};
 const input=JSON.stringify(f.document),physical=JSON.stringify(architecturalSolids(f.document)),result=installArchitecturalFinishes(three,f.document,f.surfaces,f.materials);f.world.updateMatrixWorld(true);
 try{
  for(const offset of [-.051,0,.051]){const hits=new three.Raycaster(new three.Vector3(0,1.5,-4+offset),new three.Vector3(-1,0,0)).intersectObjects(result.meshes,false).filter(h=>Math.abs(h.distance-1.2)<1e-6);expect(new Set(hits.map(h=>h.object.uuid)).size).toBe(1);}
  for(const wall of walls.filter(w=>w.preset!=='plain')){
   const surface=f.document.surfaces.find(s=>s.id===wall.surfaceId)!,expected=architecturalWallBoxes(surface,f.document.openings,wall).filter(b=>b.kind==='finish'&&b.position[2]>0).map(b=>new three.Matrix4().compose(new three.Vector3(...b.position),new three.Quaternion(),new three.Vector3(b.dimensions.width,b.dimensions.height,b.dimensions.depth)).elements.map(Math.fround));
   const mesh=result.meshes.find(m=>m.userData.architecturalFinish.surfaceId===surface.id&&m.userData.architecturalFinish.kind==='finish')!;expect(mesh).toBeInstanceOf(three.InstancedMesh);const instances=mesh as three.InstancedMesh,front:number[][]=[];
   for(let i=0;i<instances.count;i++){const m=new three.Matrix4();instances.getMatrixAt(i,m);if(m.elements[14]!>0)front.push(m.elements);}expect(front).toEqual(expected);
  }
  const bounds=new three.Box3().setFromObject(f.world),points=architecturalSolids(f.document).flatMap(s=>s.vertices);for(const axis of [0,1,2]){expect(bounds.min.getComponent(axis)).toBeCloseTo(Math.min(...points.map(p=>p[axis]!)),6);expect(bounds.max.getComponent(axis)).toBeCloseTo(Math.max(...points.map(p=>p[axis]!)),6);}
  expect(JSON.stringify(f.document)).toBe(input);expect(JSON.stringify(architecturalSolids(f.document))).toBe(physical);
 }finally{result.dispose();for(const m of f.materials.values())m.dispose();}
});
it('uses the one-sided structural extent for both reveal faces and walking collision',async()=>{
 const {document,a,b,first,second,world,surfaces,materials}=fixture();
 const walls=wallFinishesFor(document);
 walls[1]!.preset='painted-edge';
 document.extensions![ARCHITECTURAL_FINISH_NAMESPACE]={version:1,walls:walls.map(wall=>({...wall}))};
 const trimMatrices=(meshes:three.Mesh[])=>{
  const trim=meshes.find(mesh=>mesh.userData.architecturalFinish.surfaceId===b.id&&mesh.userData.architecturalFinish.kind==='finish') as three.InstancedMesh;
  return Array.from({length:trim.count},(_,index)=>{
   const matrix=new three.Matrix4();
   trim.getMatrixAt(index,matrix);
   return matrix.toArray();
  });
 };
 const baseline=installArchitecturalFinishes(three,document,surfaces,materials);
 const originalTrim=trimMatrices(baseline.meshes);
 baseline.dispose();
 document.extensions!['org.exhibitos.studio/paired-wall-structure']={version:1,pairs:[{
  openingId:first.id,peerOpeningId:second.id,side:'positive-normal',extensionMeters:.11,
 }]};
 // Resolve coverage with the extended wall as the peer to exercise inverted Z.
 document.openings.reverse();
 const result=installArchitecturalFinishes(three,document,surfaces,materials);
 world.updateMatrixWorld(true);
 try{
  const structures=result.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='structure');
  const bounds=new three.Box3().setFromObject(structures.find(mesh=>mesh.userData.architecturalFinish.surfaceId===a.id)!);
  expect(bounds.min.z).toBeCloseTo(-4.07,6);
  expect(bounds.max.z).toBeCloseTo(-3.82,6);
  const solidPoints=architecturalSolids(document).filter(solid=>solid.kind==='structure').flatMap(solid=>solid.vertices);
  expect(Math.min(...solidPoints.map(point=>point[2]))).toBeCloseTo(bounds.min.z,6);
  expect(Math.max(...solidPoints.map(point=>point[2]))).toBeCloseTo(bounds.max.z,6);
  expect(trimMatrices(result.meshes)).toEqual(originalTrim);
  for(const z of [-4.06,-3.99,-3.94,-3.83]){
   for(const [direction,distance] of [[new three.Vector3(-1,0,0),1.3],[new three.Vector3(0,1,0),1.6]] as const){
    const hits=new three.Raycaster(new three.Vector3(.1,1.4,z),direction).intersectObjects(structures,false)
     .filter(hit=>Math.abs(hit.distance-distance)<1e-6);
    expect(new Set(hits.map(hit=>hit.object.userData.architecturalFinish.surfaceId))).toEqual(new Set([a.id]));
   }
  }
  const navigation=await createNavigationController(document,{position:[0,1.6,-3]});
  try{
   for(const [z,endZ,yaw,roomId] of [[-3,-4.35,0,b.roomId],[-5,-3.55,Math.PI,a.roomId]] as const){
    navigation.reset({position:[0,1.6,z],yaw});
    const direction=Math.sign(endZ-z);
    for(let i=0;i<100;i++){
     const state=navigation.advance(1/60,{forward:1,right:0,yaw});
     expect(state.blocked||state.recovered,`yaw ${yaw}, frame ${i}, eye ${state.eyePosition}`).toBe(false);
     if((state.eyePosition[2]-endZ)*direction>=0)break;
    }
    const state=navigation.state();
    expect((state.eyePosition[2]-endZ)*direction).toBeGreaterThanOrEqual(0);
    expect(state.roomId).toBe(roomId);
    expect(state.grounded).toBe(true);
   }
  }finally{navigation.dispose();}
 }finally{
  result.dispose();
  for(const material of materials.values())material.dispose();
 }
});
it.each([false,true])('applies the existing painted-edge finish only to the opted-in jambs and head (reverse=%s)',reverse=>{
 const {document,a,b,first,second,world,surfaces,materials}=fixture();
 const walls=wallFinishesFor(document);
 walls[0]!.preset='painted-edge';
 document.extensions![ARCHITECTURAL_FINISH_NAMESPACE]={version:1,walls:walls.map(wall=>({...wall}))};
 const extent={openingId:second.id,peerOpeningId:first.id,side:'positive-normal',extensionMeters:.11};
 document.extensions![PAIRED_WALL_STRUCTURE_NAMESPACE]={version:1,pairs:[extent]};
 if(reverse)document.openings.reverse();
 const bindings=new Map([[a.id,{repeatMeters:[2,3] as [number,number],rotation:0}]]);
 const original=installArchitecturalFinishes(three,document,surfaces,materials,bindings);
 const solids=JSON.stringify(architecturalSolids(document));
 document.extensions![PAIRED_WALL_STRUCTURE_NAMESPACE]={version:1,pairs:[{...extent,revealFinish:'painted-edge'}]};
 const result=installArchitecturalFinishes(three,document,surfaces,materials,bindings);
 const materialAt=(hit:three.Intersection)=>{
  const {material}=hit.object as three.Mesh;
  return Array.isArray(material)?material[hit.face!.materialIndex]:material;
 };
 try{
  world.updateMatrixWorld(true);
  expect(JSON.stringify(architecturalSolids(document))).toBe(solids);
  expect(result.records).toEqual(original.records);
  expect(result.meshes).toHaveLength(original.meshes.length);
  expect(original.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='structure').every(mesh=>mesh.geometry.groups.length===0)).toBe(true);
  const triangles=(mesh:three.Mesh)=>{
   const indices=Array.from(mesh.geometry.index!.array);
   return Array.from({length:indices.length/3},(_,i)=>indices.slice(i*3,i*3+3).join(',')).sort();
  };
  for(const [i,mesh] of result.meshes.entries()){
   expect(mesh.geometry.getAttribute('position').array).toEqual(original.meshes[i]!.geometry.getAttribute('position').array);
   expect(triangles(mesh)).toEqual(triangles(original.meshes[i]!));
  }
  const trim=result.meshes.find(mesh=>mesh.userData.architecturalFinish.kind==='finish')!.material;
  const structures=result.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='structure');
  for(const z of [-3.931,-4,-4.179]){
   const eye=new three.Vector3(0,1.5,z);
   for(const [direction,distance] of [[new three.Vector3(-1,0,0),1.2],[new three.Vector3(1,0,0),1.2],[new three.Vector3(0,1,0),1.5]] as const){
    const hits=new three.Raycaster(eye,direction).intersectObjects(structures).filter(hit=>Math.abs(hit.distance-distance)<1e-6);
    expect(new Set(hits.map(hit=>hit.object.uuid)).size).toBe(1);
    expect(hits.every(hit=>materialAt(hit)===trim)).toBe(true);
   }
   expect(new three.Raycaster(eye,new three.Vector3(0,-1,0)).intersectObjects(result.meshes)).toEqual([]);
  }
  const plainFace=new three.Raycaster(new three.Vector3(1.21,1.5,-5),new three.Vector3(0,0,1)).intersectObjects(structures)[0]!;
  expect(materialAt(plainFace)).toBe(materials.get(b.id));
 }finally{original.dispose();result.dispose();for(const material of materials.values())material.dispose();}
});
it.each(['unpaired','oneway','width','height','shift','tilt','disjoint','unstyled','multiple'])('leaves %s geometry on its original safe path',kind=>{
 const f=fixture();if(kind==='unpaired')delete f.first.connectsToOpeningId;if(kind==='oneway')delete f.second.connectsToOpeningId;if(kind==='width')f.second.dimensions.width=2;if(kind==='height')f.second.dimensions.height=2.5;if(kind==='shift')f.second.offset[0]=.1;if(kind==='tilt')f.surfaces.get(f.b.id)!.rotation.x=.1;if(kind==='disjoint')f.surfaces.get(f.b.id)!.position.z=3.7;
 if(kind==='multiple')f.document.openings.push(newDoor(f.a.id,{width:.8,height:2},[2.5,-1]));
 const walls=wallFinishesFor(f.document);if(kind==='unstyled')walls.pop();expect(pairedOpeningRevealCoverage(three,f.document,f.surfaces,walls).size).toBe(0);for(const material of f.materials.values())material.dispose();
});
