// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {applyInstallationCommand} from './installation-commands.js';
import {applyFurnishingCommand} from './furnishings.js';
import {artifactCorners} from './artifact-affine.js';
import {INSTALLATION_NAMESPACE as N} from './installation.js';
import {installationArtworkBounds,resolveInstallations} from './installation-resolver.js';
const id='aaaaaaaa-0000-4000-8000-000000000001',roomId='aaaaaaaa-0000-4000-8000-000000000002',artId='aaaaaaaa-0000-4000-8000-000000000003',surfaceId='aaaaaaaa-0000-4000-8000-000000000004';
const pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
function doc(){return {rooms:[{id:roomId,dimensions:{width:20,height:10,depth:20},transform:pose()}],artworks:[{artworkType:'image',revisionId:artId,dimensions:{width:2,height:1,depth:.02},transform:pose()}],placements:[{id,roomId,artworkRevisionId:artId,transform:{...pose(),position:[2,3,3]}}],surfaces:[],openings:[],extensions:{[N]:{version:1,placements:[{placementId:id,pedestal:{kind:'box',position:[-1,.2,1],yaw:0,dimensions:{width:1,height:1,depth:1},material:{preset:'paint',color:'#FFFFFF',roughness:0,metalness:0}}}]}}} as unknown as Exhibition;}
test('center/on-top change existing translation only and preserve source/config/rotation/scale',()=>{
 const d=doc(),before=JSON.stringify(d),center=applyInstallationCommand(d,{placementId:id,command:'center-artwork'}),top=applyInstallationCommand(center,{placementId:id,command:'on-top'});
 expect(installationArtworkBounds(top.artworks[0]!,top.placements[0]!).center[0]).toBe(-1);expect(installationArtworkBounds(top.artworks[0]!,top.placements[0]!).center[2]).toBe(1);expect(installationArtworkBounds(top.artworks[0]!,top.placements[0]!).min[1]).toBeCloseTo(1.2);
 expect(top.artworks).toEqual(d.artworks);expect(top.extensions).toEqual(d.extensions);expect(top.placements[0]!.transform.rotation).toEqual(d.placements[0]!.transform.rotation);expect(top.placements[0]!.transform.scale).toEqual(d.placements[0]!.transform.scale);expect(JSON.stringify(d)).toBe(before);
});
test('installation height samples chosen tilted floor at artwork bounds-centerXZ',()=>{
 const d=doc(),angle=-Math.PI/2+Math.atan(.5);d.surfaces=[{id:surfaceId,roomId,type:'floor',dimensions:{width:20,height:20},transform:{...pose(),rotation:[Math.sin(angle/2),0,0,Math.cos(angle/2)]}} as Exhibition['surfaces'][number]];
 const result=applyInstallationCommand(d,{placementId:id,command:'install-height',height:1.4,floorSurfaceId:surfaceId});expect(installationArtworkBounds(result.artworks[0]!,result.placements[0]!).center[1]).toBeCloseTo(-.1);expect(result.placements[0]!.transform.position[0]).toBe(2);expect(result.placements[0]!.transform.position[2]).toBe(3);
});
test('implicit room base is used only when no authored floor exists; missing/ambiguous explicit floor does not guess',()=>{
 const d=doc();expect(applyInstallationCommand(d,{placementId:id,command:'install-height',height:1.4}).placements[0]!.transform.position[1]).toBeCloseTo(1.4);
 const floor={id:surfaceId,roomId,type:'floor',dimensions:{width:1,height:1},transform:{...pose(),rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2]}} as Exhibition['surfaces'][number];d.surfaces=[floor];expect(()=>applyInstallationCommand(d,{placementId:id,command:'install-height',height:1.4})).toThrow('INSTALLATION_missing-room-floor');
 floor.dimensions={width:20,height:20};d.surfaces.push({...structuredClone(floor),id:artId});expect(()=>applyInstallationCommand(d,{placementId:id,command:'install-height',height:1.4})).toThrow('INSTALLATION_ambiguous-room-floor');
});
test('wall gap uses explicit parallel wall and rear frame envelope without moving pedestal',()=>{
 const d=doc();d.placements[0]!.transform.position=[0,1.5,-3];d.surfaces=[{id:surfaceId,roomId,type:'wall',dimensions:{width:8,height:4},transform:{...pose(),position:[0,2,-4]}} as Exhibition['surfaces'][number]];
 const ext=d.extensions![N] as unknown as {placements:Record<string,unknown>[]};ext.placements[0]!.frame={kind:'flat',borderWidth:.04,thickness:.02,depth:.015,gap:0,matWidth:0,matColor:'#FFFFFF',material:{preset:'paint',color:'#FFFFFF',roughness:.7,metalness:0}};
 const next=applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:surfaceId,gap:.05}),frame=resolveInstallations(next)[0]!.primitives.slice(1);expect(Math.min(...frame.flatMap(p=>p.vertices.map(v=>v[2]+4)))).toBeCloseTo(.05);expect(next.extensions).toEqual(d.extensions);
});
test('unrelated/nonparallel wall and wall opening overlap reject without a silent snap or source mutation',()=>{
 const d=doc();d.placements[0]!.transform.position=[0,1.5,-3];const wall={id:surfaceId,roomId,type:'wall',dimensions:{width:8,height:4},transform:{...pose(),position:[0,2,-4]}} as Exhibition['surfaces'][number];d.surfaces=[wall];d.openings=[{id:artId,surfaceId,type:'door',dimensions:{width:2.4,height:3},offset:[0,-.5],exterior:true}];const before=JSON.stringify(d);expect(()=>applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:surfaceId,gap:.05})).toThrow('INSTALLATION_limits-exceeded');expect(JSON.stringify(d)).toBe(before);
 d.openings=[];wall.transform.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];expect(()=>applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:surfaceId,gap:.05})).toThrow('INSTALLATION_wall-not-parallel');
});

