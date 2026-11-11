// SPDX-License-Identifier: AGPL-3.0-or-later
import {resolveWallwasherMountHead,type WallwasherMountHeadProfile,type WallwasherMountHeadInput,type WasherPose,type WasherQuaternion,type WasherVector} from './wallwasher-mount-head.js';

export type WallwasherFromEmitterInput={
 profile:WallwasherMountHeadProfile;
 opticalPose:WasherPose;
 ceilingSurface:WallwasherMountHeadInput['ceilingSurface'];
};
const fail=(code:string):never=>{throw Error(code);};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const tuple=(v:unknown,length:number):v is number[]=>Array.isArray(v)&&v.length===length&&v.every(finite);
const add=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a:WasherVector,s:number):WasherVector=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:WasherVector,b:WasherVector)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:WasherVector,b:WasherVector):WasherVector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(v:WasherVector):WasherVector{
 const length=Math.hypot(...v);
 if(!finite(length)||length<=1e-7)return fail('WASHER_EMITTER_FRAME_SINGULAR');
 return scale(v,1/length);
}
function rigid(value:WasherPose):WasherPose{
 if(!value||!tuple(value.position,3)||!tuple(value.rotation,4)||!tuple(value.scale,3)||value.scale.some(n=>n!==1))return fail('WASHER_RIGID_POSE_REQUIRED');
 const length=Math.hypot(...value.rotation);
 if(Math.abs(length-1)>1e-7)return fail('WASHER_QUATERNION_INVALID');
 return {...value,rotation:value.rotation.map(n=>n/length) as unknown as WasherQuaternion};
}
function rotate(q:WasherQuaternion,v:WasherVector):WasherVector{
 const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
 return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
// Right-handed orthonormal basis columns -> normalized quaternion.
function quaternion(x:WasherVector,y:WasherVector,z:WasherVector):WasherQuaternion{
 const trace=x[0]+y[1]+z[2];let q:WasherQuaternion;
 if(trace>0){const s=2*Math.sqrt(trace+1);q=[(y[2]-z[1])/s,(z[0]-x[2])/s,(x[1]-y[0])/s,s/4];}
 else if(x[0]>y[1]&&x[0]>z[2]){const s=2*Math.sqrt(1+x[0]-y[1]-z[2]);q=[s/4,(y[0]+x[1])/s,(z[0]+x[2])/s,(y[2]-z[1])/s];}
 else if(y[1]>z[2]){const s=2*Math.sqrt(1+y[1]-x[0]-z[2]);q=[(y[0]+x[1])/s,s/4,(z[1]+y[2])/s,(z[0]-x[2])/s];}
 else{const s=2*Math.sqrt(1+z[2]-x[0]-y[1]);q=[(z[0]+x[2])/s,(z[1]+y[2])/s,s/4,(x[1]-y[0])/s];}
 const length=Math.hypot(...q);
 return q.map(n=>n/length) as unknown as WasherQuaternion;
}

/** Room-local rigid inverse for already admitted producer data. Only unique
 * singleton pitches are eligible; this neither admits a profile nor invents
 * travel between its static poses. opticalPose supplies effective -Z direction,
 * not a required head roll. The existing resolver verifies the unchanged
 * emitter/direction, ceiling footprint, identity, partition and datums. */
export function resolveWallwasherFromEmitter(input:WallwasherFromEmitterInput){
 const optical=rigid(input?.opticalPose),surface=rigid(input?.ceilingSurface?.pose),profile=input?.profile;
 const intervals=profile?.headPitchIntervals;
 if(!Array.isArray(intervals)||!intervals.length||intervals.length>32||intervals.some(v=>!tuple(v,2)||v[0]!==v[1]))return fail('WASHER_SINGLETON_PITCH_REQUIRED');
 const up=unit(scale(rotate(surface.rotation,[0,0,1]),-1)),direction=unit(rotate(optical.rotation,[0,0,-1]));
 const vertical=dot(direction,up);
 // Dimensionless 1e-7 direction tolerance; reject near-vertical singular frames.
 const candidates=intervals.map(([theta])=>theta).filter(theta=>Math.cos(theta)>1e-7&&Math.abs(Math.sin(theta)-vertical)<=1e-7);
 if(!candidates.length)return fail('WASHER_PITCH_NOT_APPROVED');
 if(candidates.length!==1)return fail('WASHER_EMITTER_PITCH_AMBIGUOUS');
 const headPitch=candidates[0]!,s=Math.sin(headPitch),c=Math.cos(headPitch);
 const projected=scale(sub(scale(up,s),direction),1/c);
 const x=unit(cross(up,projected)),z=unit(cross(x,up)),rotation=quaternion(x,up,z);
 if(!tuple(profile.opticalA,3)||!tuple(profile.pivotP,3))return fail('WASHER_DATUM_INVALID');
 const rx:WasherQuaternion=[Math.sin(headPitch/2),0,0,Math.cos(headPitch/2)];
 const offset=add(profile.pivotP,rotate(rx,sub(profile.opticalA,profile.pivotP)));
 const mountPose:WasherPose={position:sub(optical.position,rotate(rotation,offset)),rotation,scale:[1,1,1]};
 return {headPitch,...resolveWallwasherMountHead({profile,mountPose,headPitch,ceilingSurface:input.ceilingSurface,expectedEmitter:{position:optical.position,direction}})};
}
