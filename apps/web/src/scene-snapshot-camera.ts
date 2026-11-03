// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint} from '@exhibitos/studio-contract';

/** A read-only inspection pose in one approved room, never a stored viewpoint. */
export interface InspectionCamera {
 roomId:string;
 position:[number,number,number];
 target:[number,number,number];
 fov:number;
}
const vector=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000);
const fail=()=>{throw Error('SCENE_SNAPSHOT_CAMERA_INVALID');};
const separate=(a:[number,number,number],b:[number,number,number])=>a.reduce((sum,n,i)=>sum+(n-b[i]!)**2,0)>1e-12;

/** Coordinates and FOV are checked before allocation; no scene or document is changed. */
export function checkedInspectionCamera(value:unknown,document:Exhibition,placementId:string):InspectionCamera {
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const v=value as InspectionCamera;
 if(Object.keys(v).sort().join(',')!=='fov,position,roomId,target'||typeof v.roomId!=='string'||!vector(v.position)||!vector(v.target)||typeof v.fov!=='number'||!Number.isFinite(v.fov)||v.fov<10||v.fov>120)return fail();
 const placement=document.placements.find(p=>p.id===placementId),room=document.rooms.find(r=>r.id===v.roomId);
 if(!placement||!room||placement.roomId!==room.id)return fail();
 const d=room.dimensions;
 if(![d.width,d.height,d.depth].every(n=>Number.isFinite(n)&&n>0))return fail();
 const inside=(p:[number,number,number])=>Math.abs(p[0])<=d.width/2&&p[1]>=0&&p[1]<=d.height&&Math.abs(p[2])<=d.depth/2;
 if(!inside(v.position)||!inside(v.target)||!separate(v.position,v.target))return fail();
 return structuredClone(v);
}

/** The same complete room affine as scene geometry, including positive scale. */
export function inspectionCameraPose(document:Exhibition,placementId:string,value:unknown) {
 const camera=checkedInspectionCamera(value,document,placementId),room=document.rooms.find(r=>r.id===camera.roomId)!;
 const position=artifactPoint(camera.position,room.transform),target=artifactPoint(camera.target,room.transform);
 if(!separate(position,target))return fail();
 return {inspection:true as const,roomId:room.id,position,target,fov:camera.fov,localPosition:camera.position,localTarget:camera.target};
}
