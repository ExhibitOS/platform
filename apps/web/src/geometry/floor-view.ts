// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {Matrix4,Quaternion,Vector3} from 'three';

const matrix=(pose:Exhibition['rooms'][number]['transform'])=>new Matrix4().compose(new Vector3(...pose.position),new Quaternion(...pose.rotation),new Vector3(...pose.scale));
/** A preview camera inside the room envelope, not a walking-clearance certificate.
 * Keep the selected floor centre and its tangent orientation; never move data.
 */
export function floorInteriorView(document:Exhibition,surfaceId:string) {
 const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 const floor=document.surfaces.find(s=>same(s.id,surfaceId));
 const room=floor&&document.rooms.find(r=>same(r.id,floor.roomId));
 if(!floor||floor.type!=='floor'||!room)return undefined;
 const {width,height,depth}=room.dimensions,target=new Vector3(...floor.transform.position);
 if(![width,height,depth,...target].every(Number.isFinite)||Math.min(width,height,depth)<=0)return undefined;
 const inset=Math.min(width,depth)*.01;
 if(Math.abs(target.x)>=width/2-inset||Math.abs(target.z)>=depth/2-inset||target.y<0)return undefined;
 const normal=new Vector3(0,0,1).applyQuaternion(new Quaternion(...floor.transform.rotation));
 if(!Number.isFinite(normal.y)||Math.abs(normal.y)<.5)return undefined;
 // A lower or sloping authored ceiling can hide a camera above it. Its lowest
 // corner is a conservative upper bound, including old partial ceilings.
 let ceiling=height;
 for(const surface of document.surfaces.filter(s=>s.type==='ceiling'&&same(s.roomId,room.id))){
  const transform=matrix(surface.transform);
  for(const x of [-.5,.5])for(const y of [-.5,.5])ceiling=Math.min(ceiling,new Vector3(x*surface.dimensions.width,y*surface.dimensions.height,0).applyMatrix4(transform).y);
 }
 const gap=ceiling-target.y;if(!Number.isFinite(gap)||gap<=1e-6)return undefined;
 const eye=target.clone().add(new Vector3(0,Math.min(1.65,gap*.6),0)),parent=matrix(room.transform);
 const worldTarget=target.applyMatrix4(parent),position=eye.applyMatrix4(parent);
 const direction=worldTarget.clone().sub(position).normalize();
 const up=new Vector3(0,1,0).transformDirection(parent.clone().multiply(matrix(floor.transform)));
 up.addScaledVector(direction,-up.dot(direction));
 if(up.lengthSq()<1e-10)return undefined;
 up.normalize();const distance=position.distanceTo(worldTarget);
 if(![...position,...worldTarget,...up,distance].every(Number.isFinite)||distance<=0)return undefined;
 return {position:position.toArray(),target:worldTarget.toArray(),up:up.toArray(),near:distance/100};
}
