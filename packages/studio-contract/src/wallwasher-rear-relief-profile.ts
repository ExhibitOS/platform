// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WallwasherMountHeadProfile,WasherPart,WasherVector} from './wallwasher-mount-head.js';
import type {WallwasherFixtureAssetIdentity} from './wallwasher-fixture-profile.js';

const v=(x:number,y:number,z:number):WasherVector=>Object.freeze([x,y,z] as const);
const part=(name:string,min:WasherVector,max:WasherVector):WasherPart=>Object.freeze({name,bounds:Object.freeze({min,max})});
/** One independently checked static pose, in radians. Intermediate angles and
 * continuous travel are not qualified by the two-pose geometry evidence. */
export const MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH=-57.892880597116964*Math.PI/180;
/** Exact managed rear-relief geometry. Actual FLOAT32 POSITION bounds include
 * each flat node's authored translation ONCE. The adapter footprint is its top
 * contact face. This is separate from the original a4b rest-only profile;
 * it does not activate a catalogue, admit a candidate or certify physical fit. */
export const MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE:Readonly<WallwasherMountHeadProfile>=Object.freeze({
 profileId:'museum-wallwasher-rear-relief-fixed-head-v1',
 modelSha256:'7c1c7bb441031b7496c80d1bd39edb66b31346887e928ce68a0f22fbf9bf7f8f',
 fixedParts:Object.freeze([
  part("Track_adapter",v(-0.04699999839067459,-0.02199999988079071,-0.017999999225139618),v(0.04699999839067459,0.0,0.017999999225139618)),
  part("Swivel_neck",v(-0.013500000350177288,-0.03599999938160181,-0.012000000104308128),v(0.013500000350177288,-0.021999998949468136,0.012000000104308128)),
  part("Bracket_bridge",v(-0.11800000071525574,-0.049999999813735485,-0.007000000216066837),v(0.11800000071525574,-0.03799999970942736,0.007000000216066837)),
  part("Bracket_arm",v(-0.11800000024959445,-0.08349999785423279,-0.007000000216066837),v(-0.10999999986961484,-0.04649999737739563,0.007000000216066837)),
  part("Bracket_arm.001",v(0.10999999986961484,-0.08349999785423279,-0.007000000216066837),v(0.11800000024959445,-0.04649999737739563,0.007000000216066837)),
  part("Pivot",v(-0.12099999934434891,-0.09200000017881393,-0.00800000037997961),v(-0.10700000077486038,-0.07599999755620956,0.00800000037997961)),
  part("Pivot.001",v(0.10700000077486038,-0.09200000017881393,-0.00800000037997961),v(0.12099999934434891,-0.07599999755620956,0.00800000037997961)),
 ]),
 headParts:Object.freeze([
  part("Back_panel",v(-0.1080000028014183,-0.14749999716877937,0.047999998671002686),v(0.1080000028014183,-0.07799999974668026,0.04999999876599759)),
  part("Black_baffle",v(-0.09300000220537186,-0.1340000033378601,-0.04800000041723251),v(0.09300000220537186,-0.07800000160932541,-0.027000000700354576)),
  part("Housing",v(-0.10999999940395355,-0.15000000596046448,-0.05000000074505806),v(0.10999999940395355,-0.06199999898672104,0.05000000074505806)),
  part("Lower_shade",v(-0.09350000321865082,-0.1384999945294112,-0.052999999141320586),v(0.09350000321865082,-0.13549999450333416,-0.04899999895133078)),
  part("Optical_panel",v(-0.07000000029802322,-0.11799999885261059,-0.015000000479631126),v(0.07000000029802322,-0.09399999864399433,-0.013000000384636223)),
  part("Reflector",v(-0.08100000023841858,-0.125,-0.027000000700354576),v(0.08100000023841858,-0.08699999749660492,-0.014999999664723873)),
 ]),
 mountFootprint:Object.freeze([v(-0.045499999076128006,0,-0.016499999910593033),v(-0.045499999076128006,0,0.016499999910593033),v(0.045499999076128006,0,-0.016499999910593033),v(0.045499999076128006,0,0.016499999910593033)]),
 opticalA:v(0,-.106,-.05),pivotP:v(0,-.084,0),axis:v(1,0,0),
 headPitchIntervals:Object.freeze([
  Object.freeze([MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH,MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH] as const),
  Object.freeze([0,0] as const),
 ]),
});
export const MUSEUM_WALLWASHER_REAR_RELIEF_IDENTITY=Object.freeze({
 profileId:MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE.profileId,
 catalogId:'museum-wallwasher-rear-relief',catalogVersion:1,hostKind:'light',
 mime:'model/gltf-binary',bytes:203836,
 sha256:MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE.modelSha256,
 provenance:Object.freeze({sourceSha256:'6c77c618f040e673edbc1ffbd67f48c79deed6d11286474830b12d9cd6ba0823',recipe:'omit-unused-tangent-v1'}),
 sourceQualification:'two-static-poses-only',
} as const);
/** Select trusted geometry only AFTER full asset/document admission. This exact
 * identity check is not rights, byte, host or stored-candidate admission. Caller
 * geometry and angle policy never replace the immutable source data. */
export function museumWallwasherRearReliefProfile(asset:WallwasherFixtureAssetIdentity):Readonly<WallwasherMountHeadProfile>{
 const expected=MUSEUM_WALLWASHER_REAR_RELIEF_IDENTITY;
 if(!asset||asset.catalogId!==expected.catalogId||asset.catalogVersion!==expected.catalogVersion||asset.mime!==expected.mime||asset.bytes!==expected.bytes||asset.sha256!==expected.sha256||asset.provenance?.sourceSha256!==expected.provenance.sourceSha256||asset.provenance?.recipe!==expected.provenance.recipe)throw Error('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 return MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE;
}