test('unsupported pedestal component rejects both alignment commands before any source change',()=>{
 const d=doc(),ext=d.extensions![N] as unknown as {placements:{pedestal:{position:number[]}}[]};ext.placements[0]!.pedestal.position=[10000,0,0];const before=JSON.stringify(d);
 for(const command of ['center-artwork','on-top'] as const)expect(()=>applyInstallationCommand(d,{placementId:id,command})).toThrow('INSTALLATION_limits-exceeded');expect(JSON.stringify(d)).toBe(before);
});
test('outward-authored perimeter wall resolves room-inward gap while interior partition preserves current artwork side',()=>{
 const d=doc();d.placements[0]!.transform.position=[0,1.5,9];const wall={id:surfaceId,roomId,type:'wall',dimensions:{width:8,height:4},transform:{...pose(),position:[0,2,10]}} as Exhibition['surfaces'][number];d.surfaces=[wall];
 const result=applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:surfaceId,gap:.05});expect(installationArtworkBounds(result.artworks[0]!,result.placements[0]!).max[2]).toBeCloseTo(9.95);expect(result.placements[0]!.transform.rotation).toEqual(d.placements[0]!.transform.rotation);
 wall.transform.position=[0,2,0];d.placements[0]!.transform.position=[0,1.5,-1];const other=applyInstallationCommand(d,{placementId:id,command:'wall-gap',wallSurfaceId:surfaceId,gap:.05});expect(installationArtworkBounds(other.artworks[0]!,other.placements[0]!).max[2]).toBeCloseTo(-.05);
});

test('verified plinth alignment moves only the selected assertion envelope and rejects overhang or missing host',()=>{
 const original=doc();original.artworks[0]!.artworkType='sculpture';original.artworks[0]!.dimensions={width:.2,height:.4,depth:.2};
 const d=applyFurnishingCommand(original,{type:'set-furnishing-visual',hostKind:'pedestal',hostId:id,catalogId:'rectangular-plinth',catalogVersion:1,pose:{position:[-1,0,1],yaw:Math.PI/4,scale:.8}}),before=structuredClone(d),result=applyInstallationCommand(d,{placementId:id,command:'align-on-verified-plinth'}),bounds=installationArtworkBounds(result.artworks[0]!,result.placements[0]!);
 expect(bounds.center[0]).toBeCloseTo(-1);expect(bounds.center[2]).toBeCloseTo(1);expect(bounds.min[1]).toBeCloseTo(.9000000059604645*.8);expect(result.artworks).toEqual(d.artworks);expect(result.extensions).toEqual(d.extensions);expect(result.placements[0]!.transform.rotation).toEqual(d.placements[0]!.transform.rotation);expect(result.placements[0]!.transform.scale).toEqual(d.placements[0]!.transform.scale);expect(d).toEqual(before);
 const oversized=structuredClone(d);oversized.artworks[0]!.dimensions={width:1,height:1,depth:1};const saved=structuredClone(oversized);expect(()=>applyInstallationCommand(oversized,{placementId:id,command:'align-on-verified-plinth'})).toThrow('INSTALLATION_plinth-overhang');expect(oversized).toEqual(saved);
 expect(()=>applyInstallationCommand(original,{placementId:id,command:'align-on-verified-plinth'})).toThrow('INSTALLATION_plinth-unsupported');
 const transformed=structuredClone(d);transformed.rooms[0]!.transform={position:[3,2,-4],rotation:[0,Math.sin(.3),0,Math.cos(.3)],scale:[1.2,1,1.1]};transformed.artworks[0]!.transform.scale=[.5,1.1,.8];transformed.placements[0]!.transform.scale=[1.2,.8,1.1];const transformedBefore=structuredClone(transformed),aligned=applyInstallationCommand(transformed,{placementId:id,command:'align-on-verified-plinth'}),transformedBounds=installationArtworkBounds(aligned.artworks[0]!,aligned.placements[0]!);expect(transformedBounds.min[1]).toBeCloseTo(.9000000059604645*.8);expect(transformed).toEqual(transformedBefore);expect(aligned.placements[0]!.transform.scale).toEqual(transformed.placements[0]!.transform.scale);
 const zeroDepth=structuredClone(d);zeroDepth.artworks[0]!.dimensions.depth=0;expect(()=>applyInstallationCommand(zeroDepth,{placementId:id,command:'align-on-verified-plinth'})).toThrow('INSTALLATION_plinth-unsupported');
 const shiftedRoom=structuredClone(d);shiftedRoom.rooms[0]!.transform.position=[0,9999,0];shiftedRoom.placements[0]!.transform.position[1]=.2;expect(()=>artifactCorners(shiftedRoom.artworks[0]!.dimensions,[shiftedRoom.artworks[0]!.transform,shiftedRoom.placements[0]!.transform,shiftedRoom.rooms[0]!.transform],true)).not.toThrow();const shiftedBefore=structuredClone(shiftedRoom);expect(()=>applyInstallationCommand(shiftedRoom,{placementId:id,command:'align-on-verified-plinth'})).toThrow('INSTALLATION_limits-exceeded');expect(shiftedRoom).toEqual(shiftedBefore);
});
