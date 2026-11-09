// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
type Transform=Exhibition['placements'][number]['transform'];
/** Fixed GLB front is −Z; artwork front is +Z. Both are rigid unit-scale. */
export function artworkFrameMatrix(three:typeof Three,placement:Transform,artwork:Transform,imagePlaneZ=-.012){
 const matrix=(t:Transform)=>new three.Matrix4().compose(new three.Vector3(...t.position),new three.Quaternion(...t.rotation),new three.Vector3(...t.scale));
 return matrix(placement).multiply(matrix(artwork)).multiply(new three.Matrix4().makeTranslation(0,0,imagePlaneZ)).multiply(new three.Matrix4().makeRotationY(Math.PI));
}

/** The measured ring uses straight rails and four rigid bevel profiles. */
export function fitArtworkFrameGeometry(three:typeof Three,object:Three.Object3D,{cornerX,cornerY}:{cornerX:number;cornerY:number}){
 if(Math.abs(cornerX)<1e-9&&Math.abs(cornerY)<1e-9)return;
 object.traverse(node=>{
  if(!(node instanceof three.Mesh))return;
  const geometry=node.geometry as Three.BufferGeometry,positions=geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),y=positions.getY(i);
   positions.setXY(i,x+Math.sign(x)*cornerX,y+Math.sign(y)*cornerY);
  }
  positions.needsUpdate=true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
 });
}
