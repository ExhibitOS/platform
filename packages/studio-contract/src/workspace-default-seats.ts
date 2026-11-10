// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {applyBenchCommand,benchesFor,validateStudioBenches,type StudioBench} from './benches.js';
import type {StudioCamera} from './index.js';
import {validateWorkspaceFurnishings,workspaceDefaultSeat,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

export interface WorkspaceDefaultSeatTarget {
 placementId:string;
 benchId:string;
 viewpointId:string;
}
export interface WorkspaceDefaultSeatAddition {
 placementId:string;
 bench:StudioBench;
 viewpoint:StudioCamera & {id:string;name:string};
}

export function defaultSeatCamera(point:AffinePoint,front:AffinePoint,pose:ArtifactPose){
 const [x,y,z]=artifactPoint(point,pose);
 const facing=artifactPoint(front,{...pose,position:[0,0,0],scale:[1,1,1]});
 const position:AffinePoint=[x,y+.7,z];
 const target:AffinePoint=[position[0]+facing[0]*2,position[1],position[2]+facing[2]*2];
 return {position,target,fov:50};
}

export function proposeWorkspaceDefaultSeats(document:Exhibition,targets:readonly WorkspaceDefaultSeatTarget[]){
 if(targets.length>32||!validateWorkspaceFurnishings(document).valid||!validateStudioBenches(document).valid)throw Error('BENCH_INVALID');
 const workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 const existing=new Set(benchesFor(document).flatMap(bench=>bench.workspaceVisual?[bench.workspaceVisual.placementId.toLowerCase()]:[]));
 const seen=new Set<string>(),additions:WorkspaceDefaultSeatAddition[]=[];
 let candidate=document;
 for(const target of targets){
  const key=target.placementId.toLowerCase();
  if(seen.has(key))throw Error('BENCH_REFERENCE');
  seen.add(key);
  const placement=workspace?.placements.find(item=>item.id.toLowerCase()===key);
  if(!placement)throw Error('BENCH_REFERENCE');
  if(existing.has(key))continue;
  const item=workspace?.furnishings.find(item=>item.id===placement.furnishingId&&item.version===placement.furnishingVersion);
  const defaults=item&&workspaceDefaultSeat(item);
  if(!item||!defaults)continue;
  const {position,yaw,scale,roomId}=placement;
  const pose:ArtifactPose={position,rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],scale:[scale,scale,scale]};
  const viewpoint:WorkspaceDefaultSeatAddition['viewpoint']={
   id:target.viewpointId,name:item.name,roomId,
   ...defaultSeatCamera([...defaults.point],[...defaults.front],pose),
  };
  const d=defaults.dimensions;
  const bench:StudioBench={
   id:target.benchId,name:item.name,roomId,position:[...position],yaw,kind:'slab',
   dimensions:{width:d.width*scale,depth:d.depth*scale,height:d.height*scale},
   material:{preset:'wood',color:'#9B7653',roughness:.65,metalness:0},
   viewpointId:viewpoint.id,workspaceVisual:{placementId:placement.id,modelSha256:item.model.sha256},
  };
  candidate=applyBenchCommand(candidate,{type:'add-bench',bench,viewpoint});
  additions.push({placementId:placement.id,bench,viewpoint});
 }
 return {candidate,additions};
}
