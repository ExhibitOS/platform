// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { artifactCorners, artifactPoint, createConvexCollision } from './artifact-affine.js';
import type { AffinePoint, ArtifactPose } from './artifact-affine.js';
import { benchesFor, validateStudioBenches } from './benches.js';
import type { StudioBench } from './benches.js';

export {benchBoxes} from './bench-shape.js';
import {benchBoxes} from './bench-shape.js';
export function benchPose(bench:StudioBench): ArtifactPose {
  return {position:[...bench.position],rotation:[0,Math.sin(bench.yaw/2),0,Math.cos(bench.yaw/2)],scale:[1,1,1]};
}
/** Shared room/world bounds for rendering, Rapier and server presence. */
export function benchSolids(document:Exhibition){
  if(!validateStudioBenches(document).valid)throw Error('BENCH_INVALID');
  return benchesFor(document).flatMap(bench=>{
    const room=document.rooms.find(r=>r.id.toLowerCase()===bench.roomId.toLowerCase());
    if(!room)throw Error('BENCH_REFERENCE');
    const faces=[[0,2,6,4],[1,5,7,3],[0,4,5,1],[2,3,7,6],[0,1,3,2],[4,6,7,5]],indices=faces.flatMap(f=>[f[0]!,f[2]!,f[1]!,f[0]!,f[3]!,f[2]!]);
    return benchBoxes(bench).map(box=>{const vertices=artifactCorners(box.dimensions,[{position:box.position,rotation:[0,0,0,1],scale:[1,1,1]},benchPose(bench),room.transform],true);return {benchId:bench.id,roomId:bench.roomId,vertices,indices:[...indices],collision:createConvexCollision(vertices,indices)};});
  });
}
export function benchSeat(document:Exhibition,benchId:string){
  const bench=benchesFor(document).find(b=>b.id.toLowerCase()===benchId.toLowerCase());
  const room=document.rooms.find(r=>r.id.toLowerCase()===bench?.roomId.toLowerCase());
  if(!bench||!room||!validateStudioBenches(document).valid)throw Error('BENCH_REFERENCE');
  const floor=artifactPoint(bench.position,room.transform),top=artifactPoint([bench.position[0],bench.position[1]+bench.dimensions.height,bench.position[2]],room.transform);
  // The standing controller supports gravity along world -Y; do not pretend tilted seating is supported.
  if(Math.hypot(top[0]-floor[0],top[2]-floor[2])>1e-5||top[1]<=floor[1])throw Error('BENCH_ORIENTATION_UNSUPPORTED');
  const floorCorners=([-1,1] as const).flatMap(x=>([-1,1] as const).map(z=>artifactPoint([x*bench.dimensions.width/2,0,z*bench.dimensions.depth/2],benchPose(bench),room.transform)));
  return {bench,floor,top,floorCorners};
}
