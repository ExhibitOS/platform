// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';
import type {AffinePoint} from './artifact-affine.js';

/** Certified INNER contact regions of the immutable grouped rail source.
 * Each 95 x 38 mm quad is fully covered by decoded coplanar underside triangles
 * of the CC0 source, not inferred from its aggregate bounding box. Identity
 * binds this physical profile; admission ALSO requires all actual adapter
 * corners on one region. Ordinary source intake remains geometry based.
 * Coordinates are source-local metres; no artwork or placement IDs are used.
 */
export const GROUPED_RAIL_CONTACT_QUADS:readonly (readonly (readonly [number,number])[])[]=[[[-2.247499999,-2.420999999],[-2.152500001,-2.420999999],[-2.152500001,-2.383000001],[-2.247499999,-2.383000001]],[[-0.047499999,-2.620999999],[0.047499999,-2.620999999],[0.047499999,-2.583000001],[-0.047499999,-2.583000001]],[[-1.420999999,2.547499999],[-1.420999999,2.452500001],[-1.383000001,2.452500001],[-1.383000001,2.547499999]],[[-1.420999999,0.047499999],[-1.420999999,-0.047499999],[-1.383000001,-0.047499999],[-1.383000001,0.047499999]],[[-1.420999999,-2.602500001],[-1.420999999,-2.697499999],[-1.383000001,-2.697499999],[-1.383000001,-2.602500001]],[[-2.452500001,2.518999999],[-2.547499999,2.518999999],[-2.547499999,2.481000001],[-2.452500001,2.481000001]],[[2.252500001,-2.620999999],[2.347499999,-2.620999999],[2.347499999,-2.583000001],[2.252500001,-2.583000001]],[[2.647849365717,0.587397500716],[2.569834434436,0.641607002811],[2.548150634283,0.610401031284],[2.626165565564,0.556191529189]],[[2.569834434436,-0.641607002811],[2.647849365717,-0.587397500716],[2.626165565564,-0.556191529189],[2.548150634283,-0.610401031284]]];
const sourceSha256='5cc5d772acd4087c5d7d26b5f24e2fe38626b1315e377210410954abf7d4ff44';
const bounds=[[-3.2175,-.035,-2.698],[2.648545,0,2.548]];
/** Undefined delegates an unrelated ordinary source to its existing linear
 * rail predicate. A matched profile never falls back to an aggregate AABB. */
export function groupedRailContact(descriptor:WorkspaceFurnishingDescriptor,corners:readonly AffinePoint[]):boolean|undefined{
 if(descriptor.model.sha256!==sourceSha256)return;
 const geometry=descriptor.fit?.geometry;
 if(descriptor.model.bytes!==377576||descriptor.fit?.sourceSha256!==sourceSha256||descriptor.fit.sourceBytes!==377576||geometry?.profile!=='passive-ceiling-rail-v1'||
   ![geometry.min,geometry.max].every((row,i)=>row.every((value,j)=>Math.abs(value-bounds[i]![j]!)<=1e-6))||corners.length!==4||corners.some(point=>point.some(value=>!Number.isFinite(value))||Math.abs(point[1]+.035)>1e-6))return false;
 return GROUPED_RAIL_CONTACT_QUADS.some(quad=>corners.every(point=>quad.every((a,i)=>{
  const b=quad[(i+1)%quad.length]!,dx=b[0]-a[0],dz=b[1]-a[1];
  return (dx*(point[2]-a[1])-dz*(point[0]-a[0]))/Math.hypot(dx,dz)>=-1e-6;
 })));
}
