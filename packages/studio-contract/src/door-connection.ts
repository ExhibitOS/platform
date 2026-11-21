// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactBounds,artifactPoint,validateArtifactPose,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {wallFinishesFor} from './architectural-finishes.js';
import {surfacePanels} from './surface-panels.js';

const tolerance=1e-5;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const sub=(a:AffinePoint,b:AffinePoint)=>a.map((n,i)=>n-b[i]!) as AffinePoint;
const dot=(a:AffinePoint,b:AffinePoint)=>a.reduce((sum,n,i)=>sum+n*b[i]!,0);
const close=(a:number,b:number)=>Math.abs(a-b)<=tolerance;
const rigid=(pose:ArtifactPose)=>{validateArtifactPose(pose);if(pose.scale.some(n=>!close(n,1)))throw Error('DOOR_PAIR_UNSUPPORTED');};
const direction=(axis:AffinePoint,...poses:ArtifactPose[])=>sub(artifactPoint(axis,...poses),artifactPoint([0,0,0],...poses));
const only=<T extends {id:string}>(items:T[],id:string)=>{const found=items.filter(x=>same(x.id,id));if(found.length!==1)throw Error('DOOR_PAIR_REFERENCE');return found[0]!;};
type Opening=Exhibition['openings'][number];
interface DoorSide {corners:AffinePoint[];bottom:AffinePoint;normal:AffinePoint;interior:number;room:Exhibition['rooms'][number]}
function doorSide(document:Exhibition,opening:Opening,boundaryInset=0):DoorSide {
 const wall=only(document.surfaces,opening.surfaceId),room=only(document.rooms,wall.roomId);
 if(wall.type!=='wall'||opening.type!=='door'||!Number.isFinite(opening.dimensions.width)||!Number.isFinite(opening.dimensions.height)||opening.dimensions.width<=0||opening.dimensions.height<=0)throw Error('DOOR_PAIR_UNSUPPORTED');
 rigid(room.transform);rigid(wall.transform);const roomUp=direction([0,1,0],room.transform),roomX=direction([1,0,0],room.transform),roomZ=direction([0,0,1],room.transform),wallUp=direction([0,1,0],wall.transform,room.transform),normal=direction([0,0,1],wall.transform,room.transform);
 if(!close(roomUp[1],1)||!close(wallUp[1],1)||!close(normal[1],0))throw Error('DOOR_PAIR_UNSUPPORTED');
 const point=(x:number,y:number)=>artifactPoint([opening.offset[0]+x*opening.dimensions.width/2,opening.offset[1]+y*opening.dimensions.height/2,0],wall.transform,room.transform);
 const corners=([-1,1] as const).flatMap(x=>([-1,1] as const).map(y=>point(x,y))),bottom=artifactPoint([opening.offset[0],opening.offset[1]-opening.dimensions.height/2,0],wall.transform,room.transform),origin=room.transform.position,relative=sub(bottom,origin),x=dot(relative,roomX),z=dot(relative,roomZ),dimensions=room.dimensions;
 const bounds=artifactBounds(([-1,1] as const).flatMap(a=>([-1,1] as const).map(b=>artifactPoint([a*wall.dimensions.width/2,b*wall.dimensions.height/2,0],wall.transform))));
 const span=(axis:0|1|2,min:number,max:number)=>close(bounds.min[axis],min)&&close(bounds.max[axis],max),height=span(1,0,dimensions.height);
 const atBoundary=(value:number,half:number)=>Math.abs(value)<=half+tolerance&&Math.abs(value)>=half-boundaryInset-tolerance;
 const xBoundary=atBoundary(x,dimensions.width/2)&&Math.abs(z)<=dimensions.depth/2+tolerance&&close(Math.abs(dot(normal,roomX)),1)&&span(0,x,x)&&span(2,-dimensions.depth/2,dimensions.depth/2);
 const zBoundary=atBoundary(z,dimensions.depth/2)&&Math.abs(x)<=dimensions.width/2+tolerance&&close(Math.abs(dot(normal,roomZ)),1)&&span(2,z,z)&&span(0,-dimensions.width/2,dimensions.width/2);
 if(!Object.values(dimensions).every(n=>Number.isFinite(n)&&n>0)||!close(bottom[1],origin[1])||!height||!(xBoundary||zBoundary))throw Error('DOOR_PAIR_BOUNDARY');
 const center=artifactPoint([0,dimensions.height/2,0],room.transform),interior=dot(sub(center,bottom),normal);if(Math.abs(interior)<tolerance)throw Error('DOOR_PAIR_BOUNDARY');
 return {corners,bottom,normal,interior,room};
}
function insideRoom(room:Exhibition['rooms'][number],world:AffinePoint){
 const relative=sub(world,room.transform.position),x=dot(relative,direction([1,0,0],room.transform)),z=dot(relative,direction([0,0,1],room.transform));
 return Math.abs(x)<room.dimensions.width/2-tolerance&&Math.abs(z)<room.dimensions.depth/2-tolerance;
}
/** World alignment only; callers must separately qualify the passage with their navigation engine. */
export function alignedDoorPair(document:Exhibition,firstId:string,secondId:string):{bottom:AffinePoint;firstInterior:AffinePoint} {
 const first=only(document.openings,firstId),second=only(document.openings,secondId);
 if(same(first.id,second.id)||first.type!=='door'||second.type!=='door'||first.connectsToOpeningId||second.connectsToOpeningId)throw Error('DOOR_PAIR_REFERENCE');
 const firstWall=only(document.surfaces,first.surfaceId),secondWall=only(document.surfaces,second.surfaceId);if(same(firstWall.roomId,secondWall.roomId))throw Error('DOOR_PAIR_REFERENCE');
 const a=doorSide(document,first),b=doorSide(document,second);
 if(a.corners.some(p=>!b.corners.some(q=>Math.hypot(...sub(p,q))<=tolerance))||!close(Math.abs(dot(a.normal,b.normal)),1))throw Error('DOOR_PAIR_ALIGNMENT');
 const firstDirection=a.normal.map(n=>n*Math.sign(a.interior)) as AffinePoint,secondDirection=b.normal.map(n=>n*Math.sign(b.interior)) as AffinePoint;
 if(!close(dot(firstDirection,secondDirection),-1))throw Error('DOOR_PAIR_INTERIOR');
 const probe=(side:DoorSide,direction:AffinePoint)=>side.bottom.map((v,i)=>v+direction[i]!*0.55) as AffinePoint;
 if(!insideRoom(a.room,probe(a,firstDirection))||!insideRoom(b.room,probe(b,secondDirection)))throw Error('DOOR_PAIR_BOUNDARY');
 return {bottom:a.bottom,firstInterior:firstDirection};
}

