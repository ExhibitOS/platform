// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';
const EDGES=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]] as const;
function corners(three:typeof THREE,box:THREE.Box3){
  const points:THREE.Vector3[]=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new three.Vector3(x,y,z));
  return points;
}
/** Vertices of the box/frustum intersection, without scanning mesh positions.
 * Both sets of edges are needed when one volume contains the other. */
export function clippedBoxPoints(three:typeof THREE,box:THREE.Box3,camera:THREE.Camera){
  if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return [];
  const frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  if(!frustum.intersectsBox(box))return [];
  const points:THREE.Vector3[]=[],boxPoints=corners(three,box);
  const viewPoints=corners(three,new three.Box3(new three.Vector3(-1,-1,-1),new three.Vector3(1,1,1))).map(point=>point.unproject(camera));
  const clip=(a:THREE.Vector3,b:THREE.Vector3,planes:readonly THREE.Plane[])=>{
    let low=0,high=1;
    for(const plane of planes){const da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);
      if(da<0&&db<0)return;
      if(da<0)low=Math.max(low,da/(da-db));else if(db<0)high=Math.min(high,da/(da-db));
      if(low>high)return;
    }
    points.push(a.clone().lerp(b,low),a.clone().lerp(b,high));
  };
  const expanded=box.clone().expandByScalar(1e-6),planes=[
    new three.Plane(new three.Vector3(1,0,0),-expanded.min.x),new three.Plane(new three.Vector3(-1,0,0),expanded.max.x),
    new three.Plane(new three.Vector3(0,1,0),-expanded.min.y),new three.Plane(new three.Vector3(0,-1,0),expanded.max.y),
    new three.Plane(new three.Vector3(0,0,1),-expanded.min.z),new three.Plane(new three.Vector3(0,0,-1),expanded.max.z),
  ];
  for(const [a,b]of EDGES){clip(boxPoints[a]!,boxPoints[b]!,frustum.planes);clip(viewPoints[a]!,viewPoints[b]!,planes);}
  return points;
}
function project(three:typeof THREE,points:readonly THREE.Vector3[],camera:THREE.Camera){
  const box=new three.Box3();for(const point of points){const p=point.clone().project(camera);if(p.toArray().every(Number.isFinite))box.expandByPoint(p);}return box;
}
/** A conservative metadata dependency, not proof of an actual mesh silhouette.
 * Receiver regions are clipped to the COLOR camera before light projection;
 * actual light-frustum/depth projection also handles the existing spot fallback. */
export function shadowReceiverRegions(three:typeof THREE,receivers:readonly THREE.Box3[],capture:THREE.Box3,view:THREE.Camera,light:THREE.Camera){
  const regions:THREE.Box3[]=[];
  for(const bounds of receivers){
    const points=clippedBoxPoints(three,bounds.clone().intersect(capture),view);if(!points.length)continue;
    // This second box is deliberately conservative for perspective spot lights.
    const clipped=clippedBoxPoints(three,new three.Box3().setFromPoints(points).intersect(capture),light);
    const region=project(three,clipped,light);if(!region.isEmpty())regions.push(region);
  }
  return regions;
}
export function selectShadowDependencies(three:typeof THREE,candidates:readonly {id:string;box:THREE.Box3;distance:number}[],capture:THREE.Box3,regions:readonly THREE.Box3[],light:THREE.Camera){
  const admitted=new Map<string,number>();
  for(const row of candidates){
    const points=clippedBoxPoints(three,row.box.clone().intersect(capture),light);if(!points.length)continue;
    const projected=project(three,points,light);
    if(!regions.some(region=>projected.min.x<=region.max.x&&projected.max.x>=region.min.x&&projected.min.y<=region.max.y&&projected.max.y>=region.min.y&&projected.min.z<region.max.z-1e-6))continue;
    admitted.set(row.id,Math.min(admitted.get(row.id)??Infinity,row.distance));
  }
  const ids=[...admitted].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])).slice(0,2).map(([id])=>id);
  return {ids,candidates:admitted.size,admitted:ids.length,deferred:admitted.size-ids.length};
}
