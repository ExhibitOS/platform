// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {createConvexCollision,artifactPoint} from './artifact-affine.js';
import {resolveInstallations} from './installation-resolver.js';
import {applyInstallationCommand} from './installation-commands.js';
import {INSTALLATION_NAMESPACE as N} from './installation.js';
import type {InstallationBinding} from './installation.js';
const id='aaaaaaaa-0000-4000-8000-000000000001',revision='aaaaaaaa-0000-4000-8000-000000000002',pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}),material={preset:'paint' as const,color:'#FFFFFF',roughness:.7,metalness:0};
function doc(cylinder=false):Exhibition{return {rooms:[{id:revision,dimensions:{width:3000,height:10,depth:20},transform:pose()}],artworks:[{revisionId:revision,artworkType:'image',dimensions:{width:2,height:1},transform:pose()}],placements:[{id,roomId:revision,artworkRevisionId:revision,transform:{...pose(),position:[0,1.5,-3]}}],extensions:{[N]:{version:1,placements:[{placementId:id,pedestal:cylinder?{kind:'cylinder',position:[2,0,0],yaw:.4,dimensions:{diameter:1,height:.8},material}:{kind:'box',position:[2,0,0],yaw:0,dimensions:{width:1,depth:1,height:.8},material}}]}}} as unknown as Exhibition;}
test('prepared box/cylinder use actual convex shape and continuous capsule sweeps',()=>{
 for(const cylinder of [false,true]){const r=resolveInstallations(doc(cylinder))[0]!,solid=r.solids[0]!;expect(r.issues).toEqual([]);expect(solid.vertices).toHaveLength(cylinder?64:8);expect(solid.collision.hit([2,.3,0],[2,1.5,0],.25)).toBe(true);expect(solid.collision.hit([4,.3,0],[4,1.5,0],.25)).toBe(false);expect(solid.collision.swept([1,.3,0],[1,1.5,0],[3,.3,0],[3,1.5,0],.25)).toBe(true);if(cylinder)expect(solid.collision.hit([2.49,.4,.49],[2.49,.4,.49],.01)).toBe(false);}
});
test('world transform and noncolliding planar mats preserve exact frame aperture',()=>{
 const d=doc(),b=(d.extensions![N] as unknown as {placements:InstallationBinding[]}).placements[0]!;b.pedestal={kind:'none'};b.frame={kind:'flat',borderWidth:.1,thickness:.02,depth:.02,gap:0,matWidth:.04,matColor:'#FFFFFF',material};
 d.rooms[0]!.transform={...pose(),position:[7,0,0],rotation:[0,Math.sin(.2),0,Math.cos(.2)]};const r=resolveInstallations(d)[0]!,world=(v:[number,number,number])=>artifactPoint(v,d.rooms[0]!.transform);
 expect(r.primitives).toHaveLength(8);expect(r.solids).toHaveLength(4);expect(r.solids.some(s=>s.collision.hit(world([1.09,1.5,-3]),world([1.09,1.5,-3]),.005))).toBe(true);expect(r.solids.some(s=>s.collision.hit(world([0,1.5,-3]),world([0,1.5,-3]),.005))).toBe(false);
});
test('Float32 collapsed mat omits the same complete frame component and retains source metadata',()=>{
 const d=doc(),b=(d.extensions![N] as unknown as {placements:InstallationBinding[]}).placements[0]!;b.pedestal={kind:'none'};b.frame={kind:'flat',borderWidth:.1,thickness:.02,depth:.02,gap:0,matWidth:1e-6,matColor:'#FFFFFF',material};d.placements[0]!.transform.position=[1000,1.5,-3];const before=structuredClone(d),r=resolveInstallations(d)[0]!;
 expect(r.issues).toEqual([{component:'frame',reason:'singular-transform'}]);expect(r.primitives).toEqual([]);expect(r.solids).toEqual([]);expect(d).toEqual(before);
 const wallId='aaaaaaaa-0000-4000-8000-000000000003';d.surfaces=[{id:wallId,roomId:revision,type:'wall',dimensions:{width:3000,height:4},transform:{...pose(),position:[0,2,-4]}} as Exhibition['surfaces'][number]];d.openings=[];expect(()=>applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:wallId,gap:.05})).toThrow('INSTALLATION_singular-transform');
});
test('malformed doubled opposing triangles cannot create an unbounded collision slab',()=>{
 const points:[number,number,number][]=[[-1,-1,1],[1,-1,1],[0,1,1],[-1,-1,-1],[0,1,-1],[1,-1,-1]];expect(()=>createConvexCollision(points,[0,1,2,0,1,2,3,4,5,3,4,5])).toThrow('ARTIFACT_HULL_UNSUPPORTED');
 const solid=resolveInstallations(doc())[0]!.solids[0]!,input=solid.vertices.map(p=>[...p] as [number,number,number]),query=createConvexCollision(input,solid.indices);input[0]![0]=999;expect(query.hit([2,.3,0],[2,1.5,0],.25)).toBe(true);expect(()=>createConvexCollision(solid.vertices,solid.indices.slice(3))).toThrow();
});
