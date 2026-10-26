// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners,artifactBounds,validateArtifactHull,createConvexCollision,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {surfacePanels} from './surface-panels.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';
export const ARCHITECTURAL_FINISH_NAMESPACE='org.exhibitos.studio/architectural-finishes';
export const ARCHITECTURAL_FINISH_LIMITS=Object.freeze({walls:8,bytes:8192,openingsPerWall:8,boxes:256,triangles:3072});
export interface WallFinish {surfaceId:string;depth:number;preset:'plain'|'painted-edge'|'dark-edge';trimWidth:number;baseboardHeight:number;ceilingBand:boolean}
export interface ArchitecturalFinishes {version:1;walls:WallFinish[]}
export interface ArchitecturalBox {position:AffinePoint;dimensions:{width:number;height:number;depth:number};kind:'structure'|'finish'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
/** XY never enters the original opening. No sill/threshold, or independent door geometry. */
export function architecturalWallBoxes(surface:Exhibition['surfaces'][number],openings:Exhibition['openings'],settings:WallFinish):ArchitecturalBox[]{
 const panels=surfacePanels(surface,openings),boxes:ArchitecturalBox[]=panels.map(p=>({position:[p.x,p.y,0],dimensions:{width:p.width,height:p.height,depth:settings.depth},kind:'structure'}));
 if(settings.preset==='plain')return boxes;
 const w=surface.dimensions.width,h=surface.dimensions.height,t=settings.trimWidth,bands:{l:number;r:number;b:number;t:number}[]=[];
 // Junctions lie on the same existing solid wall, never on the walkable floor.
 bands.push({l:-w/2,r:w/2,b:-h/2,t:-h/2+settings.baseboardHeight});
 if(settings.ceilingBand)bands.push({l:-w/2,r:w/2,b:h/2-t,t:h/2});
 for(const o of openings.filter(o=>equal(o.surfaceId,surface.id))){const l=o.offset[0]-o.dimensions.width/2,r=o.offset[0]+o.dimensions.width/2,b=o.offset[1]-o.dimensions.height/2,top=o.offset[1]+o.dimensions.height/2;
  bands.push({l:l-t,r:l,b,t:top+t},{l:r,r:r+t,b,t:top+t},{l,r,b:top,t:top+t});
 }
 for(const p of panels){const l=p.x-p.width/2,r=p.x+p.width/2,b=p.y-p.height/2,top=p.y+p.height/2;
  const xs=[...new Set([l,r,...bands.flatMap(v=>[v.l,v.r]).filter(x=>x>l&&x<r)])].sort((a,b)=>a-b),ys=[...new Set([b,top,...bands.flatMap(v=>[v.b,v.t]).filter(y=>y>b&&y<top)])].sort((a,b)=>a-b);
  for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){if(xs[i]!-xs[i-1]!<=1e-8||ys[j]!-ys[j-1]!<=1e-8)continue;const x=(xs[i-1]!+xs[i]!)/2,y=(ys[j-1]!+ys[j]!)/2;if(!bands.some(v=>x>v.l&&x<v.r&&y>v.b&&y<v.t))continue;
   for(const side of [-1,1])boxes.push({position:[x,y,side*(settings.depth/2+.001)],dimensions:{width:xs[i]!-xs[i-1]!,height:ys[j]!-ys[j-1]!,depth:.002},kind:'finish'});
   if(boxes.length>ARCHITECTURAL_FINISH_LIMITS.boxes)throw Error('ARCHITECTURAL_FINISH_LIMIT');
  }
 }
 return boxes;
}
function boxVertices(box:ArchitecturalBox,surface:ArtifactPose,room:ArtifactPose){const vertices=artifactCorners(box.dimensions,[{position:box.position,rotation:[0,0,0,1],scale:[1,1,1]},surface,room]);validateArtifactHull(vertices);return vertices;}
export function wallFinishesFor(document:Pick<Exhibition,'extensions'>):WallFinish[]{return structuredClone((document.extensions?.[ARCHITECTURAL_FINISH_NAMESPACE] as unknown as ArchitecturalFinishes|undefined)?.walls??[]);}
export function validateArchitecturalFinishes(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];const add=(code:string,path:string,message:string)=>errors.push({code,path:'/candidate/extensions/org.exhibitos.studio~1architectural-finishes'+path,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,ARCHITECTURAL_FINISH_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[ARCHITECTURAL_FINISH_NAMESPACE];
 if(!object(value)||Object.keys(value).sort().join(',')!=='version,walls'||value.version!==1||!Array.isArray(value.walls)||value.walls.length>8){add('ARCHITECTURAL_FINISH_SCHEMA','','Expected closed version1 with at most8 walls');return {valid:false,errors};}
 if(!['surfaces','rooms','openings','placements','artworks'].every(k=>Array.isArray(candidate[k]))){add('ARCHITECTURAL_FINISH_SCHEMA','','Expected full exhibition arrays');return {valid:false,errors};}
 const document=candidate as unknown as Exhibition,seen=new Set<string>();let count=0;
 for(const [i,row]of value.walls.entries()){
  const path='/walls/'+i;
  if(!object(row)||Object.keys(row).sort().join(',')!=='baseboardHeight,ceilingBand,depth,preset,surfaceId,trimWidth'||!uuid(row.surfaceId)||!finite(row.depth,.02,.2)||!finite(row.trimWidth,.02,.08)||!finite(row.baseboardHeight,.04,.15)||!['plain','painted-edge','dark-edge'].includes(row.preset as string)||typeof row.ceilingBand!=='boolean'){add('ARCHITECTURAL_FINISH_SCHEMA',path,'Expected bounded existing wall finish');continue;}
  if(seen.has(row.surfaceId.toLowerCase()))add('ARCHITECTURAL_FINISH_REFERENCE',path,'Wall must be unique');seen.add(row.surfaceId.toLowerCase());
  const surface=document.surfaces.find(s=>s&&typeof s.id==='string'&&equal(s.id,row.surfaceId as string)),room=surface&&document.rooms.find(r=>r&&typeof r.id==='string'&&typeof surface.roomId==='string'&&equal(r.id,surface.roomId));
  if(!surface||surface.type!=='wall'||!room){add('ARCHITECTURAL_FINISH_REFERENCE',path,'Existing wall and room required');continue;}
  if(document.openings.filter(o=>o&&typeof o.surfaceId==='string'&&equal(o.surfaceId,surface.id)).length>8){add('ARCHITECTURAL_FINISH_LIMIT',path,'Maximum8 openings per styled wall');continue;}
  try{
   const footprint=artifactCorners(surface.dimensions,[surface.transform]);
   if(footprint.some(p=>Math.abs(p[0])>room.dimensions.width/2+1e-6||p[1]<-1e-6||p[1]>room.dimensions.height+1e-6||Math.abs(p[2])>room.dimensions.depth/2+1e-6))throw Error('WALL_TANGENTIAL_BOUNDS');
   const boxes=architecturalWallBoxes(surface,document.openings,row as unknown as WallFinish);count+=boxes.length;
   const bounds=boxes.map(box=>artifactBounds(boxVertices(box,surface.transform,room.transform)));
   // Conservative world assertion AABBs prevent silently burying existing artwork.
   for(const placement of document.placements??[]){const art=document.artworks.find(a=>equal(a.revisionId,placement.artworkRevisionId)),artRoom=document.rooms.find(r=>equal(r.id,placement.roomId));if(!art||!artRoom)throw Error();const a=artifactBounds(artifactCorners(art.dimensions,[art.transform,placement.transform,artRoom.transform],true));if(bounds.some(b=>[0,1,2].every(j=>Math.min(a.max[j]!,b.max[j]!)-Math.max(a.min[j]!,b.min[j]!)>.001)))throw Error('ARTWORK_OBSCURED');}
  }catch(error){add('ARCHITECTURAL_FINISH_BOUNDS',path,error instanceof Error&&error.message==='ARTWORK_OBSCURED'?'Finish would intersect an existing artwork assertion':'Generated boxes must fit finite affine/Float32 and opening limits');}
 }
 if(count>256)add('ARCHITECTURAL_FINISH_LIMIT','','Maximum256 generated boxes/3072 triangles');
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>8192)add('ARCHITECTURAL_FINISH_LIMIT','','Maximum8KiB metadata');}catch{add('ARCHITECTURAL_FINISH_SCHEMA','','Expected JSON');}
 return {valid:errors.length===0,errors};
}
export function remapArchitecturalFinishes(value:ArchitecturalFinishes,ids:ReadonlyMap<string,string>):ArchitecturalFinishes{return {version:1,walls:value.walls.map(w=>{const id=ids.get(w.surfaceId.toLowerCase());if(!uuid(id))throw Error('ARCHITECTURAL_FINISH_REFERENCE');return {...structuredClone(w),surfaceId:id};})};}
export type ArchitecturalFinishCommand={type:'set-wall-finish';wall:WallFinish}|{type:'remove-wall-finish';surfaceId:string};
/** Pure prospective Preview. Host explicitly accepts Apply/history or discards Cancel. */
export function applyArchitecturalFinishCommand(document:Exhibition,command:ArchitecturalFinishCommand){
 const next=structuredClone(document),walls=wallFinishesFor(next),id=command.type==='set-wall-finish'?command.wall.surfaceId:command.surfaceId,index=walls.findIndex(w=>equal(w.surfaceId,id));
 if(command.type==='remove-wall-finish'){if(index<0)throw Error('ARCHITECTURAL_FINISH_REFERENCE');walls.splice(index,1);}else if(index<0)walls.push(structuredClone(command.wall));else walls[index]=structuredClone(command.wall);
 next.extensions={...next.extensions,[ARCHITECTURAL_FINISH_NAMESPACE]:{version:1,walls} as unknown as NonNullable<Exhibition['extensions']>[string]};if(next.extensions[TEMPLATE_NAMESPACE])(next.extensions[TEMPLATE_NAMESPACE] as unknown as {modified:boolean}).modified=true;
 if(!validateArchitecturalFinishes(next).valid)throw Error('ARCHITECTURAL_FINISH_INVALID');return next;
}
const indices=[0,2,3,0,3,1,4,5,7,4,7,6,0,1,5,0,5,4,2,6,7,2,7,3,0,4,6,0,6,2,1,3,7,1,7,5];
/** Same transformed vertices serve Rapier and authoritative presence; transforms apply exactly once. */
export function architecturalSolids(document:Exhibition){
 if(!validateArchitecturalFinishes(document).valid)throw Error('ARCHITECTURAL_FINISH_INVALID');
 return wallFinishesFor(document).flatMap(w=>{const surface=document.surfaces.find(s=>equal(s.id,w.surfaceId))!,room=document.rooms.find(r=>equal(r.id,surface.roomId))!;return architecturalWallBoxes(surface,document.openings,w).map(box=>{const vertices=boxVertices(box,surface.transform,room.transform);return {surfaceId:surface.id,roomId:room.id,kind:box.kind,vertices,indices:[...indices],collision:createConvexCollision(vertices,indices)};});});
}