export type DoorPairEditConstraint='reference'|'wall-bounds'|'opening-overlap'|'alignment'|'artwork-overlap'|'frame-fit'|'frame-conflict'|'structure-clearance';
export class DoorPairEditError extends Error {
 constructor(readonly constraint:DoorPairEditConstraint,readonly openingId?:string,readonly roomId?:string){
  super('DOOR_PAIR_EDIT_INVALID');
 }
}

export function reciprocalDoorPair(document:Exhibition,openingId:string):[Opening,Opening] {
 let opening:Opening,peer:Opening;
 try{
  opening=only(document.openings,openingId);
  if(opening.type!=='door'||opening.exterior||!opening.connectsToOpeningId)throw new DoorPairEditError('reference');
  peer=only(document.openings,opening.connectsToOpeningId);
 }catch{throw new DoorPairEditError('reference');}
 if(same(opening.id,peer.id)||peer.type!=='door'||peer.exterior||!peer.connectsToOpeningId||!same(peer.connectsToOpeningId,opening.id))
  throw new DoorPairEditError('reference',opening.id);
 return opening.id.toLowerCase()<peer.id.toLowerCase()?[opening,peer]:[peer,opening];
}

export function openingsOverlap(a:Pick<Opening,'offset'|'dimensions'>,b:Pick<Opening,'offset'|'dimensions'>) {
 return 2*Math.abs(a.offset[0]-b.offset[0])<a.dimensions.width+b.dimensions.width&&
  2*Math.abs(a.offset[1]-b.offset[1])<a.dimensions.height+b.dimensions.height;
}

/** Inset finish slabs can meet across a small plane gap while the two clear cuts still align. */
export function assertReciprocalDoorApertures(document:Exhibition,pair:[Opening,Opening]) {
 const finishes=wallFinishesFor(document);
 const sideFor=(opening:Opening)=>{
  const wall=document.surfaces.find(row=>same(row.id,opening.surfaceId));
  const room=wall&&document.rooms.find(row=>same(row.id,wall.roomId));
  if(!wall||!room||wall.type!=='wall')throw new DoorPairEditError('reference',opening.id,room?.id);
  if(document.openings.some(other=>!same(other.id,opening.id)&&same(other.surfaceId,wall.id)&&openingsOverlap(opening,other)))
   throw new DoorPairEditError('opening-overlap',opening.id,room.id);
  try{surfacePanels(wall,document.openings);}catch{throw new DoorPairEditError('wall-bounds',opening.id,room.id);}
  const depth=finishes.find(row=>same(row.surfaceId,wall.id))?.depth??0;
  let side:DoorSide;
  try{side=doorSide(document,opening,depth/2);}catch{throw new DoorPairEditError('alignment',opening.id,room.id);}
  return {side,depth,opening,room};
 };
 const a=sideFor(pair[0]),b=sideFor(pair[1]);
 const {normal,bottom,corners}=a.side;
 const gap=dot(sub(b.side.bottom,bottom),normal);
 const offset=normal.map(n=>gap*n) as AffinePoint;
 const interior=(side:DoorSide)=>side.normal.map(n=>n*Math.sign(side.interior)) as AffinePoint;
 const inwardA=interior(a.side),inwardB=interior(b.side);
 const overlaps=Math.abs(gap)<=tolerance||Math.abs(gap)<(a.depth+b.depth)/2-tolerance;
 if(same(a.room.id,b.room.id)||!overlaps||!close(dot(inwardA,inwardB),-1)||
    corners.some(point=>!b.side.corners.some(target=>Math.hypot(...sub(sub(target,point),offset))<=tolerance)))
  throw new DoorPairEditError('alignment',b.opening.id,b.room.id);
 for(const endpoint of [a,b]){
  const safeSpot=endpoint.side.bottom.map((n,i)=>n+interior(endpoint.side)[i]!*.55) as AffinePoint;
  if(!insideRoom(endpoint.room,safeSpot))throw new DoorPairEditError('alignment',endpoint.opening.id,endpoint.room.id);
 }
}
