// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';
import type {AffinePoint} from './artifact-affine.js';

/** Certified INNER contact regions of the immutable closed rectangular rail source.
 * Each 95 x 38 mm quad is fully covered by decoded coplanar underside triangles
 * of the CC0 source, not inferred from its aggregate bounding box. Identity
 * binds this physical profile; admission ALSO requires all actual adapter
 * corners on one region. Ordinary source intake remains geometry based.
 * Coordinates are source-local metres; no artwork or placement IDs are used.
 */
export const RECTANGULAR_RAIL_CONTACT_QUADS:readonly (readonly (readonly [number,number])[])[]=[[[-2.247499999,-3.808999999],[-2.1525000010000004,-3.808999999],[-2.1525000010000004,-3.771000001],[-2.247499999,-3.771000001]],[[-0.047499999,-3.808999999],[0.047499999,-3.808999999],[0.047499999,-3.771000001],[-0.047499999,-3.771000001]],[[2.502500001,-3.808999999],[2.5974999989999996,-3.808999999],[2.5974999989999996,-3.771000001],[2.502500001,-3.771000001]],[[-2.808999999,-2.6974999989999997],[-2.771000001,-2.6974999989999997],[-2.771000001,-2.602500001],[-2.808999999,-2.602500001]],[[-2.808999999,-0.04749999900000001],[-2.771000001,-0.047499999],[-2.771000001,0.04749999900000001],[-2.808999999,0.047499999]],[[-2.808999999,2.452500001],[-2.771000001,2.452500001],[-2.771000001,2.547499999],[-2.808999999,2.547499999]],[[-2.547499999,3.771000001],[-2.452500001,3.771000001],[-2.452500001,3.808999999],[-2.547499999,3.808999999]],[[2.771000001,2.452500001],[2.808999999,2.452500001],[2.808999999,2.547499999],[2.771000001,2.547499999]],[[2.771000001,-2.547499999],[2.808999999,-2.547499999],[2.808999999,-2.452500001],[2.771000001,-2.452500001]]];
const sourceSha256='aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42';
const bounds=[[-2.809499979019165,-.03500000014901161,-3.809499979019165],[2.809499979019165,0,3.809499979019165]];
/** Undefined delegates an unrelated ordinary source to its existing linear
 * rail predicate. A matched profile never falls back to an aggregate AABB. */
export function rectangularRailContact(descriptor:WorkspaceFurnishingDescriptor,corners:readonly AffinePoint[]):boolean|undefined{
 if(descriptor.model.sha256!==sourceSha256)return;
 const geometry=descriptor.fit?.geometry;
 if(descriptor.model.bytes!==268820||descriptor.fit?.sourceSha256!==sourceSha256||descriptor.fit.sourceBytes!==268820||geometry?.profile!=='passive-ceiling-rail-v1'||
   ![geometry.min,geometry.max].every((row,i)=>row.every((value,j)=>Math.abs(value-bounds[i]![j]!)<=1e-6))||corners.length!==4||corners.some(point=>point.some(value=>!Number.isFinite(value))||Math.abs(point[1]+.035)>1e-6))return false;
 return RECTANGULAR_RAIL_CONTACT_QUADS.some(quad=>corners.every(point=>quad.every((a,i)=>{
  const b=quad[(i+1)%quad.length]!,dx=b[0]-a[0],dz=b[1]-a[1];
  return (dx*(point[2]-a[1])-dz*(point[0]-a[0]))/Math.hypot(dx,dz)>=-1e-6;
 })));
}
