// SPDX-License-Identifier: AGPL-3.0-or-later
import type {TrackSpotAimGeometry,TrackSpotAimEnvelope} from './track-spot-aiming.js';
import type {WasherVector} from './wallwasher-mount-head.js';
const v=(x:number,y:number,z:number):WasherVector=>Object.freeze([x,y,z] as const);
const part=(name:string,frame:'fixed'|'yoke'|'head',min:WasherVector,max:WasherVector)=>Object.freeze({name,frame,bounds:Object.freeze({min,max})});
/** Exactly one known authored REST0 source. Surface-clearance bounds exclude
 * existing bearing interfaces; they are not manufacturing certification or
 * permission to ignore the actual rail, room, or source identity. Legacy
 * fixed64 and -45 degree profiles never select this capability. */
export const ARTICULATED_TRACK_SPOT_PROFILE=Object.freeze({
 profileId:'museum-track-spot-articulated-v1' as const,
 capability:'track-spot-aim-v1' as const,
 modelSha256:'e6801dd02c4f11a1c48b5cf64d97b775924bab10ea7dd533e2904db3a4d6d3a3',
 geometry:Object.freeze<TrackSpotAimGeometry>({swivelPivot:v(0,-.04,0),headPivot:v(0,-.15,0),opticalA:v(0,-.15,-.0755),forward:v(0,0,-1),swivelAxis:v(0,1,0),pitchAxis:v(1,0,0)}),
 envelope:Object.freeze<TrackSpotAimEnvelope>({yawIntervals:Object.freeze([Object.freeze([-Math.PI,Math.PI] as const)]),pitchIntervals:Object.freeze([Object.freeze([-Math.PI/2,0] as const)])}),
 mountFootprint:Object.freeze([v(-.04749999940395355,0,-.01899999938905239),v(-.04749999940395355,0,.01899999938905239),v(.04749999940395355,0,-.01899999938905239),v(.04749999940395355,0,.01899999938905239)]),
 parts:Object.freeze([
  part("Adapter_key",'fixed',v(-0.027499999850988388,-0.0020000000949949026,-0.006000000052154064),v(0.027499999850988388,0.0,0.006000000052154064)),
  part("Adapter_neck",'fixed',v(-0.017000000923871994,-0.04000000189989805,-0.013000000268220901),v(0.017000000923871994,-0.02400000113993883,0.013000000268220901)),
  part("Front_retaining_ring",'head',v(-0.04050000011920929,-0.19050000607967377,-0.0754999965429306),v(0.04050000011920929,-0.10949999839067459,-0.07500000298023224)),
  part("Housing_spun_shell",'head',v(-0.042500000447034836,-0.19249999523162842,-0.07500000298023224),v(0.042500000447034836,-0.10750000178813934,0.07500000298023224)),
  part("Lens_opaque",'head',v(-0.017000000923871994,-0.16699999570846558,-0.028999999165534973),v(0.017000000923871994,-0.13300000131130219,-0.028999999165534973)),
  part("Pivot_bearing",'yoke',v(-0.05999999865889549,-0.1599999964237213,-0.009999999776482582),v(-0.041999999433755875,-0.14000000059604645,0.009999999776482582)),
  part("Pivot_bearing.001",'yoke',v(0.041999999433755875,-0.1599999964237213,-0.009999999776482582),v(0.05999999865889549,-0.14000000059604645,0.009999999776482582)),
  part("Recessed_baffle",'head',v(-0.03629999980330467,-0.18629999458789825,-0.06400000303983688),v(0.03629999980330467,-0.1137000024318695,-0.0430000014603138)),
  part("Reflector_cup",'head',v(-0.02800000086426735,-0.17800000309944153,-0.0430000014603138),v(0.02800000086426735,-0.12200000137090683,-0.02800000086426735)),
  part("Stem",'yoke',v(-0.008999999612569809,-0.0570000009611249,-0.008999999612569809),v(0.008999999612569809,-0.03199999965727329,0.008999999612569809)),
  part("Track_adapter",'fixed',v(-0.04749999940395355,-0.024000000208616257,-0.01899999938905239),v(0.04749999940395355,0.0,0.01899999938905239)),
  part("Yoke_arm",'yoke',v(-0.05499999923631549,-0.147000003606081,-0.007499999832361937),v(-0.04699999885633588,-0.049000002443790436,0.007499999832361937)),
  part("Yoke_arm.001",'yoke',v(0.04699999885633588,-0.147000003606081,-0.007499999832361937),v(0.05499999923631549,-0.049000002443790436,0.007499999832361937)),
  part("Yoke_bridge",'yoke',v(-0.05400000140070915,-0.054000004194676876,-0.007499999832361937),v(0.05400000140070915,-0.04200000409036875,0.007499999832361937)),
 ]),
});
export const ARTICULATED_TRACK_SPOT_IDENTITY=Object.freeze({catalogId:'museum-track-spot-articulated',catalogVersion:1,mime:'model/gltf-binary',bytes:225328,sha256:ARTICULATED_TRACK_SPOT_PROFILE.modelSha256,provenance:Object.freeze({sourceSha256:ARTICULATED_TRACK_SPOT_PROFILE.modelSha256,recipe:'original-v1'})} as const);
export function articulatedTrackSpotProfile(asset:unknown){
 const expected=ARTICULATED_TRACK_SPOT_IDENTITY;
 if(!asset||typeof asset!=='object')throw Error('TRACK_SPOT_AIM_SOURCE_MISMATCH');
 const a=asset as Record<string,unknown>,p=a.provenance as Record<string,unknown>|undefined;
 if(a.catalogId!==expected.catalogId||a.catalogVersion!==expected.catalogVersion||a.mime!==expected.mime||a.bytes!==expected.bytes||a.sha256!==expected.sha256||p?.sourceSha256!==expected.provenance.sourceSha256||p?.recipe!==expected.provenance.recipe)throw Error('TRACK_SPOT_AIM_SOURCE_MISMATCH');
 return ARTICULATED_TRACK_SPOT_PROFILE;
}
