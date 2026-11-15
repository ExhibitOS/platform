// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';
import type {WasherQuaternion} from './wallwasher-mount-head.js';

/** The decoded triangles of this immutable white rail are invariant under a
 * half-turn about Y. Only its reverse longitudinal heading is equivalent.
 * This does not admit contact: the caller still checks the actual plane,
 * centreline, end span, unique ceiling contact and complete fixture bounds.
 */
export function whiteRailOppositeHeading(descriptor:WorkspaceFurnishingDescriptor,mount:WasherQuaternion,rail:WasherQuaternion){
 const sha256='1ba64842de525166018e941074852a3e041d07adf605674c7d7fadb02693a09e',fit=descriptor.fit,g=fit?.geometry;
 if(descriptor.kind!=='ceiling-rail'||descriptor.model.mime!=='model/gltf-binary'||descriptor.model.sha256!==sha256||descriptor.model.bytes!==187688||fit?.version!==1||fit.sourceSha256!==sha256||fit.sourceBytes!==187688||g?.profile!=='passive-ceiling-rail-v1')return false;
 const bounds=[[-.5,-.035,-.0175],[.5,0,.0175]];
 if(![g.min,g.max].every((row,i)=>row.length===3&&row.every((value,j)=>Number.isFinite(value)&&Math.abs(value-bounds[i]![j]!)<=1e-6)))return false;
 // rail * [0,1,0,0], including quaternion sign equivalence.
 const opposite:WasherQuaternion=[-rail[2],rail[3],rail[0],-rail[1]];
 return Math.abs(mount.reduce((sum,value,i)=>sum+value*opposite[i]!,0))>=1-1e-7;
}
