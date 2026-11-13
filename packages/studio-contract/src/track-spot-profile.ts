// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WallwasherMountHeadProfile,WasherPart,WasherVector} from './wallwasher-mount-head.js';
import type {WallwasherFixtureAssetIdentity} from './wallwasher-fixture-profile.js';
const v=(x:number,y:number,z:number):WasherVector=>Object.freeze([x,y,z] as const);
const part=(name:string,min:WasherVector,max:WasherVector):WasherPart=>Object.freeze({name,bounds:Object.freeze({min,max})});
/** Exactly one independently checked static source pose, not joint travel. */
export const MUSEUM_TRACK_SPOT_STATIC_PITCH=-Math.PI/4;
export const MUSEUM_TRACK_SPOT_PROFILE:Readonly<WallwasherMountHeadProfile>=Object.freeze({
 profileId:'museum-track-spot-fixed-head-v1',
 modelSha256:'4385cd058231a400b0e1bffd1f107ca3b0c7281a41671a8858f8fa7ed3721f90',
 fixedParts:Object.freeze([
  part("Adapter_key",v(-0.0275,-0.002,-0.006),v(0.0275,0.0,0.006)),
  part("Adapter_neck",v(-0.017000001,-0.040000002,-0.013),v(0.017000001,-0.024000001,0.013)),
  part("Pivot_bearing",v(-0.059999999,-0.159999996,-0.01),v(-0.041999999,-0.140000001,0.01)),
  part("Pivot_bearing.001",v(0.041999999,-0.159999996,-0.01),v(0.059999999,-0.140000001,0.01)),
  part("Stem",v(-0.009,-0.065000001,-0.009),v(0.009,-0.039000001,0.009)),
  part("Track_adapter",v(-0.047499999,-0.024,-0.018999999),v(0.047499999,0.0,0.018999999)),
  part("Yoke_arm",v(-0.054999999,-0.147000004,-0.0075),v(-0.046999999,-0.069000002,0.0075)),
  part("Yoke_arm.001",v(0.046999999,-0.147000004,-0.0075),v(0.054999999,-0.069000002,0.0075)),
  part("Yoke_bridge",v(-0.054000001,-0.074000004,-0.0075),v(0.054000001,-0.062000004,0.0075)),
 ]),
 headParts:Object.freeze([
  part("Front_retaining_ring",v(-0.0405,-0.190500006,-0.075499997),v(0.0405,-0.109499998,-0.075000003)),
  part("Housing_spun_shell",v(-0.0425,-0.192499995,-0.075000003),v(0.0425,-0.107500002,0.075000003)),
  part("Lens_opaque",v(-0.017000001,-0.166999996,-0.028999999),v(0.017000001,-0.133000001,-0.028999999)),
  part("Recessed_baffle",v(-0.0363,-0.186299995,-0.064000003),v(0.0363,-0.113700002,-0.043000001)),
  part("Reflector_cup",v(-0.028000001,-0.178000003,-0.043000001),v(0.028000001,-0.122000001,-0.028000001)),
 ]),
 mountFootprint:Object.freeze([v(-.047499999,0,-.018999999),v(-.047499999,0,.018999999),v(.047499999,0,-.018999999),v(.047499999,0,.018999999)]),
 opticalA:v(0,-.150,-.0755),pivotP:v(0,-.150,0),axis:v(1,0,0),
 headPitchIntervals:Object.freeze([Object.freeze([MUSEUM_TRACK_SPOT_STATIC_PITCH,MUSEUM_TRACK_SPOT_STATIC_PITCH] as const)]),
});
export const MUSEUM_TRACK_SPOT_IDENTITY=Object.freeze({catalogId:'museum-track-spot',catalogVersion:1,mime:'model/gltf-binary',bytes:257676,sha256:MUSEUM_TRACK_SPOT_PROFILE.modelSha256,provenance:Object.freeze({sourceSha256:MUSEUM_TRACK_SPOT_PROFILE.modelSha256,recipe:'original-v1'})} as const);
/** Named fixture qualification only; ordinary rail originals use measured fit,
 * never this catalogue model identity as an intake eligibility condition. */
export function museumTrackSpotProfile(asset:WallwasherFixtureAssetIdentity):Readonly<WallwasherMountHeadProfile>{
 const e=MUSEUM_TRACK_SPOT_IDENTITY;
 if(!asset||asset.catalogId!==e.catalogId||asset.catalogVersion!==e.catalogVersion||asset.mime!==e.mime||asset.bytes!==e.bytes||asset.sha256!==e.sha256||asset.provenance?.sourceSha256!==e.provenance.sourceSha256||asset.provenance?.recipe!==e.provenance.recipe)throw Error('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 return MUSEUM_TRACK_SPOT_PROFILE;
}
