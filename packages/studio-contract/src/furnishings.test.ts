// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {test,expect} from 'vitest';
import {applyFurnishingCommand,furnishingsFor,validateFurnishings,resolveFurnishing,remapFurnishings,FURNISHING_NAMESPACE,type FurnishingCommand} from './furnishings.js';
import {artifactPoint} from './artifact-affine.js';
import {BENCH_NAMESPACE,validateStudioBenches} from './benches.js';
const benchId='a0000000-0000-4000-8000-000000000001',viewId='a0000000-0000-4000-8000-000000000002';
const pose=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
function fixture():Exhibition {
 const e=JSON.parse(readFileSync(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,room=e.rooms[0]!;room.dimensions={width:10,height:3,depth:10};room.transform=pose();
 e.extensions={...e.extensions,'org.exhibitos.studio/presentation':{version:1,startCamera:{roomId:room.id,position:[0,1.6,2],target:[0,1.6,0],fov:50},viewpoints:[{id:viewId,name:'Seat',roomId:room.id,position:[0,1.15,0],target:[0,1,-2],fov:50}],credits:''},[BENCH_NAMESPACE]:{version:1,benches:[{id:benchId,name:'Bench',roomId:room.id,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,height:.45,depth:.5},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId:viewId}]}};
 const light=e.lights[0]!;light.type='spot';light.transform={...pose(),position:[0,2.8,0]};delete light.targetPlacementId;
 const wall=e.surfaces.find(s=>s.type==='wall')!;wall.roomId=room.id;wall.dimensions={width:10,height:3};wall.transform={...pose(),position:[0,1.5,-5]};
 const opening=e.openings[0]!;opening.type='door';opening.surfaceId=wall.id;opening.offset=[0,-.4];opening.dimensions={width:1.1,height:2.2};return e;
}
function commands(e:Exhibition):FurnishingCommand[]{return [
 {type:'set-furnishing-visual',hostKind:'bench',hostId:benchId,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}},
 {type:'set-furnishing-visual',hostKind:'light',hostId:e.lights[0]!.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}},
 {type:'set-furnishing-visual',hostKind:'opening',hostId:e.openings[0]!.id,catalogId:'gallery-open-portal',catalogVersion:1,pose:{position:[0,-1.5,0],yaw:0,scale:1}},
 {type:'set-furnishing-visual',hostKind:'pedestal',hostId:e.placements[0]!.id,catalogId:'rectangular-plinth',catalogVersion:1,pose:{position:[-2,0,0],yaw:0,scale:1}},
];}
test('first four typed commands preserve their actual functional coordinate systems atomically',()=>{
 const original=fixture(),before=structuredClone(original);let e=original;for(const c of commands(original))e=applyFurnishingCommand(e,c);
 expect(original).toEqual(before);expect(validateFurnishings(e).valid).toBe(true);expect(validateStudioBenches(e).valid).toBe(true);
 const value=furnishingsFor(e)!;expect(value.assets).toHaveLength(4);expect(value.bindings).toHaveLength(4);
 const light=value.bindings.find(b=>b.hostKind==='light')!,resolved=resolveFurnishing(e,light,value.assets.find(a=>a.id===light.assetId)!);
 if(resolved.source.functional?.kind!=='light')throw Error('fixture');expect(artifactPoint([...resolved.source.functional.apertureCentre],resolved.pose,resolved.parent)).toEqual([0,2.8,0]);
 const portal=value.bindings.find(b=>b.hostKind==='opening')!,opening=resolveFurnishing(e,portal,value.assets.find(a=>a.id===portal.assetId)!);expect(artifactPoint([0,0,0],opening.pose,opening.parent)).toEqual([0,0,-5]);
});
test('unknown catalogue, wrong host, altered bytes/notice and displaced light fail closed',()=>{
 const original=fixture();let e=original;for(const c of commands(original))e=applyFurnishingCommand(e,c);
 for(const edit of [(v:ReturnType<typeof furnishingsFor>)=>{v!.assets[0]!.sha256='0'.repeat(64);},v=>{v!.assets[0]!.rights.notice.path='../private';},v=>{v!.bindings[0]!.hostKind='light';},v=>{v!.bindings.find(b=>b.hostKind==='light')!.pose.position[1]=0;},v=>{v!.assets[0]!.catalogId='gallery-stool' as never;}]){const changed=structuredClone(e);edit(changed.extensions![FURNISHING_NAMESPACE] as unknown as ReturnType<typeof furnishingsFor>);expect(validateFurnishings(changed).valid).toBe(false);}
 const unsupported={...commands(original)[0],catalogId:'gallery-stool'} as FurnishingCommand;expect(()=>applyFurnishingCommand(original,unsupported)).toThrow();expect(original.extensions![FURNISHING_NAMESPACE]).toBeUndefined();
});
test('remove and typed remap preserve exact notice lineage and leave an empty legacy namespace absent',()=>{
 const source=fixture(),command=commands(source)[0]!,next=applyFurnishingCommand(source,command),value=furnishingsFor(next)!,ids=new Map([[benchId,'b0000000-0000-4000-8000-000000000001'],[value.assets[0]!.id,'b0000000-0000-4000-8000-000000000002']]);
 const mapped=remapFurnishings(value,ids);expect(mapped.assets[0]!.rights.notice.path).toBe(`furnishings/${ids.get(value.assets[0]!.id)}/LICENSE-NOTICE.txt`);expect(mapped.assets[0]!.provenance).toEqual(value.assets[0]!.provenance);
 expect(furnishingsFor(applyFurnishingCommand(next,{type:'remove-furnishing-visual',hostKind:'bench',hostId:benchId}))).toBeUndefined();expect(furnishingsFor(source)).toBeUndefined();
});

test('bench pose changes that detach the seated viewpoint and connected aperture resizing reject atomically',()=>{
 const e=fixture(),before=structuredClone(e),bench=commands(e)[0]!;if(bench.type!=='set-furnishing-visual')throw Error('fixture');
 expect(()=>applyFurnishingCommand(e,{...bench,pose:{...bench.pose,position:[2,0,0]}})).toThrow('FURNISHING_INVALID');expect(e).toEqual(before);
 const portal=commands(e)[2]!;e.openings[0]!.connectsToOpeningId=e.openings[1]?.id??viewId;e.openings[0]!.dimensions.width=1.2;const connected=structuredClone(e);
 expect(()=>applyFurnishingCommand(e,portal)).toThrow('FURNISHING_CONNECTED_APERTURE');expect(e).toEqual(connected);
});

test('a visual spot follows the existing legacy placement target when no light-details binding is present',()=>{
 const e=fixture(),light=e.lights[0]!,placement=e.placements[0]!;light.transform.position[1]=2.5;light.targetPlacementId=placement.id;placement.transform.position=[2,1,0];
 const next=applyFurnishingCommand(e,commands(e)[1]!),value=furnishingsFor(next)!,binding=value.bindings[0]!,resolved=resolveFurnishing(next,binding,value.assets[0]!);
 const start=artifactPoint([0,0,0],resolved.parent),end=artifactPoint([0,0,-1],resolved.parent),direction=end.map((n,i)=>n-start[i]!),target=placement.transform.position.map((n,i)=>n-start[i]!),norm=Math.hypot(...target);
 direction.forEach((n,i)=>expect(n).toBeCloseTo(target[i]!/norm,6));
});
