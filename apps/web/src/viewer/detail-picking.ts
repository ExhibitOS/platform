// SPDX-License-Identifier: AGPL-3.0-or-later
import {Mesh,type Intersection,type Object3D} from 'three';

// Only the trusted furnishing mount registers a case; GLTF extras cannot opt in.
const displayCases=new WeakSet<Object3D>();
export function registerDetailPickDisplayCase(object:Object3D){displayCases.add(object);}

/** Glass can reveal an artwork without removing the case from rendering or collision. */
export function detailPickHit(hits:readonly Intersection<Object3D>[]):Intersection<Object3D>|undefined {
 return hits.find(hit=>{
  if(!(hit.object instanceof Mesh))return true;
  let displayCase=false;
  for(let object:Object3D|null=hit.object;object;object=object.parent){
   if(typeof object.userData.placementId==='string'||typeof object.userData.plaqueId==='string')return true;
   if(displayCases.has(object))displayCase=true;
  }
  const material=Array.isArray(hit.object.material)?hit.object.material[hit.face?.materialIndex??0]:hit.object.material;
  return !displayCase||!material?.transparent||!Number.isFinite(material.opacity)||material.opacity<0||material.opacity>=1;
 });
}
