import {expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import * as Three from 'three';
import {newDraft} from './drafts/example';
import {whiteCubeSurfaces,newDoor,newRoom} from './geometry/model';
import {applyArchitecturalFinishCommand,architecturalSolids,ARCHITECTURAL_FINISH_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {ModularPortalFit,ModularPortalRole} from '@exhibitos/spec/workspace-fit-models';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {biasPairedPortalWalls} from './workspace-furnishing/portal-pose';
import {surfaceTexturePlan} from './surface-texture-renderer';
import {createNavigationController} from './viewer/navigation';
import {createPresenceGeometry} from '../../api/src/realtime-geometry';
import {validateWorkspaceFurnishingGlb} from '../../api/src/workspace-furnishing-glb';
import {openRoomIndirectPairedShell} from './viewer/room-indirect-paired-shell';
function fixture(){let d=newDraft().candidate;d.surfaces=whiteCubeSurfaces(d.rooms[0]!);const wall=d.surfaces[0]!;d.openings=[newDoor(wall.id,{width:2.4,height:3},[0,-.5])];d=applyArchitecturalFinishCommand(d,{type:'set-wall-finish',wall:{surfaceId:wall.id,depth:.12,preset:'dark-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:true}});return {d,wall};}
test('finish pooled rendering matches world hulls once and disposes owned buffers without borrowed material',()=>{
 const {d,wall}=fixture(),room=new Three.Group(),parent=new Three.Group(),base=new Three.MeshStandardMaterial();room.position.fromArray(d.rooms[0]!.transform.position);parent.position.fromArray(wall.transform.position);parent.quaternion.fromArray(wall.transform.rotation);room.add(parent);const borrowed=vi.spyOn(base,'dispose');const r=installArchitecturalFinishes(Three,d,new Map([[wall.id.toLowerCase(),parent]]),new Map([[wall.id.toLowerCase(),base]]));expect(r.meshes).toHaveLength(2);expect(r.meshes[0]).not.toBeInstanceOf(Three.InstancedMesh);expect(r.meshes[1]).toBeInstanceOf(Three.InstancedMesh);room.updateMatrixWorld(true);
 const worldBounds=new Three.Box3().setFromObject(room),points=architecturalSolids(d).flatMap(s=>s.vertices);for(const axis of [0,1,2]){expect(worldBounds.min.getComponent(axis)).toBeCloseTo(Math.min(...points.map(p=>p[axis]!)),6);expect(worldBounds.max.getComponent(axis)).toBeCloseTo(Math.max(...points.map(p=>p[axis]!)),6);}
 const geometries=r.meshes.map(m=>vi.spyOn(m.geometry,'dispose'));r.dispose();r.dispose();for(const geometry of geometries)expect(geometry).toHaveBeenCalledOnce();expect(borrowed).not.toHaveBeenCalled();expect(parent.children).toHaveLength(0);base.dispose();
});
test('plain baseboard opt-in renders only the lower band and retains structural texture reserves and borrowed paint',()=>{
 const {d:before,wall}=fixture();
 const settings={surfaceId:wall.id,depth:.12,preset:'plain' as const,trimWidth:.04,baseboardHeight:.04,ceilingBand:false};
 const plain=applyArchitecturalFinishCommand(before,{type:'set-wall-finish',wall:settings});
 const opted=applyArchitecturalFinishCommand(plain,{type:'set-wall-finish',wall:{...settings,plainBaseboard:true}});
 const parent=new Three.Group(),base=new Three.MeshStandardMaterial();
 const borrowed=vi.spyOn(base,'dispose');
 const legacy=installArchitecturalFinishes(Three,plain,new Map([[wall.id,parent]]),new Map([[wall.id,base]]));
 expect(legacy.meshes.every(mesh=>mesh.userData.architecturalFinish.kind==='structure')).toBe(true);
 const structural=Array.from(legacy.meshes[0]!.geometry.getAttribute('position').array);legacy.dispose();
 const result=installArchitecturalFinishes(Three,opted,new Map([[wall.id,parent]]),new Map([[wall.id,base]]));
 try{
  const structure=result.meshes.find(mesh=>mesh.userData.architecturalFinish.kind==='structure')!;
  expect(Array.from(structure.geometry.getAttribute('position').array)).toEqual(structural);
  const finish=result.meshes.find(mesh=>mesh.userData.architecturalFinish.kind==='finish') as Three.InstancedMesh;
  expect(finish).toBeInstanceOf(Three.InstancedMesh);expect(finish.count).toBe(4);
  const matrix=new Three.Matrix4(),position=new Three.Vector3(),rotation=new Three.Quaternion(),scale=new Three.Vector3();
  for(let i=0;i<finish.count;i++){
   finish.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
   expect(position.y-scale.y/2).toBeCloseTo(-wall.dimensions.height/2,6);
   expect(position.y+scale.y/2).toBeCloseTo(-wall.dimensions.height/2+.04,6);
   expect(scale.z).toBeCloseTo(.002,6);
   expect(Math.abs(position.x)-scale.x/2).toBeGreaterThanOrEqual(1.2-1e-6);
  }
  expect(structure.material).toBe(base);
  expect(surfaceTexturePlan(opted,512,1).geometryReserve).toBe(surfaceTexturePlan(plain,512,1).geometryReserve);
 }finally{result.dispose();}
 expect(borrowed).not.toHaveBeenCalled();expect(parent.children).toHaveLength(0);base.dispose();
});
test('finish actual Rapier and server presence agree on wall thickness while retaining clear door width',async()=>{
 const {d}=fixture(),c=await createNavigationController(d,{position:[0,1.65,0]}),presence=createPresenceGeometry(d),roomId=d.rooms[0]!.id;try{
  expect(c.isWalkable([3,1.65,-3.72])).toBe(false);expect(presence.valid({roomId,position:[3,1.65,-3.72],yaw:0})).toBe(false);
  expect(c.isWalkable([0,1.65,-3.72])).toBe(true);expect(presence.valid({roomId,position:[0,1.65,-3.72],yaw:0})).toBe(true);expect(c.isWalkable([1.1,1.65,-3.72])).toBe(false);
 }finally{c.dispose();}
 const legacy=structuredClone(d);delete legacy.extensions![ARCHITECTURAL_FINISH_NAMESPACE];const baseline=await createNavigationController(legacy,{position:[0,1.65,0]});try{expect(baseline.isWalkable([0,1.65,-3.9])).toBe(false);expect(baseline.isWalkable([3,1.65,-3.72])).toBe(true);}finally{baseline.dispose();}
});

test('opening shell joins the front panels at the head and omits the internal jamb faces above it',()=>{
 const {d,wall}=fixture(),parent=new Three.Group(),material=new Three.MeshStandardMaterial();
 const result=installArchitecturalFinishes(Three,d,new Map([[wall.id,parent]]),new Map([[wall.id,material]]));
 try{
  const mesh=result.meshes[0]!,geometry=mesh.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),indices=geometry.index!;
  const scalarPlan=surfaceTexturePlan(d,512,1);
  expect(scalarPlan.geometryReserve).toBe(2*(p.count*24+indices.count*4));
  expect(scalarPlan.reserveBytes).toBe(scalarPlan.geometryReserve);
  expect(scalarPlan.packs).toEqual([]);
  const jamb=Math.fround(-1.2),head=1;
  const front=(x:number,y:number)=>Array.from({length:p.count},(_,i)=>i).filter(i=>p.getX(i)===x&&p.getY(i)===y&&n.getZ(i)===1);
  expect(front(jamb,head)).toHaveLength(1);
  expect(front(jamb,2)).toHaveLength(1);
  const edge=[front(jamb,head)[0]!,front(jamb,2)[0]!];
  const faces=Array.from({length:indices.count/3},(_,i)=>[0,1,2].map(j=>indices.getX(i*3+j)));
  expect(faces.filter(face=>edge.every(i=>face.includes(i)))).toHaveLength(2);
  expect(faces.some(face=>face.every(i=>p.getX(i)===jamb&&p.getY(i)>=head&&Math.abs(n.getX(i))===1))).toBe(false);
  expect(faces.some(face=>face.every(i=>p.getX(i)===jamb&&p.getY(i)<=head&&Math.abs(n.getX(i))===1))).toBe(true);
  mesh.updateMatrixWorld(true);
  const ray=(y:number)=>new Three.Raycaster(new Three.Vector3(0,y,2),new Three.Vector3(0,0,-1)).intersectObject(mesh);
  expect(ray(0)).toHaveLength(0);expect(ray(1.5).length).toBeGreaterThan(0);
 }finally{result.dispose();material.dispose();}
});
test('workspace wall texture uses metre UVs on the owned structure and reserves its geometry',()=>{
 const {d,wall}=fixture(),parent=new Three.Group(),material=new Three.MeshStandardMaterial(),binding={repeatMeters:[2,4] as [number,number],rotation:0},targets=new Map([[wall.id.toLowerCase(),binding]]),plan=surfaceTexturePlan(d,512,32*1024*1024,targets);
 const result=installArchitecturalFinishes(Three,d,new Map([[wall.id.toLowerCase(),parent]]),new Map([[wall.id.toLowerCase(),material]]),targets);
 try{const mesh=result.meshes[0]!,geometry=mesh.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');expect(mesh.material).toBe(material);expect(mesh).not.toBeInstanceOf(Three.InstancedMesh);expect(plan.geometryReserve).toBeGreaterThan(0);for(let i=0;i<p.count;i++)if(Math.abs(n.getZ(i))>.5){expect(uv.getX(i)).toBeCloseTo(p.getX(i)/2);expect(uv.getY(i)).toBeCloseTo(p.getY(i)/4);}}
 finally{result.dispose();material.dispose();}
});


test('paired portal depth bias covers its finish without changing shared unrelated trim or geometry',()=>{
 const {d:initial,wall}=fixture();let d=initial;const unrelated=d.surfaces[1]!;
 d=applyArchitecturalFinishCommand(d,{type:'set-wall-finish',wall:{surfaceId:unrelated.id,depth:.12,preset:'dark-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:false}});
 const room=new Three.Group(),host=new Three.Group(),other=new Three.Group();room.add(host,other);
 const base=new Three.MeshStandardMaterial(),otherBase=new Three.MeshStandardMaterial();
 const installed=installArchitecturalFinishes(Three,d,new Map([[wall.id,host],[unrelated.id,other]]),new Map([[wall.id,base],[unrelated.id,otherBase]]));
 const finish=installed.meshes.find(m=>m.userData.architecturalFinish.surfaceId===wall.id&&m.userData.architecturalFinish.kind==='finish')!,
  otherFinish=installed.meshes.find(m=>m.userData.architecturalFinish.surfaceId===unrelated.id&&m.userData.architecturalFinish.kind==='finish')!;
 const original=finish.material as Three.MeshStandardMaterial,originalState=original.toJSON(),geometry=finish.geometry,
  positions=Array.from(geometry.getAttribute('position').array),instances=Array.from((finish as Three.InstancedMesh).instanceMatrix.array);
 expect(otherFinish.material).toBe(original);const originalDispose=vi.spyOn(original,'dispose');
 const release=biasPairedPortalWalls(Three,room,new Set([wall.id])),second=biasPairedPortalWalls(Three,room,new Set([wall.id]));
 const biased=finish.material as Three.MeshStandardMaterial,biasedDispose=vi.spyOn(biased,'dispose');
 try{
  expect(biased).not.toBe(original);expect(biased).toMatchObject({polygonOffset:true,polygonOffsetFactor:3,polygonOffsetUnits:6});
  expect(biased.color.equals(original.color)).toBe(true);expect(biased.roughness).toBe(original.roughness);expect(biased.metalness).toBe(original.metalness);
  expect(otherFinish.material).toBe(original);expect(original.toJSON()).toEqual(originalState);
  expect(finish.geometry).toBe(geometry);expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions);
  expect(Array.from((finish as Three.InstancedMesh).instanceMatrix.array)).toEqual(instances);
  release();release();expect(finish.material).toBe(biased);expect(biasedDispose).not.toHaveBeenCalled();
  second();expect(finish.material).toBe(original);expect(biasedDispose).toHaveBeenCalledOnce();expect(originalDispose).not.toHaveBeenCalled();
 }finally{release();second();installed.dispose();base.dispose();otherBase.dispose();}
});


test.each([{name:'equal walls',full:false},{name:'approved 10/11 m walls',full:true}])(
 'coincident modular portal retains exposed wall faces and paint on $name',async({full})=>{
 const d=newDraft().candidate,dimensions={width:4,height:4,depth:4};
 const host=newRoom('Plain',full?{width:10,height:4,depth:10}:dimensions,
  {position:full?[13,0,-7]:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
 const peer=newRoom('Painted',full?{width:11,height:4,depth:4}:dimensions,
  {position:full?[7.5,0,0]:[0,0,-4],rotation:[0,0,0,1],scale:[1,1,1]});
 d.rooms=[host,peer];d.lights=[];
 const a=whiteCubeSurfaces(host),b=whiteCubeSurfaces(peer),walls=full?[a[1]!,b[0]!]:[a[0]!,b[1]!];
 d.surfaces=[...a,...b];
 const openings=walls.map((wall,i)=>newDoor(wall.id,{width:2.4,height:3},[full?(i===0?2:3.5):0,-.5]));
 for(const [i,opening] of openings.entries()){
  delete opening.exterior;opening.connectsToOpeningId=openings[1-i]!.id;
 }
 d.openings=openings;
 const finishes=walls.map((wall,i)=>({surfaceId:wall.id,depth:.12,preset:i?'painted-edge':'plain',trimWidth:.04,baseboardHeight:.04,ceilingBand:false}));
 const sha='385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b';
 const parts={} as ModularPortalFit['parts'];
 for(const face of ['front','back','reveal'] as const)for(const side of ['left','right','head'] as const){
  const thick=face==='reveal'?.025:.04;
  const [minX,maxX]=side==='left'?[-1.2-thick,-1.2]:side==='right'?[1.2,1.2+thick]:[-1.2-thick,1.2+thick];
  const [minZ,maxZ]=face==='front'?[.1,.106]:face==='back'?[-.106,-.1]:[-.1,.1];
  const role:ModularPortalRole=`${face}-${side}`;
  parts[role]={node:Object.keys(parts).length,min:[minX,side==='head'?2.6:0,minZ],max:[maxX,side==='head'?2.6+thick:2.6,maxZ]};
 }
 const id=crypto.randomUUID();
 d.extensions={...d.extensions,
  [ARCHITECTURAL_FINISH_NAMESPACE]:{version:1,walls:finishes},
  [WORKSPACE_FURNISHING_NAMESPACE]:{version:11,furnishings:[{id,kind:'portal-finish',name:'Modular portal',version:1,provenance:'Measured fixture',
   model:{mime:'model/gltf-binary',sha256:sha,bytes:164044},
   fit:{version:1,sourceSha256:sha,sourceBytes:164044,geometry:{profile:'modular-portal-v1',openingWidth:2.4,openingHeight:2.6,minZ:-.1,maxZ:.1,parts}},
   rights:{holder:'Synthetic',licenseId:'CC0-1.0',ownership:'owner',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}}},
  ],placements:[],frameAttachments:[],ceilingAttachments:[],openingAttachments:[{openingId:openings[0]!.id,furnishingId:id,furnishingVersion:1,modelSha256:sha}]},
 } as typeof d.extensions;
 const root=new Three.Group(),parents=new Map<string,Three.Group>(),bases=new Map<string,Three.MeshStandardMaterial>();
 for(const [i,wall] of walls.entries()){
  const roomRoot=new Three.Group(),wallRoot=new Three.Group();
  roomRoot.position.fromArray(d.rooms[i]!.transform.position);
  wallRoot.position.fromArray(wall.transform.position);wallRoot.quaternion.fromArray(wall.transform.rotation);
  root.add(roomRoot);roomRoot.add(wallRoot);parents.set(wall.id,wallRoot);bases.set(wall.id,new Three.MeshStandardMaterial());
 }
 const collisionGeometry=()=>architecturalSolids(d).map(({surfaceId,roomId,kind,vertices,indices})=>({surfaceId,roomId,kind,vertices,indices}));
 const before=structuredClone(d),solids=collisionGeometry(),results=installArchitecturalFinishes(Three,d,parents,bases);
 try{
  expect(collisionGeometry()).toEqual(solids);
  expect(d).toEqual(before);
  const structures=results.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='structure');
  expect(structures).toHaveLength(2);
  let revealOwners=0;
  for(const [side,mesh] of structures.entries()){
   const g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal');
   const points=Array.from({length:p.count},(_,i)=>({x:p.getX(i),nx:n.getX(i),nz:n.getZ(i)}));
   expect(points.some(point=>point.nz===1)).toBe(true);
   const rear=points.filter(point=>point.nz===-1).map(point=>point.x);
   if(full){
    const [min,max]=side===0?[-5,0]:[-5.5,.5];
    expect(Math.min(...rear)).toBe(min);expect(Math.max(...rear)).toBe(max);
    expect(points.some(point=>point.nx!==0&&point.x===(side===0?5:5.5))).toBe(false);
   }else expect(rear).toEqual([]);
   if(points.some(point=>point.nx!==0&&point.x===Math.fround(openings[side]!.offset[0]-1.2)))revealOwners++;
  }
  expect(revealOwners).toBe(1);
  const actualBytes=structures.reduce((sum,mesh)=>sum+2*(mesh.geometry.getAttribute('position').count*24+mesh.geometry.index!.count*4),0);
  expect(surfaceTexturePlan(d,512,1).geometryReserve).toBeGreaterThanOrEqual(actualBytes);
  const paint=results.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='finish') as Three.InstancedMesh[];
  expect(paint).toHaveLength(1);expect(paint[0]!.parent).toBe(parents.get(walls[1]!.id));
  const matrix=new Three.Matrix4(),position=new Three.Vector3(),scale=new Three.Vector3(),rotation=new Three.Quaternion();
  let backTrim=0;
  for(let i=0;i<paint[0]!.count;i++){
   paint[0]!.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
   expect(Math.abs(position.z)).toBeCloseTo(.061,6);
   if(position.z<0){
    backTrim++;expect(position.x+scale.x/2).toBeLessThanOrEqual(.5+1e-6);
   }
  }
  expect(backTrim>0).toBe(full);
  const from:[number,number,number]=full?[11,1.65,-2.55]:[0,1.65,-1.45];
  const to:[number,number,number]=full?[11,1.65,-1.45]:[0,1.65,-2.55];
  const navigation=await createNavigationController(d,{position:from});
  try{
   const first=navigation.qualifiedStandingEye(from),second=navigation.qualifiedStandingEye(to);
   expect(first).toBeTruthy();expect(second).toBeTruthy();
   expect(navigation.standingSegmentClear(first!,second!)).toBe(true);
   expect(navigation.standingSegmentClear(second!,first!)).toBe(true);
  }finally{navigation.dispose();}
 }finally{results.dispose();}
 if(full){
  const exhibition=structuredClone(d);
  const workspace=exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  const descriptor=workspace.furnishings[0]!;
  const bytes=await readFile(new URL('../../../assets/furnishings/user-authored-20261027/double-width-portal/model.glb',import.meta.url));
  const geometry=await validateWorkspaceFurnishingGlb(descriptor.model,bytes,{},'modular-portal-v1');
  descriptor.fit={...descriptor.fit!,geometry};
  const asset={assetId:descriptor.id,path:`data/${descriptor.model.sha256}.bin`,...descriptor.model};
  const source={exhibition,assets:[asset],read:async(path:string)=>{
   expect(path).toBe(asset.path);return bytes;
  }};
  const component=await openRoomIndirectPairedShell(source,openings[0]!.id);
  expect(component).toBeDefined();
  try{
   expect(component!.revealSurfaceId).toBe(walls[1]!.id);
   expect(component!.trace([11,1.5,-2.2],[0,0,1],.4)).toBeUndefined();
   expect(component!.trace([8.9,1.5,-2.2],[0,0,1],.4)?.position[2]).toBeCloseTo(-2.06,5);
   expect(component!.trace([8.9,1.5,-1.8],[0,0,-1],.4)?.position[2]).toBeCloseTo(-1.94,5);
   const paint=component!.trace([8.9,.02,-1.8],[0,0,-1],.4);
   expect(paint?.kind).toBe('finish');
   expect(paint?.reflectance).toEqual(new Three.Color('#dedbd2').toArray());
   expect(component!.receiverOrigin(walls[0]!.id,4.1,-.5)?.position[2]).toBeCloseTo(-2.06001,6);
   expect(component!.receiverOrigin(walls[1]!.id,1.4,-.5)?.position[2]).toBeCloseTo(-1.93999,6);
   expect(component!.receiverOrigin(walls[0]!.id,2,-.5)).toBeUndefined();
  }finally{component?.dispose();}
  expect(await openRoomIndirectPairedShell({...source,assets:[]},openings[0]!.id)).toBeUndefined();
 }
 const inset=structuredClone(d);
 for(const [i,wall] of walls.entries()){
  const target=inset.surfaces.find(surface=>surface.id===wall.id)!;
  target.transform.position[2]+=((i===0)!==full)?.01:-.01;
  parents.get(wall.id)!.position.fromArray(target.transform.position);
 }
 const existing=installArchitecturalFinishes(Three,inset,parents,bases);
 try{
  for(const mesh of existing.meshes.filter(mesh=>mesh.userData.architecturalFinish.kind==='structure')){
   const n=mesh.geometry.getAttribute('normal');
   expect(Array.from({length:n.count},(_,i)=>n.getZ(i))).toContain(-1);
  }
 }finally{existing.dispose();for(const base of bases.values())base.dispose();}
});
