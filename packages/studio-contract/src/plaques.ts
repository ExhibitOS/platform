// SPDX-License-Identifier: AGPL-3.0-or-later
import {TEMPLATE_NAMESPACE} from './index.js';
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners,validateArtifactPose,type ArtifactPose} from './artifact-affine.js';
export const PLAQUE_NAMESPACE='org.exhibitos.studio/plaques';
export const PLAQUE_LIMITS=Object.freeze({count:32,bytes:16384,width:512,height:256,desktop:4,compact:2});
/** Room-local metres, +Y up; plane front is +Z. Text always comes from the source. */
export interface StudioPlaque {
 id:string;roomId:string;source:{kind:'exhibition'}|{kind:'room'}|{kind:'artwork';placementId:string};
 position:[number,number,number];rotation:[number,number,number,number];
 dimensions:{width:number;height:number};visible:boolean;
}
export interface StudioPlaques {version:1;plaques:StudioPlaque[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateStudioPlaques(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];
 const add=(code:string,path:string,message:string)=>errors.push({code,path:'/candidate/extensions/org.exhibitos.studio~1plaques'+path,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,PLAQUE_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[PLAQUE_NAMESPACE];
 if(!object(value)||!closed(value,['version','plaques'])||value.version!==1||!Array.isArray(value.plaques)){add('PLAQUE_SCHEMA','','Expected closed plaques version 1');return {valid:false,errors};}
 if(value.plaques.length>PLAQUE_LIMITS.count){add('PLAQUE_LIMIT','','Maximum 32 plaques');return {valid:false,errors};}
 const rooms=Array.isArray(candidate.rooms)?candidate.rooms.filter(object):[],placements=Array.isArray(candidate.placements)?candidate.placements.filter(object):[];
 const seen=new Set<string>();
 value.plaques.forEach((p,i)=>{
  const path='/plaques/'+i;
  if(!object(p)||!closed(p,['id','roomId','source','position','rotation','dimensions','visible'])||!uuid(p.id)||!uuid(p.roomId)||typeof p.visible!=='boolean'||!object(p.source)||!object(p.dimensions)||!closed(p.dimensions,['width','height'])||!finite(p.dimensions.width,.2,2)||!finite(p.dimensions.height,.15,1.2)) {add('PLAQUE_SCHEMA',path,'Invalid bounded plaque');return;}
  const s=p.source;
  if(s.kind==='artwork'?!closed(s,['kind','placementId'])||!uuid(s.placementId):!closed(s,['kind'])||(s.kind!=='room'&&s.kind!=='exhibition')){add('PLAQUE_SCHEMA',path+'/source','Expected an existing text source');return;}
  if(seen.has(p.id.toLowerCase()))add('PLAQUE_REFERENCE',path+'/id','Plaque UUID must be unique');seen.add(p.id.toLowerCase());
  const room=rooms.find(r=>typeof r.id==='string'&&equal(r.id,p.roomId as string));
  if(!room||!object(room.dimensions)){add('PLAQUE_REFERENCE',path+'/roomId','Existing room required');return;}
  if(s.kind==='artwork'&&!placements.some(a=>typeof a.id==='string'&&equal(a.id,s.placementId as string)&&typeof a.roomId==='string'&&equal(a.roomId,p.roomId as string)))add('PLAQUE_REFERENCE',path+'/source','Artwork placement must belong to this room');
  const dimensions=room.dimensions;
  try{
   const pose={position:p.position,rotation:p.rotation,scale:[1,1,1]} as ArtifactPose;validateArtifactPose(pose);
   const corners=artifactCorners(p.dimensions as {width:number;height:number},[pose]);
   if(corners.some(v=>Math.abs(v[0])>Number(dimensions.width)/2||v[1]<0||v[1]>Number(dimensions.height)||Math.abs(v[2])>Number(dimensions.depth)/2))throw Error();
   // Thin validation hull admits only geometry that remains representable in Float32.
   artifactCorners({...p.dimensions as {width:number;height:number},depth:.004},[pose,room.transform as unknown as ArtifactPose],true);
  }catch{add('PLAQUE_BOUNDS',path,'Complete plaque must fit its room and finite world geometry');}
 });
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>PLAQUE_LIMITS.bytes)add('PLAQUE_LIMIT','','Maximum 16 KiB plaque metadata');}catch{add('PLAQUE_SCHEMA','','Expected JSON metadata');}
 return {valid:errors.length===0,errors};
}
/** Use only after full document admission. Absence preserves legacy behavior. */
export function plaquesFor(document:Pick<Exhibition,'extensions'>):StudioPlaque[]{return structuredClone((document.extensions?.[PLAQUE_NAMESPACE] as unknown as StudioPlaques|undefined)?.plaques??[]);}
export function remapStudioPlaques(value:StudioPlaques,ids:ReadonlyMap<string,string>):StudioPlaques{
 const map=(id:string)=>{const next=ids.get(id.toLowerCase());if(!uuid(next))throw Error('PLAQUE_REFERENCE');return next;};
 return {version:1,plaques:value.plaques.map(p=>({...structuredClone(p),id:map(p.id),roomId:map(p.roomId),source:p.source.kind==='artwork'?{kind:'artwork',placementId:map(p.source.placementId)}:{kind:p.source.kind}}))};
}
export type PlaqueCommand={type:'add-plaque'|'set-plaque';plaque:StudioPlaque}|{type:'remove-plaque';plaqueId:string};
export function applyPlaqueCommand(document:Exhibition,command:PlaqueCommand):Exhibition{
 const next=structuredClone(document),plaques=plaquesFor(next),id=command.type==='remove-plaque'?command.plaqueId:command.plaque.id,index=plaques.findIndex(p=>equal(p.id,id));
 if(command.type==='add-plaque'?index>=0:index<0)throw Error('PLAQUE_REFERENCE');
 if(command.type==='remove-plaque')plaques.splice(index,1);else if(index<0)plaques.push(structuredClone(command.plaque));else plaques[index]=structuredClone(command.plaque);
 next.extensions={...next.extensions,[PLAQUE_NAMESPACE]:{version:1,plaques} as unknown as NonNullable<Exhibition['extensions']>[string]};
 if(next.extensions?.[TEMPLATE_NAMESPACE]){const template=next.extensions[TEMPLATE_NAMESPACE] as unknown as {modified:boolean};template.modified=true;}
 if(!validateStudioPlaques(next).valid)throw Error('PLAQUE_INVALID');return next;
}
