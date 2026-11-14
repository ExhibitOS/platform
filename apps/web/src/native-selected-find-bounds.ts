// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PerspectiveCamera} from 'three';

export interface NativeFindBounds {id:string;minDistance:number;maxDistance:number;near:number;far:number}

/** Temporary orbit limits for the existing Native selected-object Find action.
 * This scope never moves the camera, target, or artwork, including on reset. */
export function nativeSelectedFindBounds(camera:PerspectiveCamera,orbit:{minDistance:number;maxDistance:number}){
 const ordinary={minDistance:orbit.minDistance,maxDistance:orbit.maxDistance,near:camera.near,far:camera.far};
 let active:NativeFindBounds|undefined;
 const apply=(value:typeof ordinary)=>{orbit.minDistance=value.minDistance;orbit.maxDistance=value.maxDistance;camera.near=value.near;camera.far=value.far;camera.updateProjectionMatrix();};
 const reset=()=>{if(active){active=undefined;apply(ordinary);}};
 return {
  reset,
  sync(id:string|undefined,available:boolean){if(active&&(!available||active.id!==id))reset();},
  focus(id:string,size:readonly number[],aspect:number):number|undefined{
   if(size.length!==3||!size.every(v=>Number.isFinite(v)&&v>=0)||!Number.isFinite(aspect)||aspect<=0)return;
   const extent=Math.max(...size),radius=Math.hypot(...size)/2;
   if(extent<1e-6||extent>10000)return;
   const distance=extent*2.1/Math.min(1,aspect),minDistance=radius*1.05,maxDistance=Math.min(ordinary.maxDistance,Math.max(distance*4,radius*8));
   if(!Number.isFinite(distance)||distance>maxDistance||minDistance>=maxDistance)return;
   active={id,minDistance,maxDistance,near:radius/1000,far:maxDistance+radius*2};apply(active);return distance;
  },
  snapshot(){return active?{...active}:undefined;},
  restore(value:NativeFindBounds|undefined,id:string|undefined){
   if(!value||value.id!==id||![value.minDistance,value.maxDistance,value.near,value.far].every(Number.isFinite)||value.near<=0||value.minDistance<=value.near||value.maxDistance<=value.minDistance||value.maxDistance>ordinary.maxDistance||value.far<=value.maxDistance)return false;
   active={...value};apply(active);return true;
  },
 };
}
