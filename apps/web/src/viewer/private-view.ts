// SPDX-License-Identifier: AGPL-3.0-or-later
import {Matrix4,Quaternion,Vector3} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {privateViewKey} from './private-view-storage';

/** Transient, same-tab camera handoff; world coordinates, never draft content. */
export type PrivateView={roomId:string;position:[number,number,number];target:[number,number,number];fov:number};
const vec=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
export function safePrivateView(doc:Exhibition,value:unknown):PrivateView|undefined{
 try{
  if(!value||typeof value!=='object')return;
  const v=value as PrivateView;if(typeof v.roomId!=='string'||!vec(v.position)||!vec(v.target)||!Number.isFinite(v.fov)||v.fov<20||v.fov>100)return;
  const room=doc.rooms.find(r=>r.id.toLowerCase()===v.roomId.toLowerCase());if(!room)return;
  const t=room.transform,matrix=new Matrix4().compose(new Vector3(...t.position),new Quaternion(...t.rotation),new Vector3(...t.scale));
  if(!Number.isFinite(matrix.determinant())||Math.abs(matrix.determinant())<1e-9)return;
  const local=new Vector3(...v.position).applyMatrix4(matrix.invert()),{width,height,depth}=room.dimensions;
  if(!local.toArray().every(Number.isFinite)||Math.abs(local.x)>width/2||local.y<0||local.y>height||Math.abs(local.z)>depth/2)return;
  const distance=new Vector3(...v.position).distanceTo(new Vector3(...v.target));if(distance<.01||distance>100)return;
  return {roomId:room.id,position:[...v.position],target:[...v.target],fov:v.fov};
 }catch{return;}
}
export function savePrivateView(publicationId:string,revision:string,index:string,view:PrivateView|undefined){
 const k=privateViewKey(publicationId,revision,index);if(!k)return;
 try{if(view)sessionStorage.setItem(k,JSON.stringify(view));else sessionStorage.removeItem(k);}catch{/* storage is optional */}
}
export function takePrivateView(publicationId:string,revision:string,index:string,doc:Exhibition):PrivateView|undefined{
 const k=privateViewKey(publicationId,revision,index);if(!k)return;
 try{const raw=sessionStorage.getItem(k);sessionStorage.removeItem(k);return raw?safePrivateView(doc,JSON.parse(raw)):undefined;}catch{return;}
}
