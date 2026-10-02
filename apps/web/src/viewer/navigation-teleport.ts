// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import { presentationFor } from "@exhibitos/studio-contract";
import type { NavigationController, Vec3 } from "./navigation";
function world(room: Exhibition["rooms"][number], local: Vec3): Vec3 {
  const [x,y,z,w]=room.transform.rotation,[a,b,c]=local;
  const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
  return [a+w*tx+y*tz-z*ty+room.transform.position[0],b+w*ty+z*tx-x*tz+room.transform.position[1],c+w*tz+x*ty-y*tx+room.transform.position[2]];
}
/** Validate authored identity/direction before creating or mutating a physics controller. */
export function viewpointPose(document: Exhibition, viewpointId: string) {
  const viewpoint=presentationFor(document).viewpoints.find(v=>v.id.toLowerCase()===viewpointId.toLowerCase());
  const room=document.rooms.find(r=>r.id.toLowerCase()===viewpoint?.roomId.toLowerCase());
  if(!viewpoint||!room)throw Error("TELEPORT_VIEWPOINT_UNAVAILABLE");
  const position=world(room,viewpoint.position),target=world(room,viewpoint.target);
  const dx=target[0]-position[0],dz=target[2]-position[2];
  if(Math.hypot(dx,dz)<0.001)throw Error("TELEPORT_DIRECTION_UNSUPPORTED");
  return {position,target,yaw:Math.atan2(-dx,-dz),fov:viewpoint.fov};
}
/** Explicit authored destinations only. Rapier validates floor, capsule and head clearance before any pose mutation. */
export function teleportToViewpoint(controller: NavigationController, document: Exhibition, viewpointId: string) {
  controller.pause();
  const {position,target,yaw,fov}=viewpointPose(document,viewpointId);
  const state=controller.reset({position,yaw});
  const pitch=Math.max(-1.396,Math.min(1.396,Math.atan2(target[1]-state.eyePosition[1],Math.hypot(target[0]-position[0],target[2]-position[2]))));
  return {state,pitch,fov};
}
