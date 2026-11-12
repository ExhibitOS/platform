// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {applyBenchCommand,applyFurnishingCommand,defaultSeatCamera,furnishingCatalogueEntry,furnishingPoseTransform,presentationFor,type FurnishingPose,type StudioBench} from '@exhibitos/studio-contract';
import {privateCatalogBench} from './catalog-bench-renderer';
import {type BenchCatalogId} from './catalog-bench';

/** Reuse an identical camera without changing or removing any authored viewpoint. */
export function addCatalogBench(document:Exhibition,roomId:string,pose:FurnishingPose={position:[0,0,0],yaw:0,scale:1},catalogId:BenchCatalogId='backless-oak-bench'):Exhibition {
 const room=document.rooms.find(r=>r.id.toLowerCase()===roomId.toLowerCase());if(!room)throw Error('BENCH_REFERENCE');
 const source=furnishingCatalogueEntry(catalogId),functional=source.functional;
 if(!functional||functional.kind!=='bench')throw Error('BENCH_REFERENCE');
 // Preserve the existing slat reference; the backed target has its own authored virtual seat.
 const seat=catalogId==='backless-oak-bench'?[-.4,.45,.05675] as [number,number,number]:functional.seats[0]!.point;
 const {position,target,fov}=defaultSeatCamera([...seat],[...functional.front],furnishingPoseTransform(pose));
 const legacyPose=catalogId==='backless-oak-bench'&&pose.scale===1&&pose.yaw===0&&pose.position.every(n=>n===0);
 const views=presentationFor(document).viewpoints,same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const existing=views.find(v=>v.roomId.toLowerCase()===roomId.toLowerCase()&&v.fov===fov&&(same(v.position,position)&&same(v.target,target)||legacyPose&&same(v.position,[0,1.15,0])&&same(v.target,[0,1.15,-2])));
 if(!existing&&views.length>=64)throw Error('BENCH_VIEWPOINT_LIMIT');
 const id=crypto.randomUUID(),viewpointId=existing?.id??crypto.randomUUID(),{min,max}=source.bounds;
 const bench:StudioBench={id,name:'참나무 벤치',roomId:room.id,position:[...pose.position],yaw:pose.yaw,kind:catalogId==='backless-oak-bench'?'slab':'backed',dimensions:{width:(max[0]-min[0])*pose.scale,depth:(max[2]-min[2])*pose.scale,height:functional.seatEnvelopeY*pose.scale},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId};
 const candidate=applyBenchCommand(document,{type:'add-bench',bench,...(existing?{}:{viewpoint:{id:viewpointId,name:'벤치 시점',roomId:room.id,position,target,fov}})});
 return applyFurnishingCommand(candidate,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId,catalogVersion:1,pose});
}

/** Remove the selected visual and its functional host together; history belongs to the caller. */
export function removeCatalogBench(document:Exhibition,benchId:string):Exhibition {
 const selected=privateCatalogBench(document);
 if(!selected||selected.binding.hostId.toLowerCase()!==benchId.toLowerCase())throw Error('BENCH_REFERENCE');
 const withoutVisual=applyFurnishingCommand(document,{type:'remove-furnishing-visual',hostKind:'bench',hostId:benchId});
 return applyBenchCommand(withoutVisual,{type:'remove-bench',benchId});
}
