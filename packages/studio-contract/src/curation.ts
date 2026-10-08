// SPDX-License-Identifier: AGPL-3.0-or-later
import { experienceFor, validateViewerExperience } from './experience.js';
export const CURATION_NAMESPACE = 'org.exhibitos.viewer/curation';
export interface TranscriptCue {start:number;end:number;text:string}
export interface TimedTranscript {placementId:string;locale:string;durationSeconds:number;cues:TranscriptCue[];translations:{locale:string;cues:TranscriptCue[]}[]}
export interface ZoneAudioControl {zoneId:string;referenceDistance:number;maxDistance:number;rolloff:number;occlusion:{enabled:boolean;closedGain:number}}
export interface AnnotationTranslation {annotationId:string;locale:string;text:string}
export interface GuidedRoute {routeId:string;stops:{waypointIndex:number;title:string;description:string;placementId?:string}[]}
export interface ViewerCuration {version:1;audioZones:ZoneAudioControl[];transcripts:TimedTranscript[];annotationTranslations:AnnotationTranslation[];routes:GuidedRoute[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const locale=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(v);
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
/** Optional profile is closed and bounded. Complete base/experience validation remains the caller's responsibility. */
export function validateViewerCuration(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];
 const fail=(suffix:string,message:string)=>errors.push({code:'VIEWER_CURATION_INVALID',path:'/extensions/org.exhibitos.viewer~1curation'+suffix,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,CURATION_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[CURATION_NAMESPACE];
 if(!object(value)||!keys(value,['version','audioZones','transcripts','annotationTranslations','routes'])||value.version!==1){fail('','Expected closed curation version1 profile');return {valid:false,errors};}
 const list=(name:string)=>Array.isArray(candidate[name])?candidate[name].filter(object):[];
 const find=(name:string,id:unknown)=>typeof id==='string'?list(name).find(x=>x.id===id):undefined;
 if(!validateViewerExperience(candidate).valid){fail('','Curation requires a valid compatible experience profile');return {valid:false,errors};}
 const exp=experienceFor(candidate);
 const cues=(xs:unknown,duration:number)=>{
  if(!Array.isArray(xs)||xs.length<1||xs.length>128)return false;
  let end=0;for(const x of xs){if(!object(x)||!keys(x,['start','end','text'])||!number(x.start,0,duration)||!number(x.end,0,duration)||x.end<=x.start||x.start<end||!text(x.text,4096))return false;end=x.end;}return true;
 };
 const check=(name:string,max:number,valid:(x:Record<string,unknown>)=>boolean,id:(x:Record<string,unknown>)=>string)=>{
  const xs=value[name];if(!Array.isArray(xs)||xs.length>max){fail('/'+name,'Bounded array required');return;}
  const seen=new Set<string>();for(const [i,x]of xs.entries()){if(!object(x)||!valid(x)){fail('/'+name+'/'+i,'Invalid entry, exact reference, timing or bounds');continue;}const key=id(x);if(seen.has(key))fail('/'+name+'/'+i,'Duplicate identity');seen.add(key);}
 };
 check('audioZones',64,x=>keys(x,['zoneId','referenceDistance','maxDistance','rolloff','occlusion'])&&!!find('audioZones',x.zoneId)&&number(x.referenceDistance,1,1000)&&number(x.maxDistance,x.referenceDistance,1000)&&number(x.rolloff,0,4)&&object(x.occlusion)&&keys(x.occlusion,['enabled','closedGain'])&&typeof x.occlusion.enabled==='boolean'&&number(x.occlusion.closedGain,0,1),x=>String(x.zoneId));
 check('transcripts',64,x=>{
  if(!keys(x,['placementId','locale','durationSeconds','cues','translations'])||!find('placements',x.placementId)||!locale(x.locale)||!number(x.durationSeconds,0.000001,60)||!cues(x.cues,x.durationSeconds)||!Array.isArray(x.translations)||x.translations.length>16)return false;
  const voice=Array.isArray(exp.voices)?exp.voices.find(v=>v.placementId===x.placementId&&v.locale===x.locale):undefined;if(!voice||!find('mediaAssets',voice.assetId))return false;
  const seen=new Set<string>([x.locale.toLowerCase()]);for(const t of x.translations){if(!object(t)||!keys(t,['locale','cues'])||!locale(t.locale)||seen.has(t.locale.toLowerCase())||!cues(t.cues,x.durationSeconds))return false;seen.add(t.locale.toLowerCase());}return true;
 },x=>String(x.placementId)+':'+String(x.locale).toLowerCase());
 check('annotationTranslations',256,x=>keys(x,['annotationId','locale','text'])&&!!find('annotations',x.annotationId)&&locale(x.locale)&&text(x.text,16384),x=>String(x.annotationId)+':'+String(x.locale).toLowerCase());
 check('routes',32,x=>{
  if(!keys(x,['routeId','stops'])||!Array.isArray(x.stops)||x.stops.length<1||x.stops.length>64)return false;
  const route=find('navigation',x.routeId);if(!route||!Array.isArray(route.waypoints)||route.waypoints.length!==x.stops.length)return false;
  return x.stops.every((s,i)=>object(s)&&keys(s,['waypointIndex','title','description'],['placementId'])&&s.waypointIndex===i&&text(s.title,512)&&text(s.description,16384)&&(s.placementId===undefined||!!find('placements',s.placementId)));
 },x=>String(x.routeId));
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>262144)fail('','Maximum256KiB curation metadata');}catch{fail('','JSON metadata required');}
 return {valid:errors.length===0,errors};
}
/** Call only after complete draft validation; retains authored full transcripts separately. */
export function curationFor(candidate:{extensions?:unknown}):ViewerCuration {
 const value=object(candidate.extensions)?candidate.extensions[CURATION_NAMESPACE]:undefined;
 return structuredClone((value as ViewerCuration|undefined)??{version:1,audioZones:[],transcripts:[],annotationTranslations:[],routes:[]});
}
/** Audio bytes are independently integrity/rights checked by the server before this temporal binding. */
export function curationDurationValid(candidate:{extensions?:unknown},assetId:string,durationSeconds:number):boolean {
 const voices=experienceFor(candidate).voices??[];
 return curationFor(candidate).transcripts.filter(t=>voices.some(v=>v.placementId===t.placementId&&v.locale===t.locale&&v.assetId===assetId)).every(t=>Math.abs(t.durationSeconds-durationSeconds)<=0.001);
}
