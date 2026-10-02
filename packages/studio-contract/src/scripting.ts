// SPDX-License-Identifier: AGPL-3.0-or-later
/** Standalone development contract. Does not enable disabled base OES scripts or embed an extension. */
export type SpatialEvent =
 | {type:'room_enter'|'room_leave';roomId:string}
 | {type:'zone_enter'|'zone_leave';zoneId:string}
 | {type:'artwork_approach'|'artwork_look'|'artwork_click';placementId:string}
 | {type:'exhibition_start'|'exhibition_end'}
 | {type:'elapsed_time';atMs:number}
 | {type:'absolute_time';atUtc:string}
 | {type:'custom_event';name:string};
export type SpatialAction =
 | {type:'set_light';lightId:string;multiplier:number;delayMs:number}
 | {type:'play_audio';mediaAssetId:string;volume:number;delayMs:number}
 | {type:'stop_audio';mediaAssetId:string;delayMs:number}
 | {type:'show_text';text:string;locale:string;delayMs:number}
 | {type:'set_artwork_visibility';placementId:string;visible:boolean;delayMs:number}
 | {type:'emit_event';name:string;delayMs:number};
export interface SpatialProgram {version:1;rules:{id:string;trigger:SpatialEvent;actions:SpatialAction[];once:boolean}[]}
export interface SpatialScope {rooms:ReadonlySet<string>;zones:ReadonlySet<string>;placements:ReadonlySet<string>;lights:ReadonlySet<string>;mediaAssets:ReadonlySet<string>}
export interface SpatialValidation {valid:boolean;errors:{code:string;path:string;message:string}[]}
const identifier=/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const reference=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const language=/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,ks:string[])=>Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const milliseconds=(v:unknown)=>finite(v,0,3600000)&&Number.isInteger(v);
const utc=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&Date.parse(v)>=0&&Date.parse(v)<=4102444800000&&new Date(v).toISOString()===v;
/** Descriptor traversal does not read accessors. Only deserialized plain JSON is an external-input boundary.
 * JavaScript Proxy reflection traps cannot be identified portably; no hostile-JS sandbox is claimed. */
