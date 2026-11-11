// SPDX-License-Identifier: AGPL-3.0-or-later
/** Pure pose algebra for explicitly admitted producer metadata. This does not
 * qualify mechanical travel, authenticate bounds, or rewrite LightAttachments.
 * Positions/bounds are metres; headPitch and approved intervals are radians.
 * Per-part bounds already include the flat GLB node's baked translation. */
export type WasherVector=readonly [number,number,number];
export type WasherQuaternion=readonly [number,number,number,number];
export type WasherPose={position:WasherVector;rotation:WasherQuaternion;scale:WasherVector};
export type WasherBounds={min:WasherVector;max:WasherVector};
export type WasherPart={name:string;bounds:WasherBounds};
export type WallwasherMountHeadProfile={
 profileId:'museum-wallwasher-fixed-head-v1'|'museum-wallwasher-rear-relief-fixed-head-v1';modelSha256:string;
 fixedParts:readonly WasherPart[];headParts:readonly WasherPart[];
 mountFootprint:readonly WasherVector[];
 opticalA:WasherVector;pivotP:WasherVector;axis:WasherVector;
 headPitchIntervals:readonly (readonly [number,number])[];
};
export type WallwasherMountHeadInput={
 profile:WallwasherMountHeadProfile;mountPose:WasherPose;headPitch:number;
 ceilingSurface:{pose:WasherPose;dimensions:{width:number;height:number}};
 expectedEmitter?:{position:WasherVector;direction:WasherVector};
};
export const WALLWASHER_MOUNT_HEAD_MODEL_SHA256='a4b66294c77e206a574905e12680148129f914d368add947f1c8831c64bf3f4d';
export const WALLWASHER_REAR_RELIEF_MOUNT_HEAD_MODEL_SHA256='7c1c7bb441031b7496c80d1bd39edb66b31346887e928ce68a0f22fbf9bf7f8f';
const fixedNames=['Track_adapter','Swivel_neck','Bracket_bridge','Bracket_arm','Bracket_arm.001','Pivot','Pivot.001'];
const headNames=['Back_panel','Black_baffle','Housing','Lower_shade','Optical_panel','Reflector'];
const fail=(code:string):never=>{throw Error(code);};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const tuple=(v:unknown,length:number):v is number[]=>Array.isArray(v)&&v.length===length&&v.every(finite);
const add=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:WasherVector,b:WasherVector)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const close=(a:WasherVector,b:WasherVector,tolerance=1e-7)=>Math.hypot(...sub(a,b))<=tolerance;
function rotate(q:WasherQuaternion,v:WasherVector):WasherVector{
 const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
 return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
function multiply(a:WasherQuaternion,b:WasherQuaternion):WasherQuaternion{
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
}
function pose(value:WasherPose):WasherPose{
 if(!value||!tuple(value.position,3)||!tuple(value.rotation,4)||!tuple(value.scale,3)||value.scale.some(n=>n!==1))return fail('WASHER_RIGID_POSE_REQUIRED');
 const norm=Math.hypot(...value.rotation);if(Math.abs(norm-1)>1e-7)return fail('WASHER_QUATERNION_INVALID');
 return {position:[value.position[0],value.position[1],value.position[2]],rotation:value.rotation.map(n=>n/norm) as unknown as WasherQuaternion,scale:[1,1,1]};
}
const point=(p:WasherPose,v:WasherVector)=>add(p.position,rotate(p.rotation,v));
const corners=(b:WasherBounds):WasherVector[]=>[b.min[0],b.max[0]].flatMap(x=>[b.min[1],b.max[1]].flatMap(y=>[b.min[2],b.max[2]].map(z=>[x,y,z] as WasherVector)));
function bounds(points:readonly WasherVector[]):WasherBounds{
 if(points.some(v=>!v.every(finite)))return fail('WASHER_TRANSFORM_NONFINITE');
 return {min:[Math.min(...points.map(v=>v[0])),Math.min(...points.map(v=>v[1])),Math.min(...points.map(v=>v[2]))],max:[Math.max(...points.map(v=>v[0])),Math.max(...points.map(v=>v[1])),Math.max(...points.map(v=>v[2]))]};
}
export function resolveWallwasherMountHead(input:WallwasherMountHeadInput){
 const profile=input?.profile;
 if(!profile||!(profile.profileId==='museum-wallwasher-fixed-head-v1'&&profile.modelSha256===WALLWASHER_MOUNT_HEAD_MODEL_SHA256||profile.profileId==='museum-wallwasher-rear-relief-fixed-head-v1'&&profile.modelSha256===WALLWASHER_REAR_RELIEF_MOUNT_HEAD_MODEL_SHA256))return fail('WASHER_PROFILE_PIN_INVALID');
 const groups=[[profile.fixedParts,fixedNames],[profile.headParts,headNames]] as const;
 for(const [parts,names]of groups){
  if(!Array.isArray(parts)||parts.length!==names.length||new Set(parts.map(p=>p?.name)).size!==names.length||parts.some(p=>!p||!names.includes(p.name)||!p.bounds||!tuple(p.bounds.min,3)||!tuple(p.bounds.max,3)||p.bounds.min.some((n:number,i:number)=>n>p.bounds.max[i]!)))return fail('WASHER_PARTITION_INVALID');
 }
 if(!tuple(profile.opticalA,3)||!tuple(profile.pivotP,3)||!tuple(profile.axis,3)||!close(profile.opticalA,[0,-.106,-.05],1e-12)||!close(profile.pivotP,[0,-.084,0],1e-12)||!close(profile.axis,[1,0,0],1e-12))return fail('WASHER_DATUM_INVALID');
 if(!finite(input.headPitch)||!Array.isArray(profile.headPitchIntervals)||!profile.headPitchIntervals.length||profile.headPitchIntervals.length>32||profile.headPitchIntervals.some(v=>!tuple(v,2)||v[0]!>v[1]!)||!profile.headPitchIntervals.some(([min,max])=>input.headPitch>=min&&input.headPitch<=max))return fail('WASHER_PITCH_NOT_APPROVED');
 const footprint=profile.mountFootprint,expected=[[-.0455,0,-.0165],[-.0455,0,.0165],[.0455,0,-.0165],[.0455,0,.0165]] as const;
 if(!Array.isArray(footprint)||footprint.length!==4||footprint.some(v=>!tuple(v,3))||expected.some(v=>footprint.filter(p=>close(p,v,1e-9)).length!==1))return fail('WASHER_MOUNT_FOOTPRINT_INVALID');
 const fixedPose=pose(input.mountPose),ceiling=pose(input.ceilingSurface?.pose),dimensions=input.ceilingSurface?.dimensions;
 if(!dimensions||!finite(dimensions.width)||!finite(dimensions.height)||dimensions.width<=0||dimensions.height<=0)return fail('WASHER_CEILING_INVALID');
 const normal=rotate(fixedPose.rotation,[0,1,0]),inward=rotate(ceiling.rotation,[0,0,1]);
 if(dot(normal,inward)>-1+1e-10)return fail('WASHER_MOUNT_NOT_FLUSH');
 const mountFootprintWorld=footprint.map(v=>point(fixedPose,v)),inverse:WasherQuaternion=[-ceiling.rotation[0],-ceiling.rotation[1],-ceiling.rotation[2],ceiling.rotation[3]];
 for(const v of mountFootprintWorld){const local=rotate(inverse,sub(v,ceiling.position));if(!local.every(finite)||Math.abs(local[2])>1e-6||Math.abs(local[0])>dimensions.width/2+1e-7||Math.abs(local[1])>dimensions.height/2+1e-7)return fail('WASHER_MOUNT_NOT_ON_CEILING');}
 const half=input.headPitch/2,rx:WasherQuaternion=[Math.sin(half),0,0,Math.cos(half)];
 const headPose:WasherPose={position:point(fixedPose,sub(profile.pivotP,rotate(rx,profile.pivotP))),rotation:multiply(fixedPose.rotation,rx),scale:[1,1,1]};
 const aperture=point(headPose,profile.opticalA),beamDirection=rotate(headPose.rotation,[0,0,-1]),pivotWorld=point(fixedPose,profile.pivotP);
 if(input.expectedEmitter!==undefined&&(!input.expectedEmitter||!tuple(input.expectedEmitter.position,3)||!tuple(input.expectedEmitter.direction,3)||!close(input.expectedEmitter.position,aperture,1e-6)||!close(input.expectedEmitter.direction,beamDirection,1e-6)))return fail('WASHER_EMITTER_MISMATCH');
 const parts=[...profile.fixedParts.map(part=>({part,pose:fixedPose})),...profile.headParts.map(part=>({part,pose:headPose}))].map(({part,pose})=>({name:part.name,bounds:bounds(corners(part.bounds).map(v=>point(pose,v)))}));
 const union=bounds(parts.flatMap(part=>[part.bounds.min,part.bounds.max]));
 if(![...aperture,...beamDirection,...pivotWorld,...headPose.position,...headPose.rotation].every(finite))return fail('WASHER_TRANSFORM_NONFINITE');
 return {fixedPose,headPose,aperture,emitter:aperture,beamDirection,pivotWorld,mountFootprintWorld,parts,union};
}

/** Static0 adapter for the CURRENT stored visual convention only. opticalPose
 * combines the stored emitter position with lightDetailsOrientation (not the
 * raw surface-attachment rotation). The canonical visual compensation remains
 * -A/yaw0/scale1. Attachment anchor/gap still describe the EMITTER; this function
 * validates the derived mount and never rewrites that stored attachment.
 * A tilted/pitched profile requires an independently defined mount frame. */
export function resolveWallwasherAuthoredRest(input:{
 profile:WallwasherMountHeadProfile;opticalPose:WasherPose;
 visualPose:{position:WasherVector;yaw:number;scale:number};
 ceilingSurface:WallwasherMountHeadInput['ceilingSurface'];
}){
 if(!input?.profile||!tuple(input.profile.opticalA,3))return fail('WASHER_PROFILE_PIN_INVALID');
 const visual=input.visualPose;
 if(!visual||!tuple(visual.position,3)||!close(visual.position,sub([0,0,0],input.profile.opticalA),1e-7)||visual.yaw!==0||visual.scale!==1)return fail('WASHER_REST_VISUAL_POSE_INVALID');
 const optical=pose(input.opticalPose);
 return resolveWallwasherMountHead({profile:input.profile,
  mountPose:{...optical,position:point(optical,visual.position)},headPitch:0,ceilingSurface:input.ceilingSurface,
  expectedEmitter:{position:optical.position,direction:rotate(optical.rotation,[0,0,-1])}});
}
