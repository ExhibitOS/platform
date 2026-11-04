// SPDX-License-Identifier: AGPL-3.0-or-later
import {TEMPLATE_NAMESPACE} from './index.js';
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners,validateArtifactPose,type ArtifactPose} from './artifact-affine.js';
export const PLAQUE_NAMESPACE='org.exhibitos.studio/plaques';
export const PLAQUE_LIMITS=Object.freeze({count:32,bytes:16384,width:512,height:256,desktop:4,compact:2,introductionText:1024,introductionLocales:8,captionLocales:8,captionArtist:80,captionDate:48});
export interface ArtworkPlaqueCaptionTranslation {locale:string;artist:string;date:string}
export interface ArtworkPlaqueCaption {translations:ArtworkPlaqueCaptionTranslation[]}
/** Room-local metres, +Y up; plane front is +Z. */
export interface StudioPlaque {
 id:string;roomId:string;source:{kind:'exhibition'}|{kind:'room'}|{kind:'artwork';placementId:string};
 position:[number,number,number];rotation:[number,number,number,number];
 dimensions:{width:number;height:number};visible:boolean;
 artworkCaption?:ArtworkPlaqueCaption;
}
export interface RoomPlaqueIntroduction {text:string;translations?:{locale:string;text:string}[]}
export interface StudioPlaques {
 version:1|2|3;plaques:StudioPlaque[];
 /** Authored source text shared by every room plaque for the same room. */
 roomIntroductions?:Record<string,RoomPlaqueIntroduction>;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=PLAQUE_LIMITS.introductionText;
const localeTag=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(v);
const allowed=(v:Record<string,unknown>,required:string[],optional:string[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const plaqueFields=['id','roomId','source','position','rotation','dimensions','visible'];
const captionText=(v:unknown,limit:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=limit&&
 !Array.from(v).some(character=>{const code=character.codePointAt(0)!;return code<32||code>=127&&code<=159||code===0x2028||code===0x2029;});
function validArtworkCaption(value:unknown):value is ArtworkPlaqueCaption {
 if(!object(value)||!closed(value,['translations'])||!Array.isArray(value.translations)||
  value.translations.length<1||value.translations.length>PLAQUE_LIMITS.captionLocales)return false;
 const tags=new Set<string>();
 for(const row of value.translations){
  if(!object(row)||!closed(row,['locale','artist','date'])||!localeTag(row.locale)||
   !captionText(row.artist,PLAQUE_LIMITS.captionArtist)||!captionText(row.date,PLAQUE_LIMITS.captionDate))return false;
  const tag=row.locale.toLowerCase();
  if(tags.has(tag))return false;
  tags.add(tag);
 }
 return true;
}
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateStudioPlaques(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];
 const add=(code:string,path:string,message:string)=>errors.push({code,path:'/candidate/extensions/org.exhibitos.studio~1plaques'+path,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,PLAQUE_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[PLAQUE_NAMESPACE];
 if(!object(value)||!Array.isArray(value.plaques)||!(value.version===1&&closed(value,['version','plaques'])||
  value.version===2&&closed(value,['version','plaques','roomIntroductions'])||
  value.version===3&&allowed(value,['version','plaques'],['roomIntroductions']))){add('PLAQUE_SCHEMA','','Expected closed plaques version 1, 2 or 3');return {valid:false,errors};}
 if(value.plaques.length>PLAQUE_LIMITS.count){add('PLAQUE_LIMIT','','Maximum 32 plaques');return {valid:false,errors};}
 if(value.version===3&&!value.plaques.some(p=>object(p)&&Object.hasOwn(p,'artworkCaption')))
  add('PLAQUE_SCHEMA','','Plaque version 3 requires an artwork caption');
 const rooms=Array.isArray(candidate.rooms)?candidate.rooms.filter(object):[],placements=Array.isArray(candidate.placements)?candidate.placements.filter(object):[];
 if(Object.hasOwn(value,'roomIntroductions')){
  const introductions=value.roomIntroductions;
  if(!object(introductions)||!Object.keys(introductions).length||Object.keys(introductions).length>PLAQUE_LIMITS.count)add('PLAQUE_SCHEMA','/roomIntroductions','Expected 1 to 32 room introductions');
  else {
   const ids=new Set<string>();
   for(const [roomId,intro] of Object.entries(introductions)){
    if(!uuid(roomId)){add('PLAQUE_REFERENCE','/roomIntroductions','Expected a room UUID');continue;}
    const path='/roomIntroductions/'+roomId,key=roomId.toLowerCase();
    if(ids.has(key)||!rooms.some(r=>typeof r.id==='string'&&equal(r.id,roomId)))add('PLAQUE_REFERENCE',path,'An existing room must have at most one introduction');
    ids.add(key);
    if(!object(intro)||!allowed(intro,['text'],['translations'])||!text(intro.text)){add('PLAQUE_SCHEMA',path,'Expected bounded plain introduction text');continue;}
    if(Object.hasOwn(intro,'translations')){
     const translations=intro.translations;
     if(!Array.isArray(translations)||translations.length>PLAQUE_LIMITS.introductionLocales){add('PLAQUE_SCHEMA',path+'/translations','Expected up to 8 translations');continue;}
     const tags=new Set<string>();
     translations.forEach((t,i)=>{
      if(!object(t)||!closed(t,['locale','text'])||!localeTag(t.locale)||!text(t.text)||tags.has(t.locale.toLowerCase()))add('PLAQUE_SCHEMA',path+'/translations/'+i,'Expected unique locale and bounded plain text');
      else tags.add(t.locale.toLowerCase());
     });
    }
   }
  }
 }
 const seen=new Set<string>();
 value.plaques.forEach((p,i)=>{
  const path='/plaques/'+i;
  if(!object(p)||!(value.version===3?allowed(p,plaqueFields,['artworkCaption']):closed(p,plaqueFields))||!uuid(p.id)||!uuid(p.roomId)||typeof p.visible!=='boolean'||!object(p.source)||!object(p.dimensions)||!closed(p.dimensions,['width','height'])||!finite(p.dimensions.width,.2,2)||!finite(p.dimensions.height,.15,1.2)) {add('PLAQUE_SCHEMA',path,'Invalid bounded plaque');return;}
  const s=p.source;
  if(s.kind==='artwork'?!closed(s,['kind','placementId'])||!uuid(s.placementId):!closed(s,['kind'])||(s.kind!=='room'&&s.kind!=='exhibition')){add('PLAQUE_SCHEMA',path+'/source','Expected an existing text source');return;}
  if(Object.hasOwn(p,'artworkCaption')&&(s.kind!=='artwork'||!validArtworkCaption(p.artworkCaption)))
   add('PLAQUE_SCHEMA',path+'/artworkCaption','Expected bounded localized artist and date on an artwork plaque');
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
const settingsFor=(document:Pick<Exhibition,'extensions'>)=>document.extensions?.[PLAQUE_NAMESPACE] as unknown as StudioPlaques|undefined;
/** Use only after full document admission. Absence preserves legacy behavior. */
export function plaquesFor(document:Pick<Exhibition,'extensions'>):StudioPlaque[]{return structuredClone(settingsFor(document)?.plaques??[]);}
function preferredTranslation<T extends {locale:string}>(translations:readonly T[]|undefined,locale:string|undefined):T|undefined {
 const tag=locale?.toLowerCase(),primary=tag?.split('-')[0];
 return translations?.find(t=>t.locale.toLowerCase()===tag)
  ??translations?.find(t=>t.locale.toLowerCase()===primary);
}
export function roomPlaqueIntroductionFor(document:Pick<Exhibition,'extensions'>,roomId:string,locale?:string):string|undefined {
 const entry=Object.entries(settingsFor(document)?.roomIntroductions??{}).find(([id])=>equal(id,roomId))?.[1];
 return preferredTranslation(entry?.translations,locale)?.text??entry?.text;
}
/** Use on an admitted plaque. Unmatched languages keep the original artwork metadata. */
export function artworkPlaqueCaptionFor(plaque:StudioPlaque,locale?:string):ArtworkPlaqueCaptionTranslation|undefined {
 return preferredTranslation(plaque.artworkCaption?.translations,locale);
}
export function remapStudioPlaques(value:StudioPlaques,ids:ReadonlyMap<string,string>):StudioPlaques{
 const map=(id:string)=>{const next=ids.get(id.toLowerCase());if(!uuid(next))throw Error('PLAQUE_REFERENCE');return next;};
 return {version:value.version,plaques:value.plaques.map(p=>({...structuredClone(p),id:map(p.id),roomId:map(p.roomId),source:p.source.kind==='artwork'?{kind:'artwork',placementId:map(p.source.placementId)}:{kind:p.source.kind}})),
  ...(value.roomIntroductions?{roomIntroductions:Object.fromEntries(Object.entries(value.roomIntroductions).map(([id,intro])=>[map(id),structuredClone(intro)]))}:{})};
}
function writeStudioPlaques(document:Exhibition,value:StudioPlaques):Exhibition {
 // Keep legacy shapes when the last version-specific field is removed.
 const version=value.plaques.some(p=>Object.hasOwn(p,'artworkCaption'))?3:value.roomIntroductions?2:1;
 const encoded={...value,version};
 document.extensions={...document.extensions,[PLAQUE_NAMESPACE]:encoded as unknown as NonNullable<Exhibition['extensions']>[string]};
 if(document.extensions?.[TEMPLATE_NAMESPACE]){const template=document.extensions[TEMPLATE_NAMESPACE] as unknown as {modified:boolean};template.modified=true;}
 if(!validateStudioPlaques(document).valid)throw Error('PLAQUE_INVALID');
 return document;
}
export function applyRoomPlaqueIntroduction(document:Exhibition,roomId:string,introduction:RoomPlaqueIntroduction|null):Exhibition {
 if(!validateStudioPlaques(document).valid)throw Error('PLAQUE_INVALID');
 const next=structuredClone(document),room=next.rooms.find(r=>equal(r.id,roomId));
 if(!room)throw Error('PLAQUE_REFERENCE');
 const settings:StudioPlaques=settingsFor(next)??{version:1,plaques:[]};
 const rows=settings.roomIntroductions??{};
 for(const key of Object.keys(rows))if(equal(key,room.id))delete rows[key];
 if(introduction!==null)rows[room.id]=structuredClone(introduction);
 if(Object.keys(rows).length)settings.roomIntroductions=rows;
 else delete settings.roomIntroductions;
 return writeStudioPlaques(next,settings);
}
export type PlaqueCommand={type:'add-plaque'|'set-plaque';plaque:StudioPlaque;roomIntroductionText?:string}|{type:'remove-plaque';plaqueId:string};
export function applyPlaqueCommand(document:Exhibition,command:PlaqueCommand):Exhibition{
 const next=structuredClone(document),plaques=plaquesFor(next),id=command.type==='remove-plaque'?command.plaqueId:command.plaque.id,index=plaques.findIndex(p=>equal(p.id,id));
 if(command.type==='add-plaque'?index>=0:index<0)throw Error('PLAQUE_REFERENCE');
 if(command.type==='remove-plaque')plaques.splice(index,1);else if(index<0)plaques.push(structuredClone(command.plaque));else plaques[index]=structuredClone(command.plaque);
 const updated=writeStudioPlaques(next,{...settingsFor(next),version:1,plaques});
 if(command.type==='remove-plaque'||command.roomIntroductionText===undefined)return updated;
 if(command.plaque.source.kind!=='room'||typeof command.roomIntroductionText!=='string')throw Error('PLAQUE_INVALID');
 const current=Object.entries(settingsFor(updated)?.roomIntroductions??{}).find(([id])=>equal(id,command.plaque.roomId))?.[1];
 if(command.roomIntroductionText===''&&current?.translations?.length)throw Error('PLAQUE_INVALID');
 return applyRoomPlaqueIntroduction(updated,command.plaque.roomId,command.roomIntroductionText===''?null:{...current,text:command.roomIntroductionText});
}
