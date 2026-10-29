// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,type AffinePoint} from '@exhibitos/studio-contract';
import type {PublicPublication} from '../publication-client';

export type MapPoint = [number,number]; // World X/Z metres, including room transforms.
export interface MapTarget {kind:'room'|'placement';id:string}
export interface VisitorMap {
 key:string;
 rooms:{id:string;name:string;outline:MapPoint[]}[];
 doors:{id:string;roomId:string;edge:[MapPoint,MapPoint];connection?:{doorId:string;roomId:string}}[];
 placements:{id:string;roomId:string;title:string;artworkType:string;point:MapPoint}[];
 bounds:{x:number;z:number;width:number;depth:number};
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const point=(v:AffinePoint):MapPoint=>[v[0],v[2]];
const unsupported=():never=>{throw Error('VISITOR_MAP_UNSUPPORTED');};

/** A schematic from admitted publication metadata, never a walkable-region or
 * destination certificate. No asset requests, renderer, physics or camera state.
 */
export function buildVisitorMap(document:Exhibition,source:Pick<PublicPublication['publication'],'id'|'revisionSha256'>):VisitorMap {
 // Match the existing walking display envelope; an unavailable map leaves the
 // independent text/list consumer intact rather than truncating identities.
 if(document.rooms.length>32||document.surfaces.length>256||document.openings.length>128||document.placements.length>128)unsupported();
 const room=(id:string)=>document.rooms.find(r=>same(r.id,id))??unsupported();
 const rooms=document.rooms.map(r=>({id:r.id,name:r.name,outline:([
  [-r.dimensions.width/2,0,-r.dimensions.depth/2],[r.dimensions.width/2,0,-r.dimensions.depth/2],
  [r.dimensions.width/2,0,r.dimensions.depth/2],[-r.dimensions.width/2,0,r.dimensions.depth/2],
 ] as AffinePoint[]).map(p=>point(artifactPoint(p,r.transform)))}));
 const doors=document.openings.filter(o=>o.type==='door').map(o=>{
  const wall=document.surfaces.find(s=>same(s.id,o.surfaceId));if(!wall||wall.type!=='wall')return unsupported();
  const r=room(wall.roomId),edge=([-1,1] as const).map(sign=>point(artifactPoint([o.offset[0]+sign*o.dimensions.width/2,o.offset[1],0],wall.transform,r.transform))) as [MapPoint,MapPoint];
  const other=o.connectsToOpeningId?document.openings.find(v=>same(v.id,o.connectsToOpeningId!)):undefined;
  const otherWall=other&&document.surfaces.find(s=>same(s.id,other.surfaceId));
  const paired=other?.type==='door'&&other.connectsToOpeningId&&same(other.connectsToOpeningId,o.id)&&otherWall?.type==='wall'&&!same(otherWall.roomId,r.id);
  return {id:o.id,roomId:r.id,edge,...(paired?{connection:{doorId:other!.id,roomId:room(otherWall!.roomId).id}}:{})};
 });
 const placements=document.placements.map(p=>{
  const art=document.artworks.find(a=>same(a.revisionId,p.artworkRevisionId));if(!art)return unsupported();
  const r=room(p.roomId);
  return {id:p.id,roomId:r.id,title:art.metadata.title,artworkType:art.artworkType,point:point(artifactPoint([0,0,0],art.transform,p.transform,r.transform))};
 });
 const points=[...rooms.flatMap(r=>r.outline),...doors.flatMap(d=>d.edge),...placements.map(p=>p.point)];
 const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
 const minX=points.length?Math.min(...xs):-1,maxX=points.length?Math.max(...xs):1,minZ=points.length?Math.min(...zs):-1,maxZ=points.length?Math.max(...zs):1;
 const pad=Math.max(.5,Math.max(maxX-minX,maxZ-minZ)*.05);
 return {key:source.id.toLowerCase()+'/'+source.revisionSha256,rooms,doors,placements,bounds:{x:minX-pad,z:minZ-pad,width:maxX-minX+2*pad,depth:maxZ-minZ+2*pad}};
}

/** Use the existing camera owner's world position/yaw snapshot. Pure projection;
 * never poll the camera, allocate a frame loop or infer the current room.
 */
export function visitorMapPose(position:AffinePoint,yaw:number) {
 if(!position.every(Number.isFinite)||!Number.isFinite(yaw))return undefined;
 return {point:point(position),direction:[-Math.sin(yaw),-Math.cos(yaw)] as MapPoint};
}

export interface MapSelection {key:string;hovered?:MapTarget;focused?:MapTarget;selected?:MapTarget}
export type MapIntent={key:string;type:'hover'|'leave'|'focus'|'blur'|'select';target:MapTarget}|{key:string;type:'dismiss'};
function target(map:VisitorMap,value:MapTarget):MapTarget|undefined {
 const rows=value.kind==='room'?map.rooms:map.placements,row=rows.find(r=>same(r.id,value.id));
 return row?{kind:value.kind,id:row.id}:undefined;
}
const matches=(a:MapTarget|undefined,b:MapTarget)=>a?.kind===b.kind&&same(a.id,b.id);
/** Hover/focus only preview; click/tap/keyboard activation explicitly selects.
 * A selection is an identity, never an instruction to teleport or play audio.
 */
export function selectVisitorMap(map:VisitorMap,state:MapSelection,intent:MapIntent):MapSelection {
 const next:MapSelection=state.key===map.key?{...state}:{key:map.key};
 if(intent.key!==map.key)return next;
 if(intent.type==='dismiss')return {key:map.key};
 const chosen=target(map,intent.target);if(!chosen)return next;
 if(intent.type==='hover')next.hovered=chosen;
 if(intent.type==='focus')next.focused=chosen;
 if(intent.type==='select')next.selected=chosen;
 if(intent.type==='leave'&&matches(next.hovered,chosen))delete next.hovered;
 if(intent.type==='blur'&&matches(next.focused,chosen))delete next.focused;
 return next;
}
export function visitorMapPreview(map:VisitorMap,state:MapSelection):MapTarget|undefined {
 if(state.key!==map.key)return undefined;
 const chosen=state.focused??state.hovered??state.selected;
 return chosen&&target(map,chosen);
}
