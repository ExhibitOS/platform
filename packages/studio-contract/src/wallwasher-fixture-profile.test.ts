// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {furnishingAsset,furnishingCatalogueEntry} from './furnishings.js';
import {MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE as profile,MUSEUM_WALLWASHER_PROFILE_IDENTITY as identity,museumWallwasherFixtureProfile} from './wallwasher-fixture-profile.js';
import {resolveWallwasherAuthoredRest,resolveWallwasherMountHead,type WasherQuaternion,type WasherPose} from './wallwasher-mount-head.js';

const ceiling={pose:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]} as WasherPose,dimensions:{width:10,height:10}};
const opticalPose:WasherPose={position:[0,3.894,-.05],rotation:[0,0,0,1],scale:[1,1,1]};
const visualPose={position:[0,.106,.05] as const,yaw:0,scale:1};
const asset=()=>furnishingAsset('11111111-1111-4111-8111-111111111111','museum-wallwasher');

it('selects the trusted rest-only profile from the current managed catalogue identity',()=>{
 expect(museumWallwasherFixtureProfile(asset())).toBe(profile);
 expect(identity.sourceQualification).toBe('authored-rest-pose-only');
});
it.each([
 {catalogId:'museum-track-spot'},{catalogVersion:2},{mime:'image/png'},
 {bytes:201736},{sha256:'0'.repeat(64)},
 {provenance:{sourceSha256:'0'.repeat(64),recipe:'omit-unused-tangent-v1'}},
 {provenance:{sourceSha256:identity.provenance.sourceSha256,recipe:'original-v1'}},
])('rejects a mismatched catalogue/model/source identity %j',change=>{
 expect(()=>museumWallwasherFixtureProfile({...asset(),...change})).toThrow('WASHER_CATALOGUE_IDENTITY_MISMATCH');
});
it('prevents a consumer from expanding pitch policy or changing trusted part bounds',()=>{
 expect(()=>{(profile.headPitchIntervals[0] as unknown as number[])[1]=Math.PI/2;}).toThrow(TypeError);
 expect(()=>{(profile.headParts[0]!.bounds.min as unknown as number[])[0]=100;}).toThrow(TypeError);
 expect(()=>resolveWallwasherMountHead({profile,mountPose:{position:[0,4,0],rotation:[0,0,0,1],scale:[1,1,1]},headPitch:.01,ceilingSurface:ceiling})).toThrow('WASHER_PITCH_NOT_APPROVED');
});
it('keeps all13 measured source parts and reproduces current catalogue bounds at flush authored rest',()=>{
 const before=JSON.stringify({profile,opticalPose,visualPose}),result=resolveWallwasherAuthoredRest({profile,opticalPose,visualPose,ceilingSurface:ceiling});
 expect(result.parts).toHaveLength(13);expect(result.fixedPose).toEqual(result.headPose);
 expect(result.aperture).toEqual(opticalPose.position);expect(result.beamDirection).toEqual([0,0,-1]);
 expect(result.mountFootprintWorld.every(p=>Math.abs(p[1]-4)<1e-12)).toBe(true);
 const source=furnishingCatalogueEntry('museum-wallwasher').bounds;
 for(let i=0;i<3;i++){
  expect(result.union.min[i]).toBeCloseTo(source.min[i]!+(i===1?4:0),12);
  expect(result.union.max[i]).toBeCloseTo(source.max[i]!+(i===1?4:0),12);
 }
 expect(JSON.stringify({profile,opticalPose,visualPose})).toBe(before);
});
it('rejects the old emitter height and tilted painting aim without rewriting source or attachment intent',()=>{
 expect(()=>resolveWallwasherAuthoredRest({profile,opticalPose:{...opticalPose,position:[0,3.8,-.05]},visualPose,ceilingSurface:ceiling})).toThrow('WASHER_MOUNT_NOT_ON_CEILING');
 const length=Math.hypot(1.49,2.3),q:WasherQuaternion=[-2.3/length/Math.SQRT2,1.49/length/Math.SQRT2,0,Math.SQRT1_2];
 const tilted={...opticalPose,position:[-2.45,3.8,2.5] as const,rotation:q},before=JSON.stringify(tilted);
 expect(()=>resolveWallwasherAuthoredRest({profile,opticalPose:tilted,visualPose,ceilingSurface:ceiling})).toThrow('WASHER_MOUNT_NOT_FLUSH');
 expect(JSON.stringify(tilted)).toBe(before);
});
