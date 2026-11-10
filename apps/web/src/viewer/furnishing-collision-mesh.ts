// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';

export const FURNISHING_COLLISION_MESH_LIMITS=Object.freeze({
 verticesPerPlacement:24_576,trianglesPerPlacement:16_384,trianglesPerScene:65_536,
});
export interface FurnishingCollisionMesh {vertices:Float32Array;indices:Uint32Array}
export interface MountedFurnishingCollision {
 id:string;mesh:FurnishingCollisionMesh;active:()=>boolean;
}

/** A mounted model stops contributing as soon as its render branch is hidden or detached. */
export function mountedFurnishingCollision(three:typeof Three,id:string,root:Three.Object3D,scene:Three.Scene,unavailable:()=>boolean):MountedFurnishingCollision|undefined {
 const mesh=furnishingCollisionMesh(three,root);
 if(!mesh)return;
 return {id,mesh,active:()=>{
  if(unavailable())return false;
  for(let node:Three.Object3D|null=root;node;node=node.parent){
   if(!node.visible)return false;
   if(node===scene)return true;
  }
  return false;
 }};
}

/** Read the approved visible mesh once, after its authored room/world pose.
 * Separate posts, rails and open spans keep their actual triangles. A single
 * enclosing box or convex hull would close gaps the visitor can walk through. */
export function furnishingCollisionMesh(three:typeof Three,root:Three.Object3D):FurnishingCollisionMesh|undefined {
 const parts:{position:Three.BufferAttribute|Three.InterleavedBufferAttribute;index:Three.BufferAttribute|null;matrix:Three.Matrix4}[]=[];
 let vertexCount=0,indexCount=0,unsupported=false;
 root.updateWorldMatrix(true,true);
 const visit=(node:Three.Object3D)=>{
  if(unsupported||(node!==root&&!node.visible))return;
  if(node instanceof three.Mesh){
   if(node instanceof three.SkinnedMesh||node instanceof three.InstancedMesh||node.morphTargetInfluences?.length){unsupported=true;return;}
   const geometry=node.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex();
   const count=index?.count??position?.count??0;
   if(!position||position.itemSize!==3||position.count<3||count<3||count%3!==0||
    geometry.drawRange.start!==0||geometry.drawRange.count<count){unsupported=true;return;}
   vertexCount+=position.count;indexCount+=count;
   if(vertexCount>FURNISHING_COLLISION_MESH_LIMITS.verticesPerPlacement||indexCount/3>FURNISHING_COLLISION_MESH_LIMITS.trianglesPerPlacement){
    unsupported=true;return;
   }
   parts.push({position,index,matrix:node.matrixWorld});
  }
  for(const child of node.children)visit(child);
 };
 visit(root);
 if(unsupported||!parts.length)return;
 const vertices=new Float32Array(vertexCount*3),indices=new Uint32Array(indexCount),point=new three.Vector3();
 let base=0,offset=0;
 for(const {position,index,matrix} of parts){
  for(let i=0;i<position.count;i++){
   point.set(position.getX(i),position.getY(i),position.getZ(i)).applyMatrix4(matrix);
   const {x,y,z}=point;
   if(![x,y,z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10_000))return;
   vertices.set([x,y,z],(base+i)*3);
  }
  const count=index?.count??position.count;
  for(let i=0;i<count;i++){
   const local=index?.getX(i)??i;
   if(!Number.isSafeInteger(local)||local<0||local>=position.count)return;
   indices[offset++]=base+local;
  }
  base+=position.count;
 }
 return {vertices,indices};
}
