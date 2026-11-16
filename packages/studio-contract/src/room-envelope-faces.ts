// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,artifactCorners,artifactBounds,validateArtifactPose,type AffinePoint,type ArtifactPose} from './artifact-affine.js';

type Room=Exhibition['rooms'][number];
type Surface=Exhibition['surfaces'][number];
export const tolerance=1e-5;
export const close=(a:number,b:number)=>Math.abs(a-b)<=tolerance;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export const unit=(v:AffinePoint)=>{const n=Math.hypot(...v);if(n<tolerance)throw Error('singular');return v.map(x=>x/n) as AffinePoint;};
export function direction(pose:ArtifactPose,axis:AffinePoint):AffinePoint {
 return artifactPoint(axis,pose).map((value,index)=>value-pose.position[index]!) as AffinePoint;
}
export function rigid(pose:ArtifactPose){validateArtifactPose(pose);if(pose.scale.some(n=>!close(n,1)))throw Error('scaled structural surface');}

export function assertRoomEnvelopeFrame(room:Room){
 rigid(room.transform);if(Math.abs(room.transform.rotation[0])+Math.abs(room.transform.rotation[2])>tolerance)throw Error('tilted room');if(Object.values(room.dimensions).some(n=>!Number.isFinite(n)||n<=0||n>10000))throw Error('dimensions');
}

export type Side='west'|'east'|'north'|'south'|'floor'|'ceiling';
export function roomEnvelopeSide(surface:Surface,room:Room):Side|undefined {
 rigid(surface.transform);const b=artifactBounds(artifactCorners(surface.dimensions,[surface.transform])),d=room.dimensions,n=unit(direction(surface.transform,[0,0,1]));
 const axes=[[1,0,0],[0,1,0]].map(a=>unit(direction(surface.transform,a as AffinePoint)));if(axes.some(a=>Math.max(...a.map(Math.abs))<1-tolerance))return undefined;
 const span=(axis:0|1|2,a:number,c:number)=>close(b.min[axis],a)&&close(b.max[axis],c);
 if(surface.type==='floor'&&span(0,-d.width/2,d.width/2)&&span(1,0,0)&&span(2,-d.depth/2,d.depth/2)&&close(n[1],1))return 'floor';
 if(surface.type==='ceiling'&&span(0,-d.width/2,d.width/2)&&span(1,d.height,d.height)&&span(2,-d.depth/2,d.depth/2)&&close(n[1],-1))return 'ceiling';
 if(surface.type!=='wall'||!span(1,0,d.height)||!close(unit(direction(surface.transform,[0,1,0]))[1],1))return undefined;
 if(span(0,-d.width/2,-d.width/2)&&span(2,-d.depth/2,d.depth/2)&&close(n[0],1))return 'west';
 if(span(0,d.width/2,d.width/2)&&span(2,-d.depth/2,d.depth/2)&&close(n[0],-1))return 'east';
 if(span(2,-d.depth/2,-d.depth/2)&&span(0,-d.width/2,d.width/2)&&close(n[2],1))return 'north';
 if(span(2,d.depth/2,d.depth/2)&&span(0,-d.width/2,d.width/2)&&close(n[2],-1))return 'south';
 return undefined;
}
/** Confirm the room-local rectangle used by the automatic ceiling emitter. */
export function roomCeilingFillDimensions(document:Exhibition,roomId:string):Room['dimensions'] {
 const room=document.rooms.find(value=>same(value.id,roomId));
 if(!room)throw Error('ROOM_CEILING_FILL_GEOMETRY');
 assertRoomEnvelopeFrame(room);
 const ceilings=document.surfaces.filter(surface=>surface.type==='ceiling'&&same(surface.roomId,roomId));
 if(ceilings.length>1||(ceilings[0]&&roomEnvelopeSide(ceilings[0],room)!=='ceiling'))throw Error('ROOM_CEILING_FILL_GEOMETRY');
 return room.dimensions;
}
