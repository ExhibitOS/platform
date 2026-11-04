import {expect,test,vi} from 'vitest';
import * as Three from 'three';
import {newDraft} from './drafts/example';
import {whiteCubeSurfaces,newDoor} from './geometry/model';
import {applyArchitecturalFinishCommand,architecturalSolids,ARCHITECTURAL_FINISH_NAMESPACE} from '@exhibitos/studio-contract';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {createNavigationController} from './viewer/navigation';
import {createPresenceGeometry} from '../../api/src/realtime-geometry';
function fixture(){let d=newDraft().candidate;d.surfaces=whiteCubeSurfaces(d.rooms[0]!);const wall=d.surfaces[0]!;d.openings=[newDoor(wall.id,{width:2.4,height:3},[0,-.5])];d=applyArchitecturalFinishCommand(d,{type:'set-wall-finish',wall:{surfaceId:wall.id,depth:.12,preset:'dark-edge',trimWidth:.04,baseboardHeight:.1,ceilingBand:true}});return {d,wall};}
test('finish pooled rendering matches world hulls once and disposes owned buffers without borrowed material',()=>{
 const {d,wall}=fixture(),room=new Three.Group(),parent=new Three.Group(),base=new Three.MeshStandardMaterial();room.position.fromArray(d.rooms[0]!.transform.position);parent.position.fromArray(wall.transform.position);parent.quaternion.fromArray(wall.transform.rotation);room.add(parent);const borrowed=vi.spyOn(base,'dispose');const r=installArchitecturalFinishes(Three,d,new Map([[wall.id.toLowerCase(),parent]]),new Map([[wall.id.toLowerCase(),base]]));expect(r.meshes).toHaveLength(2);expect(r.meshes[0]).not.toBeInstanceOf(Three.InstancedMesh);expect(r.meshes[1]).toBeInstanceOf(Three.InstancedMesh);room.updateMatrixWorld(true);
 const worldBounds=new Three.Box3().setFromObject(room),points=architecturalSolids(d).flatMap(s=>s.vertices);for(const axis of [0,1,2]){expect(worldBounds.min.getComponent(axis)).toBeCloseTo(Math.min(...points.map(p=>p[axis]!)),6);expect(worldBounds.max.getComponent(axis)).toBeCloseTo(Math.max(...points.map(p=>p[axis]!)),6);}
 const geometries=r.meshes.map(m=>vi.spyOn(m.geometry,'dispose'));r.dispose();r.dispose();for(const geometry of geometries)expect(geometry).toHaveBeenCalledOnce();expect(borrowed).not.toHaveBeenCalled();expect(parent.children).toHaveLength(0);base.dispose();
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
