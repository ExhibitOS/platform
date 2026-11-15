// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WallwasherMountHeadProfile} from './wallwasher-mount-head.js';
/** Source3cbe is REST0. Only this checked static pitch is admitted, not travel.
 * Producer clearance evidence excludes the existing bearing/housing interface
 * and is not structural or mechanical certification. */
export const MUSEUM_TRACK_SPOT_FIXED64_SHA256='3cbe71cf0c6ed28cb99f16c34094b43dc1cb5b3f293406b2cec54e9fcbf0783a';
export const MUSEUM_TRACK_SPOT_FIXED64_PITCH=-64.1*Math.PI/180;
export const MUSEUM_TRACK_SPOT_FIXED64_PROFILE:Readonly<WallwasherMountHeadProfile>=Object.freeze({
 profileId:'museum-track-spot-fixed-head-v1',modelSha256:MUSEUM_TRACK_SPOT_FIXED64_SHA256,
 fixedParts:Object.freeze([
  Object.freeze({name:"Adapter_key",bounds:Object.freeze({min:Object.freeze([-0.027499999850988388, -0.0020000000949949026, -0.006000000052154064] as const),max:Object.freeze([0.027499999850988388, 0.0, 0.006000000052154064] as const)})}),
  Object.freeze({name:"Adapter_neck",bounds:Object.freeze({min:Object.freeze([-0.017000000923871994, -0.04000000189989805, -0.013000000268220901] as const),max:Object.freeze([0.017000000923871994, -0.02400000113993883, 0.013000000268220901] as const)})}),
  Object.freeze({name:"Pivot_bearing",bounds:Object.freeze({min:Object.freeze([-0.05999999865889549, -0.1599999964237213, -0.009999999776482582] as const),max:Object.freeze([-0.041999999433755875, -0.14000000059604645, 0.009999999776482582] as const)})}),
  Object.freeze({name:"Pivot_bearing.001",bounds:Object.freeze({min:Object.freeze([0.041999999433755875, -0.1599999964237213, -0.009999999776482582] as const),max:Object.freeze([0.05999999865889549, -0.14000000059604645, 0.009999999776482582] as const)})}),
  Object.freeze({name:"Stem",bounds:Object.freeze({min:Object.freeze([-0.008999999612569809, -0.0570000009611249, -0.008999999612569809] as const),max:Object.freeze([0.008999999612569809, -0.039000000804662704, 0.008999999612569809] as const)})}),
  Object.freeze({name:"Track_adapter",bounds:Object.freeze({min:Object.freeze([-0.04749999940395355, -0.024000000208616257, -0.01899999938905239] as const),max:Object.freeze([0.04749999940395355, 0.0, 0.01899999938905239] as const)})}),
  Object.freeze({name:"Yoke_arm",bounds:Object.freeze({min:Object.freeze([-0.05499999923631549, -0.147000003606081, -0.007499999832361937] as const),max:Object.freeze([-0.04699999885633588, -0.049000002443790436, 0.007499999832361937] as const)})}),
  Object.freeze({name:"Yoke_arm.001",bounds:Object.freeze({min:Object.freeze([0.04699999885633588, -0.147000003606081, -0.007499999832361937] as const),max:Object.freeze([0.05499999923631549, -0.049000002443790436, 0.007499999832361937] as const)})}),
  Object.freeze({name:"Yoke_bridge",bounds:Object.freeze({min:Object.freeze([-0.05400000140070915, -0.054000004194676876, -0.007499999832361937] as const),max:Object.freeze([0.05400000140070915, -0.04200000409036875, 0.007499999832361937] as const)})}),
 ]),
 headParts:Object.freeze([
  Object.freeze({name:"Front_retaining_ring",bounds:Object.freeze({min:Object.freeze([-0.04050000011920929, -0.19050000607967377, -0.0754999965429306] as const),max:Object.freeze([0.04050000011920929, -0.10949999839067459, -0.07500000298023224] as const)})}),
  Object.freeze({name:"Housing_spun_shell",bounds:Object.freeze({min:Object.freeze([-0.042500000447034836, -0.19249999523162842, -0.07500000298023224] as const),max:Object.freeze([0.042500000447034836, -0.10750000178813934, 0.07500000298023224] as const)})}),
  Object.freeze({name:"Lens_opaque",bounds:Object.freeze({min:Object.freeze([-0.017000000923871994, -0.16699999570846558, -0.028999999165534973] as const),max:Object.freeze([0.017000000923871994, -0.13300000131130219, -0.028999999165534973] as const)})}),
  Object.freeze({name:"Recessed_baffle",bounds:Object.freeze({min:Object.freeze([-0.03629999980330467, -0.18629999458789825, -0.06400000303983688] as const),max:Object.freeze([0.03629999980330467, -0.1137000024318695, -0.0430000014603138] as const)})}),
  Object.freeze({name:"Reflector_cup",bounds:Object.freeze({min:Object.freeze([-0.02800000086426735, -0.17800000309944153, -0.0430000014603138] as const),max:Object.freeze([0.02800000086426735, -0.12200000137090683, -0.02800000086426735] as const)})}),
 ]),
 mountFootprint:Object.freeze([Object.freeze([-.047499999,0,-.018999999] as const),Object.freeze([-.047499999,0,.018999999] as const),Object.freeze([.047499999,0,-.018999999] as const),Object.freeze([.047499999,0,.018999999] as const)]),
 opticalA:Object.freeze([0,-.15,-.0755] as const),pivotP:Object.freeze([0,-.15,0] as const),axis:Object.freeze([1,0,0] as const),
 headPitchIntervals:Object.freeze([Object.freeze([MUSEUM_TRACK_SPOT_FIXED64_PITCH,MUSEUM_TRACK_SPOT_FIXED64_PITCH] as const)]),
});
export const MUSEUM_TRACK_SPOT_FIXED64_IDENTITY=Object.freeze({catalogId:'museum-track-spot-fixed-64p1',catalogVersion:1,mime:'model/gltf-binary',bytes:255228,sha256:MUSEUM_TRACK_SPOT_FIXED64_SHA256,provenance:Object.freeze({sourceSha256:MUSEUM_TRACK_SPOT_FIXED64_SHA256,recipe:'original-v1'})} as const);
