// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MaterialValidation } from './index.js';
export const DAYLIGHT_NAMESPACE='org.exhibitos.studio/daylight';
export const TEMPLATE_NAMESPACE='org.exhibitos.studio/template';
export interface Daylight {version:1;date:string;hour:number;latitude:number;northDegrees:number;intensity:number;enabled:boolean}
export interface TemplateProvenance {version:1;name:string;creator:string;license:'CC0-1.0'|'CC-BY-4.0'|'private';source:string;modified:boolean;profile:'oes-rectangles-v1'}
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const bounded=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
function safeSource(x:unknown):boolean {if(typeof x!=='string')return false;if(/^bundled:[a-z0-9-]+$/.test(x))return true;try{const url=new URL(x);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}}
export function validateArchitecture(candidate:unknown,redistribute=false):MaterialValidation {
 const errors:MaterialValidation['errors']=[];
 const add=(namespace:string,message:string)=>errors.push({code:'STUDIO_ARCHITECTURE_INVALID',path:'/candidate/extensions/'+namespace.replaceAll('/','~1'),message});
 if(!obj(candidate))return {valid:true,errors};
 if(Array.isArray(candidate.lights))candidate.lights.forEach((light,i)=>{if(!obj(light))return;const dimensions=light.dimensions;const transform=light.transform;const position=obj(transform)?transform.position:undefined;if(!bounded(light.intensity,0,1000000)||!Array.isArray(position)||position.some(n=>!bounded(n,-10000,10000))||(light.type==='area'&&(!obj(dimensions)||!bounded(dimensions.width,.01,100)||!bounded(dimensions.height,.01,100))))errors.push({code:'STUDIO_LIGHT_RANGE',path:'/candidate/lights/'+i,message:'Renderer light profile requires finite intensity0..1e6, positions within10000m and area dimensions0.01..100m'});});
 if(!obj(candidate.extensions))return {valid:errors.length===0,errors};
 const d=candidate.extensions[DAYLIGHT_NAMESPACE];
 if(d!==undefined&&(!obj(d)||!exact(d,['version','date','hour','latitude','northDegrees','intensity','enabled'])||d.version!==1||typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||Number.isNaN(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date||!bounded(d.hour,0,24)||!bounded(d.latitude,-90,90)||!bounded(d.northDegrees,0,360)||!bounded(d.intensity,0,5)||typeof d.enabled!=='boolean'))add(DAYLIGHT_NAMESPACE,'Expected bounded version1 visual solar controls and a valid calendar date');
 const t=candidate.extensions[TEMPLATE_NAMESPACE];
 if(t!==undefined){
  if(!obj(t)||!exact(t,['version','name','creator','license','source','modified','profile'])||t.version!==1||t.profile!=='oes-rectangles-v1'||typeof t.modified!=='boolean'||!['CC0-1.0','CC-BY-4.0','private'].includes(t.license as string)||!['name','creator','source'].every(k=>typeof t[k]==='string'&&(t[k] as string).trim().length>0&&(t[k] as string).length<=512)||!safeSource(t.source))add(TEMPLATE_NAMESPACE,'Expected explicit template license, attribution, safe source and supported rectangle profile');
  else if(redistribute&&t.license==='private')errors.push({code:'TEMPLATE_REDISTRIBUTION_DENIED',path:'/candidate/extensions/'+TEMPLATE_NAMESPACE.replaceAll('/','~1'),message:'Private or unlicensed templates cannot be redistributed; obtain a supported explicit license'});
 }
 return {valid:errors.length===0,errors};
}
/** Visual solar direction only: no irradiance, glazing, weather or architectural compliance model. */
export function daylightDirection(d:Daylight):[number,number,number]{
 const day=Math.floor((Date.parse(d.date+'T00:00:00Z')-Date.UTC(Number(d.date.slice(0,4)),0,1))/86400000)+1;
 const dec=23.44*Math.PI/180*Math.sin(2*Math.PI*(day-81)/365), lat=d.latitude*Math.PI/180, h=(d.hour-12)*Math.PI/12,n=d.northDegrees*Math.PI/180;
 const x=Math.cos(dec)*Math.sin(h),y=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(h),z=Math.cos(lat)*Math.sin(dec)-Math.sin(lat)*Math.cos(dec)*Math.cos(h);
 return [x*Math.cos(n)-z*Math.sin(n),y,x*Math.sin(n)+z*Math.cos(n)];
}
export function daylightFor(c:{extensions?:unknown}):Daylight|undefined{return obj(c.extensions)?c.extensions[DAYLIGHT_NAMESPACE] as Daylight|undefined:undefined;}
