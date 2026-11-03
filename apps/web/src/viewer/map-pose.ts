// SPDX-License-Identifier: AGPL-3.0-or-later
import {visitorMapPose} from './visitor-map';

export type MapPoseSnapshot=NonNullable<ReturnType<typeof visitorMapPose>>&{horizontalFovDegrees:number;continuous?:boolean};
/** One publication/revision owner. Consumers subscribe only to their SVG pose
 * layer; camera frames must not rerender Viewer or recalculate map layout. */
export interface MapPoseSource {
 readonly key:string;
 getSnapshot():MapPoseSnapshot|undefined;
 subscribe(listener:()=>void):()=>void;
}

export function createMapPoseSource(key:string){
 let snapshot:MapPoseSnapshot|undefined;
 const listeners=new Set<()=>void>();
 const notify=()=>{for(const listener of [...listeners])listener();};
 return {
  key,
  getSnapshot:()=>snapshot,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  publish(position:[number,number,number],yaw:number,horizontalFovDegrees:number,continuous?:boolean){
   const pose=visitorMapPose(position,yaw);
   if(!pose||!Number.isFinite(horizontalFovDegrees)||horizontalFovDegrees<=0||horizontalFovDegrees>=180){if(snapshot){snapshot=undefined;notify();}return;}
   // Compare the actual projected direction, never interpolate across +/- pi
   // or animate a teleport through positions the camera did not occupy.
   if(snapshot&&snapshot.continuous===continuous&&Math.hypot(snapshot.point[0]-pose.point[0],snapshot.point[1]-pose.point[1])<1e-6&&Math.hypot(snapshot.direction[0]-pose.direction[0],snapshot.direction[1]-pose.direction[1])<1e-6&&Math.abs(snapshot.horizontalFovDegrees-horizontalFovDegrees)<1e-6)return;
   snapshot={...pose,horizontalFovDegrees,...(continuous===undefined?{}:{continuous})};notify();
  },
  clear(){if(snapshot){snapshot=undefined;notify();}},
 } satisfies MapPoseSource&{publish(position:[number,number,number],yaw:number,horizontalFovDegrees:number,continuous?:boolean):void;clear():void};
}
