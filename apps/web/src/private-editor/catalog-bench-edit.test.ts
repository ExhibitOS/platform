// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {applyBenchCommand,applyFurnishingCommand,benchesFor,furnishingsFor,presentationFor,PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState,redoGeometry,undoGeometry} from '../geometry/model';
import {BENCH_CATALOG} from './catalog-bench';
import {addCatalogBench,removeCatalogBench} from './catalog-bench-edit';

it('removes the qualified visual and host as one undoable edit without deleting its viewpoint or other content',()=>{
 const original=newDraft().candidate,room=original.rooms[0]!,id=crypto.randomUUID(),viewpointId=crypto.randomUUID(),{min,max}=BENCH_CATALOG.bounds;
 const bench={id,name:'bench',roomId:room.id,position:[0,0,0] as [number,number,number],yaw:0,kind:'slab' as const,dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood' as const,color:'#755741',roughness:.7,metalness:0},viewpointId};
 const host=applyBenchCommand(original,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 const document=applyFurnishingCommand(host,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}}),before=structuredClone(document),candidate=removeCatalogBench(document,id);
 expect(document).toEqual(before);expect(benchesFor(candidate)).toHaveLength(0);expect(furnishingsFor(candidate)).toBeUndefined();expect(presentationFor(candidate).viewpoints.some(v=>v.id===viewpointId)).toBe(true);expect(candidate.artworks).toEqual(before.artworks);expect(candidate.rooms).toEqual(before.rooms);
 const state=applyGeometryCommand(createGeometryState(document),{type:'replace-architecture',candidate}),undone=undoGeometry(state);
 expect(undone.present).toEqual(before);expect(redoGeometry(undone).present).toEqual(candidate);expect(()=>removeCatalogBench(document,crypto.randomUUID())).toThrow('BENCH_REFERENCE');
});

it('reuses an identical authored viewpoint at capacity without changing it and rejects a full incompatible list',()=>{
 const document=newDraft().candidate,roomId=document.rooms[0]!.id,presentation=presentationFor(document),viewpoints=Array.from({length:64},(_,i)=>({id:crypto.randomUUID(),name:`기존 시점 ${i}`,roomId,position:[0,1.15,0] as [number,number,number],target:[0,1.15,-2] as [number,number,number],fov:i===0?50:45}));
 document.extensions={...document.extensions,[PRESENTATION_NAMESPACE]:{...presentation,viewpoints} as unknown as NonNullable<typeof document.extensions>[string]};const before=structuredClone(document),added=addCatalogBench(document,roomId),bench=benchesFor(added)[0]!;
 expect(bench.viewpointId).toBe(viewpoints[0]!.id);expect(presentationFor(added).viewpoints).toEqual(viewpoints);expect(document).toEqual(before);
 const removed=removeCatalogBench(added,bench.id),again=addCatalogBench(removed,roomId);expect(benchesFor(again)[0]!.viewpointId).toBe(viewpoints[0]!.id);expect(presentationFor(again).viewpoints).toEqual(viewpoints);
 const incompatible=structuredClone(document);(incompatible.extensions![PRESENTATION_NAMESPACE] as unknown as {viewpoints:{fov:number}[]}).viewpoints[0]!.fov=45;expect(()=>addCatalogBench(incompatible,roomId)).toThrow('BENCH_VIEWPOINT_LIMIT');
});
