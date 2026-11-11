// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE as profile,MUSEUM_WALLWASHER_REAR_RELIEF_IDENTITY as identity,MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH as pitch,museumWallwasherRearReliefProfile} from './wallwasher-rear-relief-profile.js';
import {MUSEUM_WALLWASHER_PROFILE_IDENTITY as originalIdentity,MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE as originalProfile,museumWallwasherFixtureProfile} from './wallwasher-fixture-profile.js';
import {resolveWallwasherMountHead,type WasherPose} from './wallwasher-mount-head.js';

// Synthetic identity input: this new catalogue ID is not activated by this unit.
const asset=()=>({...identity,provenance:{...identity.provenance}});
const mount:WasherPose={position:[-2.45,4,2.5],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]};
const ceiling={pose:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]} as WasherPose,dimensions:{width:10,height:10}};
const resolve=(headPitch:number)=>resolveWallwasherMountHead({profile,mountPose:mount,headPitch,ceilingSurface:ceiling});

it('selects only the exact managed variant without inheriting the original profile',()=>{
 expect(museumWallwasherRearReliefProfile(asset())).toBe(profile);
 expect(profile).not.toBe(originalProfile);
 expect(identity.sourceQualification).toBe('two-static-poses-only');
 expect(()=>museumWallwasherRearReliefProfile(originalIdentity)).toThrow('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 expect(()=>museumWallwasherFixtureProfile(asset())).toThrow('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 expect(originalProfile.headPitchIntervals).toEqual([[0,0]]);
});
it.each([
 {catalogId:'museum-wallwasher'},{catalogVersion:2},{mime:'image/png'},
 {bytes:203848},{sha256:originalIdentity.sha256},
 {provenance:{sourceSha256:originalIdentity.provenance.sourceSha256,recipe:identity.provenance.recipe}},
 {provenance:{sourceSha256:identity.provenance.sourceSha256,recipe:'omit-unused-invalid-tangent-r1'}},
])('rejects changed asset identity %j',change=>{
 expect(()=>museumWallwasherRearReliefProfile({...asset(),...change})).toThrow('WASHER_CATALOGUE_IDENTITY_MISMATCH');
});
it('uses the trusted constant even when the caller supplies geometry or angle policy',()=>{
 expect(museumWallwasherRearReliefProfile({...asset(),headPitchIntervals:[[-Math.PI,Math.PI]],headParts:[]} as ReturnType<typeof asset>)).toBe(profile);
});
it('deep-freezes every nested geometry and pitch-policy object',()=>{
 const assertFrozen=(value:unknown):void=>{
  if(value&&typeof value==='object'){expect(Object.isFrozen(value)).toBe(true);for(const child of Object.values(value))assertFrozen(child);}
 };
 assertFrozen(profile);assertFrozen(identity);
 expect(()=>{(profile.headPitchIntervals[0] as unknown as number[])[1]=0;}).toThrow(TypeError);
 expect(()=>{(profile.headParts[0]!.bounds.max as unknown as number[])[1]=0;}).toThrow(TypeError);
});
it('retains the measured changed Back_panel bound and exact 13-part partition',()=>{
 expect(profile.fixedParts.map(p=>p.name)).toEqual(['Track_adapter','Swivel_neck','Bracket_bridge','Bracket_arm','Bracket_arm.001','Pivot','Pivot.001']);
 expect(profile.headParts.map(p=>p.name)).toEqual(['Back_panel','Black_baffle','Housing','Lower_shade','Optical_panel','Reflector']);
 expect(profile.headParts[0]!.bounds.max[1]).toBe(-0.07799999974668026);
 expect(profile.headParts[0]!.bounds.max[1]).not.toBe(originalProfile.headParts[0]!.bounds.max[1]);
});
it.each([pitch,0])('resolves only the independently checked static pose %s without input mutation',headPitch=>{
 const before=JSON.stringify({profile,mount,ceiling}),result=resolve(headPitch);
 expect(result.parts).toHaveLength(13);
 expect(result.mountFootprintWorld.every(p=>Math.abs(p[1]-4)<1e-12)).toBe(true);
 expect(result.pivotWorld).toEqual([-2.45,3.916,2.5]);
 if(headPitch===0)expect(result.fixedPose).toEqual(result.headPose);
 expect(JSON.stringify({profile,mount,ceiling})).toBe(before);
});
it('reproduces the pinned painting emitter and target ray at the single tilted pose',()=>{
 const result=resolve(pitch),expected=[-2.457939962346657,3.8619541213603323,2.5];
 for(let i=0;i<3;i++)expect(result.emitter[i]).toBeCloseTo(expected[i]!,12);
 const target=[-3.94,1.5,2.5],distance=Math.hypot(...target.map((x,i)=>x-result.emitter[i]!));
 for(let i=0;i<3;i++)expect(result.emitter[i]!+result.beamDirection[i]!*distance).toBeCloseTo(target[i]!,12);
});
it.each([pitch/2,pitch-1e-12,pitch+1e-12,-.01,.01])('rejects unqualified intermediate or adjacent pitch %s',headPitch=>{
 expect(()=>resolve(headPitch)).toThrow('WASHER_PITCH_NOT_APPROVED');
});
