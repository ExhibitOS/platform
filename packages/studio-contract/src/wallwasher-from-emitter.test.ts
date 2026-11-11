// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {resolveWallwasherFromEmitter as resolve,type WallwasherFromEmitterInput} from './wallwasher-from-emitter.js';
import {resolveWallwasherMountHead,WALLWASHER_REAR_RELIEF_MOUNT_HEAD_MODEL_SHA256 as pin,type WasherVector,type WasherQuaternion} from './wallwasher-mount-head.js';
const theta=-1.010421379883632;
function fixture():WallwasherFromEmitterInput{
 const part=(name:string)=>({name,bounds:{min:[-.01,-.12,-.05] as WasherVector,max:[.01,-.02,.01] as WasherVector}});
 return {profile:{profileId:'museum-wallwasher-rear-relief-fixed-head-v1',modelSha256:pin,
  fixedParts:['Track_adapter','Swivel_neck','Bracket_bridge','Bracket_arm','Bracket_arm.001','Pivot','Pivot.001'].map(part),
  headParts:['Back_panel','Black_baffle','Housing','Lower_shade','Optical_panel','Reflector'].map(part),
  mountFootprint:[[-.0455,0,-.0165],[-.0455,0,.0165],[.0455,0,-.0165],[.0455,0,.0165]],
  opticalA:[0,-.106,-.05],pivotP:[0,-.084,0],axis:[1,0,0],headPitchIntervals:[[0,0],[theta,theta]]},
  opticalPose:{position:[-2.5,3.894,2.5],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]},
  ceilingSurface:{pose:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]},dimensions:{width:8,height:10}}};
}
const vectorClose=(actual:WasherVector,expected:WasherVector)=>{for(let i=0;i<3;i++)expect(actual[i]).toBeCloseTo(expected[i]!,12);};
const multiply=(a:WasherQuaternion,b:WasherQuaternion):WasherQuaternion=>{
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
};
test('canonical rest recovers a flush mount without mutating the emitter or metadata',()=>{
 const input=fixture(),before=structuredClone(input),r=resolve(input);
 expect(r.headPitch).toBe(0);vectorClose(r.fixedPose.position,[-2.45,4,2.5]);
 vectorClose(r.emitter,input.opticalPose.position);expect(r.headPose).toEqual(r.fixedPose);
 for(const v of r.mountFootprintWorld)expect(v[1]).toBeCloseTo(4,12);
 expect(input).toEqual(before);expect(r.parts).toHaveLength(13);
});
test('Painting emitter recovers only its admitted static head pitch, independent of optical roll',()=>{
 const input=fixture(),head:WasherQuaternion=[-.3422338979915954,.6187697140822893,.3422338979915954,.6187697140822893];
 input.opticalPose={...input.opticalPose,position:[-2.457939962346657,3.8619541213603323,2.5],rotation:multiply(head,[0,0,Math.sin(.3),Math.cos(.3)])};
 const r=resolve(input);
 expect(r.headPitch).toBe(theta);vectorClose(r.fixedPose.position,[-2.45,4,2.5]);
 vectorClose(r.emitter,input.opticalPose.position);vectorClose(r.beamDirection,[-.5315038362619127,-.8470558848381075,0]);
 expect(r.headPose.rotation).not.toEqual(input.opticalPose.rotation);
 const target:WasherVector=[-3.94,1.5,2.5],distance=2.7884277337991175;
 vectorClose(r.emitter.map((n,i)=>n+distance*r.beamDirection[i]!) as unknown as WasherVector,target);
 const expected=resolveWallwasherMountHead({profile:input.profile,mountPose:{position:[-2.45,4,2.5],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]},headPitch:theta,ceilingSurface:input.ceilingSurface});
 vectorClose(r.union.min,expected.union.min);vectorClose(r.union.max,expected.union.max);
});
test('yaw quadrants recover the same mount and bounds through the shared resolver',()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const input=fixture(),mountPose={position:[0,4,0] as WasherVector,rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)] as WasherQuaternion,scale:[1,1,1] as WasherVector};
  const expected=resolveWallwasherMountHead({profile:input.profile,mountPose,headPitch:theta,ceilingSurface:input.ceilingSurface});
  input.opticalPose={position:expected.emitter,rotation:expected.headPose.rotation,scale:[1,1,1]};
  const r=resolve(input);vectorClose(r.fixedPose.position,mountPose.position);vectorClose(r.union.min,expected.union.min);vectorClose(r.union.max,expected.union.max);
 }
});
test('ceiling-local rigid frames recover the mount without assuming room-up',()=>{
 for(const rotation of [[1,0,0,0],[0,0,1,0],[Math.sin(.35),0,0,Math.cos(.35)]] as WasherQuaternion[]){
  const input=fixture(),mountPose={position:[0,4,0] as WasherVector,rotation,scale:[1,1,1] as WasherVector};
  input.ceilingSurface.pose={...mountPose,rotation:multiply(rotation,[Math.SQRT1_2,0,0,Math.SQRT1_2])};
  const expected=resolveWallwasherMountHead({profile:input.profile,mountPose,headPitch:theta,ceilingSurface:input.ceilingSurface});
  input.opticalPose={position:expected.emitter,rotation:expected.headPose.rotation,scale:[1,1,1]};
  const r=resolve(input);vectorClose(r.fixedPose.position,mountPose.position);vectorClose(r.union.min,expected.union.min);vectorClose(r.union.max,expected.union.max);
 }
});
test('continuous intervals, unsupported directions and ambiguous singleton pitches fail closed',()=>{
 const input=fixture();
 expect(()=>resolve({...input,profile:{...input.profile,headPitchIntervals:[[theta,0]]}})).toThrow('WASHER_SINGLETON_PITCH_REQUIRED');
 expect(()=>resolve({...input,opticalPose:{...input.opticalPose,rotation:[Math.sin(-.25),0,0,Math.cos(-.25)]}})).toThrow('WASHER_PITCH_NOT_APPROVED');
 for(const intervals of [[[0,0],[0,0]],[[0,0],[2*Math.PI,2*Math.PI]]] as const){
  expect(()=>resolve({...input,profile:{...input.profile,headPitchIntervals:intervals}})).toThrow('WASHER_EMITTER_PITCH_AMBIGUOUS');
 }
 expect(()=>resolve({...input,profile:{...input.profile,headPitchIntervals:[[NaN,NaN]]}})).toThrow('WASHER_SINGLETON_PITCH_REQUIRED');
 const vertical=fixture();vertical.opticalPose.rotation=[-Math.SQRT1_2,0,0,Math.SQRT1_2];vertical.profile.headPitchIntervals=[[-Math.PI/2,-Math.PI/2]];
 expect(()=>resolve(vertical)).toThrow('WASHER_PITCH_NOT_APPROVED');
});
test('off-ceiling, out-of-footprint and invalid rigid inputs cannot relocate the emitter to fit',()=>{
 const input=fixture();
 expect(()=>resolve({...input,opticalPose:{...input.opticalPose,position:[-2.5,3.884,2.5]}})).toThrow('WASHER_MOUNT_NOT_ON_CEILING');
 expect(()=>resolve({...input,ceilingSurface:{...input.ceilingSurface,dimensions:{width:.01,height:.01}}})).toThrow('WASHER_MOUNT_NOT_ON_CEILING');
 expect(()=>resolve({...input,opticalPose:{...input.opticalPose,scale:[1,2,1]}})).toThrow('WASHER_RIGID_POSE_REQUIRED');
 expect(()=>resolve({...input,ceilingSurface:{...input.ceilingSurface,pose:{...input.ceilingSurface.pose,scale:[2,2,2]}}})).toThrow('WASHER_RIGID_POSE_REQUIRED');
 expect(()=>resolve({...input,opticalPose:{...input.opticalPose,rotation:[0,0,0,2]}})).toThrow('WASHER_QUATERNION_INVALID');
 expect(()=>resolve({...input,profile:{...input.profile,modelSha256:'0'.repeat(64)}})).toThrow('WASHER_PROFILE_PIN_INVALID');
});
