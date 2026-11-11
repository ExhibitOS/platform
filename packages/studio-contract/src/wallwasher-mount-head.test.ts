// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {resolveWallwasherMountHead as resolve,resolveWallwasherAuthoredRest as rest,WALLWASHER_MOUNT_HEAD_MODEL_SHA256 as pin,type WallwasherMountHeadInput,type WasherVector} from './wallwasher-mount-head.js';

// Synthetic part boxes qualify algebra only, never model travel or catalogue admission.
function fixture():WallwasherMountHeadInput {
 const part=(name:string)=>({name,bounds:{min:[-.01,-.12,-.05] as WasherVector,max:[.01,-.02,.01] as WasherVector}});
 return {profile:{profileId:'museum-wallwasher-fixed-head-v1',modelSha256:pin,
  fixedParts:['Track_adapter','Swivel_neck','Bracket_bridge','Bracket_arm','Bracket_arm.001','Pivot','Pivot.001'].map(part),
  headParts:['Back_panel','Black_baffle','Housing','Lower_shade','Optical_panel','Reflector'].map(part),
  mountFootprint:[[-.0455,0,-.0165],[-.0455,0,.0165],[.0455,0,-.0165],[.0455,0,.0165]],
  opticalA:[0,-.106,-.05],pivotP:[0,-.084,0],axis:[1,0,0],headPitchIntervals:[[0,0]]},
  mountPose:{position:[-2.45,4,2.5],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]},headPitch:0,
  ceilingSurface:{pose:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]},dimensions:{width:12,height:8}}};
}
test('authored rest preserves all parts and the pivot while ceiling contact fixes emitter height',()=>{
 const input=fixture(),before=structuredClone(input),r=resolve(input);
 expect(r.parts).toHaveLength(13);expect(r.headPose).toEqual(r.fixedPose);
 expect(r.emitter[1]).toBeCloseTo(3.894,10);expect(r.pivotWorld).toEqual([-2.45,3.916,2.5]);
 for(const p of r.mountFootprintWorld)expect(p[1]).toBeCloseTo(4,10);
 for(let axis=0;axis<3;axis++){
  expect(r.union.min[axis]).toEqual(Math.min(...r.parts.map(p=>p.bounds.min[axis]!)));
  expect(r.union.max[axis]).toEqual(Math.max(...r.parts.map(p=>p.bounds.max[axis]!)));
 }
 expect(input).toEqual(before);
});
test('tilt separates head from mount only when an explicit synthetic interval admits it',()=>{
 const input=fixture();input.headPitch=-57.0637808*Math.PI/180;
 expect(()=>resolve(input)).toThrow('WASHER_PITCH_NOT_APPROVED');
 input.profile.headPitchIntervals=[[input.headPitch,input.headPitch]];
 const r=resolve(input);
 expect(r.emitter[0]).toBeCloseTo(-2.458721176,8);expect(r.emitter[1]).toBeCloseTo(3.862074671,8);
 expect(r.pivotWorld).toEqual([-2.45,3.916,2.5]);expect(r.headPose).not.toEqual(r.fixedPose);
 for(const p of r.mountFootprintWorld)expect(p[1]).toBeCloseTo(4,10);
});
test('existing emitter mismatch refuses silent relocation and tilted whole-body mounting',()=>{
 const input=fixture(),r=resolve(input);
 expect(resolve({...input,expectedEmitter:{position:r.emitter,direction:r.beamDirection}})).toEqual(r);
 expect(()=>resolve({...input,expectedEmitter:{position:[-2.45,3.8,2.5],direction:r.beamDirection}})).toThrow('WASHER_EMITTER_MISMATCH');
 const a=72.8056*Math.PI/180;
 expect(()=>resolve({...input,mountPose:{...input.mountPose,rotation:[Math.sin(a/2),0,0,Math.cos(a/2)]}})).toThrow('WASHER_MOUNT_NOT_FLUSH');
});
test('pins, partition, interval, rigid pose and bounded ceiling reject unsupported inputs',()=>{
 const changes:Array<(v:WallwasherMountHeadInput)=>void>=[
  v=>{v.profile.modelSha256='0'.repeat(64);},v=>{v.mountPose.scale=[1,2,1];},v=>{v.mountPose.rotation=[0,0,0,2];},
  v=>{v.profile.headPitchIntervals=[];},v=>{v.profile.headPitchIntervals=[[NaN,1]];},
  v=>{v.profile.fixedParts[0]!.name='Housing';},v=>{v.profile.headParts[0]!.name=v.profile.headParts[1]!.name;},
  v=>{v.profile.pivotP=[0,-.08,0];},v=>{v.mountPose.position=[-2.45,3.8,2.5];},
  v=>{v.ceilingSurface.dimensions.width=.01;},
 ];
 for(const change of changes){const input=fixture();change(input);expect(()=>resolve(input)).toThrow();}
});

test('current authored-rest visual maps through the resolved optical frame, never the attachment base frame',()=>{
 const input=fixture(),r=resolve(input),stored={profile:input.profile,opticalPose:{position:r.emitter,rotation:input.mountPose.rotation,scale:[1,1,1] as WasherVector},
  visualPose:{position:[0,.106,.05] as WasherVector,yaw:0,scale:1},ceilingSurface:input.ceilingSurface};
 expect(rest(stored)).toEqual(r);
 expect(()=>rest({...stored,opticalPose:{...stored.opticalPose,position:[-2.45,3.8,2.5]}})).toThrow('WASHER_MOUNT_NOT_ON_CEILING');
 // Existing ceiling attachment is S*Ry(pi): an optical base, not adapter-up.
 const q=Math.SQRT1_2;
 expect(()=>rest({...stored,opticalPose:{...stored.opticalPose,rotation:[0,q,q,0]}})).toThrow('WASHER_MOUNT_NOT_FLUSH');
 expect(()=>rest({...stored,visualPose:{...stored.visualPose,yaw:.1}})).toThrow('WASHER_REST_VISUAL_POSE_INVALID');
});