function plain(value:unknown):unknown {
 const seen=new Set<object>();let nodes=0,characters=0;
 const walk=(v:unknown,depth:number):unknown=>{
  if(++nodes>8192||depth>12)throw Error('structure');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('number');return v;}
  if(typeof v==='string'){characters+=v.length;if(characters>32768)throw Error('text');return v;}
  if(typeof v!=='object'||!v||seen.has(v))throw Error('plain');
  seen.add(v);
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error('prototype');
  const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);
  if(names.some(k=>typeof k!=='string')||names.length>(array?513:16))throw Error('keys');
  const out:unknown[]=[],record:Record<string,unknown>=Object.create(null);
  if(array){const length=descriptors.length?.value;if(!Number.isInteger(length)||length<0||length>512||names.length!==length+1)throw Error('array');for(let i=0;i<length;i++){const d=descriptors[String(i)];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw Error('accessor');out.push(walk(d.value,depth+1));}seen.delete(v);return out;}
  for(const key of names as string[]){const d=descriptors[key]!;characters+=key.length;if(!Object.hasOwn(d,'value')||!d.enumerable||characters>32768)throw Error('accessor');record[key]=walk(d.value,depth+1);}
  seen.delete(v);return record;
 };
 const result=walk(value,0);if(new TextEncoder().encode(JSON.stringify(result)).length>32768)throw Error('bytes');return result;
}
const matches=(v:unknown,pattern:RegExp)=>typeof v==='string'&&pattern.test(v);
function eventValid(e:unknown,scope:SpatialScope):boolean {
 if(!object(e))return false;
 const ref=(field:string,set:ReadonlySet<string>)=>exact(e,['type',field])&&matches(e[field],reference)&&set.has(e[field] as string);
 switch(e.type){
  case 'room_enter':case 'room_leave':return ref('roomId',scope.rooms);
  case 'zone_enter':case 'zone_leave':return ref('zoneId',scope.zones);
  case 'artwork_approach':case 'artwork_look':case 'artwork_click':return ref('placementId',scope.placements);
  case 'exhibition_start':case 'exhibition_end':return exact(e,['type']);
  case 'elapsed_time':return exact(e,['type','atMs'])&&milliseconds(e.atMs);
  case 'absolute_time':return exact(e,['type','atUtc'])&&utc(e.atUtc);
  case 'custom_event':return exact(e,['type','name'])&&matches(e.name,identifier);
  default:return false;
 }
}
function actionValid(a:unknown,scope:SpatialScope):boolean {
 if(!object(a)||!milliseconds(a.delayMs))return false;
 const ref=(field:string,set:ReadonlySet<string>)=>matches(a[field],reference)&&set.has(a[field] as string);
 switch(a.type){
  case 'set_light':return exact(a,['type','lightId','multiplier','delayMs'])&&ref('lightId',scope.lights)&&finite(a.multiplier,0,1);
  case 'play_audio':return exact(a,['type','mediaAssetId','volume','delayMs'])&&ref('mediaAssetId',scope.mediaAssets)&&finite(a.volume,0,1);
  case 'stop_audio':return exact(a,['type','mediaAssetId','delayMs'])&&ref('mediaAssetId',scope.mediaAssets);
  case 'show_text':return exact(a,['type','text','locale','delayMs'])&&typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=4096&&matches(a.locale,language);
  case 'set_artwork_visibility':return exact(a,['type','placementId','visible','delayMs'])&&ref('placementId',scope.placements)&&typeof a.visible==='boolean';
  case 'emit_event':return exact(a,['type','name','delayMs'])&&matches(a.name,identifier);
  default:return false;
 }
}
export function validateSpatialEvent(value:unknown,scope:SpatialScope):SpatialValidation {
 try {return eventValid(plain(value),scope)?{valid:true,errors:[]}:{valid:false,errors:[{code:'SPATIAL_EVENT_INVALID',path:'',message:'Expected a closed supported event and exact scoped references'}]};}
 catch {return {valid:false,errors:[{code:'SPATIAL_EVENT_INVALID',path:'',message:'Only bounded plain JSON events are accepted'}]};}
}
export function validateSpatialProgram(value:unknown,scope:SpatialScope):SpatialValidation {
 const errors:SpatialValidation['errors']=[];
 const fail=(path:string,message:string)=>{if(errors.length<32)errors.push({code:'SPATIAL_PROGRAM_INVALID',path,message});};
 let data:unknown;try{data=plain(value);}catch{fail('','Only bounded plain JSON within32KiB is accepted');return {valid:false,errors};}
 if(!object(data)||!exact(data,['version','rules'])||data.version!==1||!Array.isArray(data.rules)||data.rules.length>32){fail('','Expected closed version1 and at most32 rules');return {valid:false,errors};}
 const seen=new Set<string>();
 for(const [i,r]of data.rules.entries()){
  const path='/rules/'+i;
  if(!object(r)||!exact(r,['id','trigger','actions','once'])||!matches(r.id,identifier)||typeof r.once!=='boolean'||!Array.isArray(r.actions)||r.actions.length<1||r.actions.length>16){fail(path,'Expected stable rule ID, trigger,1..16 actions and explicit once boolean');continue;}
  if(seen.has(r.id as string))fail(path+'/id','Duplicate rule identity');seen.add(r.id as string);
  if(!eventValid(r.trigger,scope))fail(path+'/trigger','Unknown trigger, invalid time or out-of-scope exact reference');
  for(const [j,a]of r.actions.entries())if(!actionValid(a,scope))fail(path+'/actions/'+j,'Unknown action, extra fields, invalid bounds or out-of-scope exact reference');
 }
 return {valid:errors.length===0,errors};
}

/** Untrusted interchange enters as bounded JSON text, not a supplied executable JavaScript object. */
export function parseSpatialProgram(json:string,scope:SpatialScope):SpatialValidation & {program?:SpatialProgram} {
 try {
  if(typeof json!=='string'||json.length>32768||new TextEncoder().encode(json).length>32768)throw Error('bytes');
  const parsed:unknown=JSON.parse(json),result=validateSpatialProgram(parsed,scope);
  return result.valid?{...result,program:parsed as SpatialProgram}:result;
 }catch{return {valid:false,errors:[{code:'SPATIAL_PROGRAM_INVALID',path:'',message:'Expected valid plain JSON program within32KiB'}]};}
}
