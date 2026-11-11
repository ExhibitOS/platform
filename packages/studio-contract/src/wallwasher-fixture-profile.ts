// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WallwasherMountHeadProfile,WasherPart,WasherVector} from './wallwasher-mount-head.js';

const v=(x:number,y:number,z:number):WasherVector=>Object.freeze([x,y,z] as const);
const part=(name:string,min:WasherVector,max:WasherVector):WasherPart=>Object.freeze({name,bounds:Object.freeze({min,max})});
/** Immutable source geometry for the exact managed model. Bounds include each
 * flat source node's authored translation ONCE. The adapter footprint is its
 * measured top contact face, not the larger beveled adapter bounding box.
 * Only the authored rest pose is qualified; no mechanical travel is inferred.
 * This data does not activate a catalogue or admit an exhibition candidate. */
export const MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE:Readonly<WallwasherMountHeadProfile>=Object.freeze({
 profileId:'museum-wallwasher-fixed-head-v1',
 modelSha256:'a4b66294c77e206a574905e12680148129f914d368add947f1c8831c64bf3f4d',
 fixedParts:Object.freeze([
  part("Track_adapter",v(-0.04699999839067459,-0.02199999988079071,-0.017999999225139618),v(0.04699999839067459,0.0,0.017999999225139618)),
  part("Swivel_neck",v(-0.013500000350177288,-0.03599999938160181,-0.012000000104308128),v(0.013500000350177288,-0.021999998949468136,0.012000000104308128)),
  part("Bracket_bridge",v(-0.11800000071525574,-0.049999999813735485,-0.007000000216066837),v(0.11800000071525574,-0.03799999970942736,0.007000000216066837)),
  part("Bracket_arm",v(-0.11800000024959445,-0.08349999785423279,-0.007000000216066837),v(-0.10999999986961484,-0.04649999737739563,0.007000000216066837)),
  part("Bracket_arm.001",v(0.10999999986961484,-0.08349999785423279,-0.007000000216066837),v(0.11800000024959445,-0.04649999737739563,0.007000000216066837)),
  part("Pivot",v(-0.12099999934434891,-0.09200000017881393,-0.00800000037997961),v(-0.10700000077486038,-0.07599999755620956,0.00800000037997961)),
  part("Pivot.001",v(0.10700000077486038,-0.09200000017881393,-0.00800000037997961),v(0.12099999934434891,-0.07599999755620956,0.00800000037997961))
 ]),
 headParts:Object.freeze([
  part("Back_panel",v(-0.1080000028014183,-0.14749999716877937,0.047999998671002686),v(0.1080000028014183,-0.06450000032782555,0.04999999876599759)),
  part("Black_baffle",v(-0.09300000220537186,-0.1340000033378601,-0.04800000041723251),v(0.09300000220537186,-0.07800000160932541,-0.027000000700354576)),
  part("Housing",v(-0.10999999940395355,-0.15000000596046448,-0.05000000074505806),v(0.10999999940395355,-0.06199999898672104,0.05000000074505806)),
  part("Lower_shade",v(-0.09350000321865082,-0.1384999945294112,-0.052999999141320586),v(0.09350000321865082,-0.13549999450333416,-0.04899999895133078)),
  part("Optical_panel",v(-0.07000000029802322,-0.11799999885261059,-0.015000000479631126),v(0.07000000029802322,-0.09399999864399433,-0.013000000384636223)),
  part("Reflector",v(-0.08100000023841858,-0.125,-0.027000000700354576),v(0.08100000023841858,-0.08699999749660492,-0.014999999664723873))
 ]),
 mountFootprint:Object.freeze([v(-0.045499999076128006,0.0,-0.016499999910593033),v(-0.045499999076128006,0.0,0.016499999910593033),v(0.045499999076128006,0.0,-0.016499999910593033),v(0.045499999076128006,0.0,0.016499999910593033)]),
 opticalA:v(0,-.106,-.05),pivotP:v(0,-.084,0),axis:v(1,0,0),
 headPitchIntervals:Object.freeze([Object.freeze([0,0] as const)]),
});
export const MUSEUM_WALLWASHER_PROFILE_IDENTITY=Object.freeze({
 profileId:MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE.profileId,
 catalogId:'museum-wallwasher',catalogVersion:1,
 mime:'model/gltf-binary',bytes:201724,
 sha256:MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE.modelSha256,
 provenance:Object.freeze({sourceSha256:'d85d9d1823c49bef412a23a59e238104f5b8ad342d8e8149efaf8d1110dc3290',recipe:'omit-unused-tangent-v1'}),
 sourceQualification:'authored-rest-pose-only',
} as const);
export type WallwasherFixtureAssetIdentity={catalogId:string;catalogVersion:number;mime:string;bytes:number;sha256:string;provenance:{sourceSha256:string;recipe:string}};
/** Select only this trusted source profile, never caller-supplied geometry or
 * angle intervals. Call AFTER complete asset/document admission; this identity
 * match is not a rights grant, byte inspection or stored-candidate validation. */
export function museumWallwasherFixtureProfile(asset:WallwasherFixtureAssetIdentity):Readonly<WallwasherMountHeadProfile>{
 const expected=MUSEUM_WALLWASHER_PROFILE_IDENTITY;
 if(!asset||asset.catalogId!==expected.catalogId||asset.catalogVersion!==expected.catalogVersion||asset.mime!==expected.mime||asset.bytes!==expected.bytes||asset.sha256!==expected.sha256||asset.provenance?.sourceSha256!==expected.provenance.sourceSha256||asset.provenance?.recipe!==expected.provenance.recipe)throw Error('WASHER_CATALOGUE_IDENTITY_MISMATCH');
 return MUSEUM_WALLWASHER_FIXED_HEAD_PROFILE;
}
