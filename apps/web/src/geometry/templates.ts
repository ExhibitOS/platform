// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {TEMPLATE_NAMESPACE,DAYLIGHT_NAMESPACE,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,validateArchitecture,type TemplateProvenance} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {validateDraft} from '../drafts/validator';
import {newRoom,whiteCubeSurfaces,newDoor} from './model';
export function validateTemplate(candidate:Exhibition,redistribute=false):void {
 if(!candidate.extensions?.[TEMPLATE_NAMESPACE]||!validateArchitecture(candidate,redistribute).valid)throw Error('Template license, provenance or compatibility is invalid.');
 if(Object.keys(candidate.extensions??{}).some(k=>![TEMPLATE_NAMESPACE,DAYLIGHT_NAMESPACE,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE].includes(k)))throw Error('Unsupported template extension; remove private or incompatible metadata explicitly.');
 if(candidate.artworks.length||candidate.placements.length||candidate.mediaAssets.length||candidate.audioZones.length||candidate.scripts.length||candidate.annotations.length)throw Error('Architecture templates cannot contain artwork, media, scripts or personal annotations.');
 const draft=newDraft();draft.candidate=candidate;draft.exhibitionId=candidate.id;
 if(!validateDraft(draft).valid)throw Error('Template geometry or references are invalid.');
}
export function duplicateTemplate(source:Exhibition,target:Exhibition):Exhibition {
 validateTemplate(source);
 if(Object.keys(target.extensions??{}).some(k=>![TEMPLATE_NAMESPACE,DAYLIGHT_NAMESPACE,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE].includes(k)))throw Error('Target draft has unsupported or private metadata; create an empty draft to preserve it.');
 if(target.artworks.length||target.placements.length||target.mediaAssets.length||target.audioZones.length||target.scripts.length||target.annotations.length)throw Error('Create an empty draft before applying an architecture template; existing artworks are preserved.');
 const map=new Map<string,string>();
 const collect=(v:unknown):void=>{if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(k==='id'&&typeof x==='string')map.set(x.toLowerCase(),crypto.randomUUID());else collect(x);}};collect(source);
 map.set(source.id.toLowerCase(),target.id);map.set(source.revisionId.toLowerCase(),target.revisionId);
 const references=new Set(['id','revisionId','roomId','surfaceId','connectsToOpeningId','viaOpeningId','routeIds','targetId']);
 const remap=(v:unknown,field=''):unknown=>typeof v==='string'?(references.has(field)?map.get(v.toLowerCase())??v:v):Array.isArray(v)?v.map(x=>remap(x,field)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[field==='surfaces'?map.get(k.toLowerCase())??k:k,remap(x,k)])):v;
 const next=remap(source) as Exhibition;next.id=target.id;next.revisionId=target.revisionId;next.createdAt=target.createdAt;next.revision=target.revision;
 const provenance=next.extensions![TEMPLATE_NAMESPACE] as unknown as TemplateProvenance;provenance.modified=true;
 return next;
}
export function bundledTemplate():Exhibition {
 const e=newDraft('연결된 두 전시실').candidate,r1=e.rooms[0]!,r2=newRoom('두 번째 전시실',{width:12,height:4,depth:8},{position:[12,0,0],rotation:[0,0,0,1],scale:[1,1,1]});e.rooms.push(r2);e.surfaces=[...whiteCubeSurfaces(r1),...whiteCubeSurfaces(r2)];
 const first=newDoor(e.surfaces[3]!.id,{width:2,height:2.5},[0,-.75]),second=newDoor(e.surfaces[8]!.id,{width:2,height:2.5},[0,-.75]);first.connectsToOpeningId=second.id;second.connectsToOpeningId=first.id;delete first.exterior;delete second.exterior;e.openings=[first,second];
 e.openings.push({id:crypto.randomUUID(),surfaceId:e.surfaces[0]!.id,type:'window',dimensions:{width:3,height:1.5},offset:[0,.5]});
 const routeId=crypto.randomUUID();e.navigation=[{id:routeId,name:'Level connected-room route',accessible:true,waypoints:[{roomId:r1.id,position:[4,1.65,0]},{roomId:r2.id,position:[-4,1.65,0],viaOpeningId:first.id}]}];e.accessibility.routeIds=[routeId];
 e.extensions={[TEMPLATE_NAMESPACE]:{version:1,name:'Synthetic connected gallery',creator:'ExhibitOS contributors',license:'CC0-1.0',source:'bundled:connected-gallery',modified:false,profile:'oes-rectangles-v1'},[DAYLIGHT_NAMESPACE]:{version:1,date:'2026-06-21',hour:12,latitude:37.5,northDegrees:0,intensity:1,enabled:true}};
 return e;
}

export async function readTemplateFile(file:{size:number;text:()=>Promise<string>},target:Exhibition,isCurrent:()=>boolean):Promise<Exhibition>{if(file.size>262144)throw Error('Template 최대256KiB');const text=await file.text();if(!isCurrent())throw Error('Draft changed while reading template; import cancelled without replacing newer changes.');return duplicateTemplate(JSON.parse(text) as Exhibition,target);}
