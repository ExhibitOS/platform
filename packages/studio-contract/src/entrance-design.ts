// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MaterialValidation} from './index.js';
export type EntranceThemeId='catalogue'|'poster'|'artwork'|'invitation'|'threshold';
export type EntranceCoverEffect='none'|'fold'|'mask'|'fade'|'card';
export type EntranceResponseEffect='none'|'tear'|'press'|'confirm';
export type EntranceTransitionEffect='none'|'doors'|'fade'|'panels';
export interface EntranceTranslation {locale:string;title?:string;shortTitle?:string;artist?:string;introduction?:string}
/** Optional authored fields stay absent in stored/OEX documents. Only the resolver fills defaults. */
export interface ViewerEntranceDesign {
 version:1;theme:EntranceThemeId;
 image?:{fit?:'contain'|'cover';focus?:[number,number]};
 palette?:'paper'|'light'|'dark';type?:'system'|'serif';
 ticket?:{showDate?:boolean;showTime?:boolean};
 layout?:{copyRatio?:number;margin?:number;titleScale?:number};
 effects?:{enabled?:boolean;cover?:EntranceCoverEffect;response?:EntranceResponseEffect;transition?:EntranceTransitionEffect;strength?:number;speed?:number;mobile?:'simple'|'none'};
 translations?:EntranceTranslation[];
}
export interface ResolvedEntranceDesign {
 version:1;theme:EntranceThemeId;
 image:{fit:'contain'|'cover';focus:[number,number]};palette:'paper'|'light'|'dark';type:'system'|'serif';
 ticket:{showDate:boolean;showTime:boolean};layout:{copyRatio:number;margin:number;titleScale:number};
 effects:{enabled:boolean;cover:EntranceCoverEffect;response:EntranceResponseEffect;transition:EntranceTransitionEffect;strength:number;speed:number;mobile:'simple'|'none'};
 translations:EntranceTranslation[];
}
export const ENTRANCE_THEMES:ReadonlyArray<{id:EntranceThemeId;label:string;cover:EntranceCoverEffect;response:EntranceResponseEffect;transition:EntranceTransitionEffect}>=Object.freeze([
 {id:'catalogue',label:'전시 도록',cover:'fold',response:'tear',transition:'doors'},
 {id:'poster',label:'전시 포스터',cover:'mask',response:'press',transition:'fade'},
 {id:'artwork',label:'작품 중심',cover:'fade',response:'press',transition:'fade'},
 {id:'invitation',label:'초대장',cover:'card',response:'confirm',transition:'panels'},
 {id:'threshold',label:'공간의 문턱',cover:'fade',response:'press',transition:'fade'},
]);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const one=(v:unknown,values:readonly unknown[])=>v===undefined||values.includes(v);
const bounded=(v:unknown,min:number,max:number)=>v===undefined||typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateEntranceDesign(value:unknown):MaterialValidation{
 const errors:MaterialValidation['errors']=[],fail=(message:string)=>errors.push({code:'VIEWER_ENTRANCE_DESIGN_INVALID',path:'/candidate/extensions/org.exhibitos.viewer~1entrance/design',message});
 if(!closed(value,['version','theme','image','palette','type','ticket','layout','effects','translations'])||!object(value)||value.version!==1||!ENTRANCE_THEMES.some(t=>t.id===value.theme)){fail('Expected a supported entrance design version and theme');return {valid:false,errors};}
 if(!one(value.palette,['paper','light','dark'])||!one(value.type,['system','serif']))fail('Expected a bounded built-in palette and font pair');
 if(value.image!==undefined){const i=value.image;if(!closed(i,['fit','focus'])||!object(i)||!one(i.fit,['contain','cover'])||i.focus!==undefined&&(!Array.isArray(i.focus)||i.focus.length!==2||!i.focus.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)))fail('Expected image contain/cover and normalized focal coordinates');}
 if(value.ticket!==undefined){const t=value.ticket;if(!closed(t,['showDate','showTime'])||!object(t)||!one(t.showDate,[true,false])||!one(t.showTime,[true,false]))fail('Expected local date and minute display switches');}
 if(value.layout!==undefined){const l=value.layout;if(!closed(l,['copyRatio','margin','titleScale'])||!object(l)||!bounded(l.copyRatio,.30,.70)||!bounded(l.margin,0,64)||!bounded(l.titleScale,.75,1.5)||value.theme==='catalogue'&&l.copyRatio!==undefined&&l.copyRatio!==.5)fail('Expected bounded layout controls; catalogue keeps equal half panels');}
 if(value.effects!==undefined){const e=value.effects,t=ENTRANCE_THEMES.find(t=>t.id===value.theme)!;if(!closed(e,['enabled','cover','response','transition','strength','speed','mobile'])||!object(e)||!one(e.enabled,[true,false])||!one(e.cover,['none',t.cover])||!one(e.response,['none',t.response])||!one(e.transition,['none',t.transition])||!bounded(e.strength,0,1)||!bounded(e.speed,.5,2)||!one(e.mobile,['simple','none']))fail('Expected compatible theme stages and bounded effect controls');}
 if(value.translations!==undefined){const entries=value.translations,seen=new Set<string>();if(!Array.isArray(entries)||entries.length>16)fail('Expected up to 16 locale variants');else for(const t of entries){if(!closed(t,['locale','title','shortTitle','artist','introduction'])||!object(t)||typeof t.locale!=='string'||t.locale.length>35||! /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(t.locale)||seen.has(t.locale.toLowerCase())||(['title','shortTitle','artist','introduction'] as const).some(k=>t[k]!==undefined&&(typeof t[k]!=='string'||t[k].length>({title:512,shortTitle:160,artist:512,introduction:4096}[k])))){fail('Expected unique bounded locale text');break;}seen.add(t.locale.toLowerCase());}}
 if(errors.length===0&&new TextEncoder().encode(JSON.stringify(value)).byteLength>100*1024)fail('Entrance design exceeds its metadata budget');
 return {valid:errors.length===0,errors};
}
const supplied=<T extends object>(value:T|undefined):Partial<T>=>Object.fromEntries(Object.entries(value??{}).filter(([,v])=>v!==undefined)) as Partial<T>;
/** Resolve into a fresh runtime object; never mutate or persist defaults into authored data. */
export function resolveEntranceDesign(value?:ViewerEntranceDesign):ResolvedEntranceDesign{
 if(value!==undefined&&!validateEntranceDesign(value).valid)throw Error('VIEWER_ENTRANCE_DESIGN_INVALID');
 const theme=value?.theme??'catalogue',t=ENTRANCE_THEMES.find(t=>t.id===theme)!;
 const layout={catalogue:[.5,32,1],poster:[.35,24,1.25],artwork:[.3,16,.85],invitation:[.5,48,1],threshold:[.3,16,.85]}[theme]!;
 return {version:1,theme,image:{fit:theme==='threshold'?'cover':'contain',focus:[.5,.5],...structuredClone(supplied(value?.image))},palette:value?.palette??(theme==='threshold'?'dark':theme==='catalogue'||theme==='invitation'?'paper':'light'),type:value?.type??(theme==='invitation'?'serif':'system'),ticket:{showDate:true,showTime:true,...supplied(value?.ticket)},layout:{copyRatio:layout[0]!,margin:layout[1]!,titleScale:layout[2]!,...supplied(value?.layout)},effects:{enabled:true,cover:t.cover,response:t.response,transition:t.transition,strength:.75,speed:1,mobile:'simple',...supplied(value?.effects)},translations:structuredClone(value?.translations??[])};
}
