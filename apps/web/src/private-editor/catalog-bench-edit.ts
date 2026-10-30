// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {applyBenchCommand,applyFurnishingCommand,presentationFor,type StudioBench} from '@exhibitos/studio-contract';
import {privateCatalogBench} from './catalog-bench-renderer';
import {BENCH_CATALOG} from './catalog-bench';

/** Reuse an identical camera without changing or removing any authored viewpoint. */
export function addCatalogBench(document:Exhibition,roomId:string):Exhibition {
 const room=document.rooms.find(r=>r.id.toLowerCase()===roomId.toLowerCase());if(!room)throw Error('BENCH_REFERENCE');
 const position:[number,number,number]=[0,1.15,0],target:[number,number,number]=[0,1.15,-2],fov=50;
 const views=presentationFor(document).viewpoints,same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const existing=views.find(v=>v.roomId.toLowerCase()===roomId.toLowerCase()&&v.fov===fov&&same(v.position,position)&&same(v.target,target));
 if(!existing&&views.length>=64)throw Error('BENCH_VIEWPOINT_LIMIT');
 const id=crypto.randomUUID(),viewpointId=existing?.id??crypto.randomUUID(),{min,max}=BENCH_CATALOG.bounds;
 const bench:StudioBench={id,name:'참나무 벤치',roomId:room.id,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId};
 const candidate=applyBenchCommand(document,{type:'add-bench',bench,...(existing?{}:{viewpoint:{id:viewpointId,name:'벤치 시점',roomId:room.id,position,target,fov}})});
 return applyFurnishingCommand(candidate,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}});
}

/** Remove the selected visual and its functional host together; history belongs to the caller. */
export function removeCatalogBench(document:Exhibition,benchId:string):Exhibition {
 const selected=privateCatalogBench(document);
 if(!selected||selected.binding.hostId.toLowerCase()!==benchId.toLowerCase())throw Error('BENCH_REFERENCE');
 const withoutVisual=applyFurnishingCommand(document,{type:'remove-furnishing-visual',hostKind:'bench',hostId:benchId});
 return applyBenchCommand(withoutVisual,{type:'remove-bench',benchId});
}
