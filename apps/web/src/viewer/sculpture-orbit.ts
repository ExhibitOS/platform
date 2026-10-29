// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ViewingOrbit} from '@exhibitos/studio-contract';
export interface SculptureOrbitState {placementId:string;yaw:number;holding?:-1|1;reducedMotion:boolean;available:boolean;canLeft:boolean;canRight:boolean;message:string}
export interface SculptureOrbitActions {step(direction:-1|1):void;press(direction:-1|1,pointerId:number):void;release(pointerId:number,activate:boolean):void;stop():void}
export const SCULPTURE_ORBIT_STEP=Math.PI/18;
/** Rotate the camera about the authored world target, preserving radius/height.
 * This never defines a sculpture front from its GLB axes or measured centre. */
export function sculptureOrbitPose(position:readonly number[],target:readonly number[],yaw:number){
 if(position.length!==3||target.length!==3||![...position,...target,yaw].every(Number.isFinite)||Math.abs(yaw)>Math.PI+1e-9)return undefined;
 const x=position[0]!-target[0]!,z=position[2]!-target[2]!;if(Math.hypot(x,z)<.001)return undefined;
 const eye:[number,number,number]=[target[0]!+x*Math.cos(yaw)+z*Math.sin(yaw),position[1]!,target[2]!-x*Math.sin(yaw)+z*Math.cos(yaw)];
 return {position:eye,target:[...target] as [number,number,number],yaw:Math.atan2(eye[0]-target[0]!,eye[2]-target[2]!)};
}
export function createSculptureOrbit(options:{placementId:string;bounds:ViewingOrbit;allowed:()=>boolean;reducedMotion:()=>boolean;move:(yaw:number)=>boolean;changed:(state:SculptureOrbitState)=>void}){
 const {minYaw,maxYaw}=options.bounds,full=minYaw===-Math.PI&&maxYaw===Math.PI;
 let yaw=0,disposed=false,message='',blocked:-1|1|undefined,generation=0,lastPublished='',reduced=options.reducedMotion();
 let pointer:{id:number;direction:-1|1;held:boolean;started:number;last:number}|undefined,timer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined;
 const next=(delta:number)=>{const value=yaw+delta;return full?(value>Math.PI?value-2*Math.PI:value< -Math.PI?value+2*Math.PI:value):Math.max(minYaw,Math.min(maxYaw,value));};
 const snapshot=():SculptureOrbitState=>({placementId:options.placementId,yaw,holding:pointer?.held?pointer.direction:undefined,reducedMotion:options.reducedMotion(),available:!disposed&&options.allowed(),canLeft:blocked!==-1&&(full||yaw>minYaw+1e-9),canRight:blocked!==1&&(full||yaw<maxYaw-1e-9),message});
 const publish=()=>{if(disposed)return;const state=snapshot(),key=JSON.stringify(state);if(key!==lastPublished){lastPublished=key;options.changed(state);}};
 const stop=()=>{generation++;if(timer!==undefined)clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);timer=undefined;frame=undefined;pointer=undefined;};
 const move=(delta:number)=>{
  if(disposed||!options.allowed())return false;
  const direction=delta<0?-1:1,value=next(delta);if(Math.abs(value-yaw)<1e-9)return false;
  let moved=false;try{moved=options.move(value);}catch{/* Keep the current safe pose. */}
  if(!moved){blocked=direction;message='이 방향의 바닥·여유 공간을 확인하지 못했어요. 현재 시점을 유지해요.';publish();return false;}
  yaw=value;blocked=undefined;message='';publish();return true;
 };
 const actions:SculptureOrbitActions={
  step(direction){stop();move(direction*SCULPTURE_ORBIT_STEP);publish();},
  press(direction,id){
   if(disposed||!options.allowed()||!Number.isFinite(id))return;
   if(pointer&&pointer.id!==id){stop();publish();return;}
   stop();const token=generation,started=performance.now();pointer={id,direction,held:false,started,last:started};
   if(!options.reducedMotion())timer=setTimeout(()=>{
    if(disposed||token!==generation||!pointer)return;
    if(!options.allowed()||options.reducedMotion()){stop();publish();return;}
    pointer.held=true;pointer.last=performance.now();publish();
    const tick=(now:number)=>{
     if(disposed||token!==generation||!pointer)return;
     if(!options.allowed()||options.reducedMotion()||now-pointer.started>=30000){stop();publish();return;}
     const dt=Math.min(.05,Math.max(0,(now-pointer.last)/1000));pointer.last=now;
     if(dt>0&&!move(pointer.direction*dt*Math.PI/12)){stop();publish();return;}
     frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
   },350);
   publish();
  },
  release(id,activate){const saved=pointer;if(!saved||saved.id!==id)return;stop();if(activate&&!saved.held)move(saved.direction*SCULPTURE_ORBIT_STEP);publish();},
  stop(){stop();publish();},
 };
 publish();
 return {actions,state:snapshot,refresh(){const nextReduced=options.reducedMotion();if(!options.allowed()||(nextReduced&&!reduced))stop();reduced=nextReduced;publish();},dispose(){stop();disposed=true;}};
}
