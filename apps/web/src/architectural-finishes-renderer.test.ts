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
 const {d,wall}=fixture(),room=new Three.Group(),parent=new Three.Group(),base=new Three.MeshStandardMaterial();room.position.fromArray(d.rooms[0]!.transform.position);parent.position.fromArray(wall.transform.position);parent.quaternion.fromArray(wall.transform.rotation);room.add(parent);const borrowed=vi.spyOn(base,'dispose');const r=installArchitecturalFinishes(Three,d,new Map([[wall.id.toLowerCase(),parent]]),new Map([[wall.id.toLowerCase(),base]]));expect(r.meshes).toHaveLength(2);expect(new Set(r.meshes.map(m=>m.geometry)).size).toBe(1);room.updateMatrixWorld(true);
 const worldBounds=new Three.Box3().setFromObject(room),points=architecturalSolids(d).flatMap(s=>s.vertices);for(const axis of [0,1,2]){expect(worldBounds.min.getComponent(axis)).toBeCloseTo(Math.min(...points.map(p=>p[axis]!)),6);expect(worldBounds.max.getComponent(axis)).toBeCloseTo(Math.max(...points.map(p=>p[axis]!)),6);}
 const geometry=vi.spyOn(r.meshes[0]!.geometry,'dispose');r.dispose();r.dispose();expect(geometry).toHaveBeenCalledOnce();expect(borrowed).not.toHaveBeenCalled();expect(parent.children).toHaveLength(0);base.dispose();
});
test('finish actual Rapier and server presence agree on wall thickness while retaining clear door width',async()=>{
 const {d}=fixture(),c=await createNavigationController(d,{position:[0,1.65,0]}),presence=createPresenceGeometry(d),roomId=d.rooms[0]!.id;try{
  expect(c.isWalkable([3,1.65,-3.72])).toBe(false);expect(presence.valid({roomId,position:[3,1.65,-3.72],yaw:0})).toBe(false);
  expect(c.isWalkable([0,1.65,-3.72])).toBe(true);expect(presence.valid({roomId,position:[0,1.65,-3.72],yaw:0})).toBe(true);expect(c.isWalkable([1.1,1.65,-3.72])).toBe(false);
 }finally{c.dispose();}
 const legacy=structuredClone(d);delete legacy.extensions![ARCHITECTURAL_FINISH_NAMESPACE];const baseline=await createNavigationController(legacy,{position:[0,1.65,0]});try{expect(baseline.isWalkable([0,1.65,-3.9])).toBe(false);expect(baseline.isWalkable([3,1.65,-3.72])).toBe(true);}finally{baseline.dispose();}
});
