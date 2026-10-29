// SPDX-License-Identifier: AGPL-3.0-or-later
import {DEFAULT_MATERIAL,isPbrMaterial,type PbrMaterial} from './pbr-material.js';
export const FLOOR_NAMESPACE='org.exhibitos.studio/floors';
export type FloorPreset='wood'|'marble'|'tile'|'carpet';
export type FloorTarget={kind:'surface';surfaceId:string}|{kind:'room-base';roomId:string};
export type FloorTexturePack={id:'WoodFloor051'|'Marble006'|'Tiles074'|'Carpet004';version:1};
export type FloorSound={mode:'material-default'|'none';gain:number}|{mode:'explicit';gain:number;assetIds:string[]};
export interface FloorBinding {target:FloorTarget;preset:FloorPreset;repeatMeters:[number,number];rotation:number;materialOverride?:Partial<PbrMaterial>;texturePack?:FloorTexturePack;normalScale?:number;aoStrength?:number;sound?:FloorSound}
export interface StudioFloors {version:1;bindings:FloorBinding[]}
export interface FloorIssue {code:'FLOOR_SCHEMA'|'FLOOR_REFERENCE'|'FLOOR_LIMIT';path:string;message:string}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const presets:readonly string[]=['wood','marble','tile','carpet'];
const packs:readonly string[]=['WoodFloor051','Marble006','Tiles074','Carpet004'];
export function floorTargetKey(target:FloorTarget):string {return target.kind==='surface'?'surface:'+target.surfaceId.toLowerCase():'room-base:'+target.roomId.toLowerCase();}
function target(v:unknown):v is FloorTarget {return obj(v)&&(v.kind==='surface'?closed(v,['kind','surfaceId'])&&uuid(v.surfaceId):v.kind==='room-base'&&closed(v,['kind','roomId'])&&uuid(v.roomId));}
function sound(v:unknown):v is FloorSound {
 if(!obj(v)||!num(v.gain,0,1))return false;
 if(v.mode!=='explicit')return (v.mode==='material-default'||v.mode==='none')&&closed(v,['mode','gain']);
 return closed(v,['mode','gain','assetIds'])&&Array.isArray(v.assetIds)&&v.assetIds.length>=1&&v.assetIds.length<=16&&v.assetIds.every(uuid)&&new Set(v.assetIds.map(id=>id.toLowerCase())).size===v.assetIds.length;
}
function binding(v:unknown):v is FloorBinding {
 if(!obj(v)||!closed(v,['target','preset','repeatMeters','rotation'],['materialOverride','texturePack','normalScale','aoStrength','sound'])||!target(v.target)||(typeof v.preset!=='string'||!presets.includes(v.preset))||!Array.isArray(v.repeatMeters)||v.repeatMeters.length!==2||!v.repeatMeters.every(n=>num(n,.05,20))||!num(v.rotation,-Math.PI,Math.PI))return false;
 if(Object.hasOwn(v,'materialOverride')&&(!obj(v.materialOverride)||Object.keys(v.materialOverride).length===0||!isPbrMaterial({...DEFAULT_MATERIAL,...v.materialOverride})))return false;
 if(Object.hasOwn(v,'texturePack')&&(!obj(v.texturePack)||!closed(v.texturePack,['id','version'])||v.texturePack.version!==1||(typeof v.texturePack.id!=='string'||!packs.includes(v.texturePack.id))))return false;
 return (!Object.hasOwn(v,'normalScale')||num(v.normalScale,0,2))&&(!Object.hasOwn(v,'aoStrength')||num(v.aoStrength,0,1))&&(!Object.hasOwn(v,'sound')||sound(v.sound));
}
/** Optional authoring namespace; validates references without inventing floor surfaces or media. */
export function validateStudioFloors(candidate:unknown) {
 const errors:FloorIssue[]=[],base='/candidate/extensions/org.exhibitos.studio~1floors';
 const add=(code:FloorIssue['code'],suffix:string,message:string)=>errors.push({code,path:base+suffix,message});
 if(!obj(candidate)||!obj(candidate.extensions)||!Object.hasOwn(candidate.extensions,FLOOR_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[FLOOR_NAMESPACE];
 if(!obj(value)||!closed(value,['version','bindings'])||value.version!==1||!Array.isArray(value.bindings)){add('FLOOR_SCHEMA','','Expected closed floor version1');return {valid:false,errors};}
 if(value.bindings.length>64){add('FLOOR_LIMIT','/bindings','Maximum64 floor bindings');return {valid:false,errors};}
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>16384)add('FLOOR_LIMIT','','Maximum16KiB floor metadata');}catch{add('FLOOR_SCHEMA','','Only JSON floor metadata is accepted');}
 const list=(key:string)=>Array.isArray(candidate[key])?candidate[key].filter(obj):[];
 const ids=(rows:Record<string,unknown>[])=>new Set(rows.filter(v=>typeof v.id==='string').map(v=>(v.id as string).toLowerCase()));
 const floors=ids(list('surfaces').filter(v=>v.type==='floor')),rooms=ids(list('rooms')),wav=ids(list('mediaAssets').filter(v=>v.mime==='audio/wav'));
 const seen=new Set<string>();
 value.bindings.forEach((v,i)=>{
  const path='/bindings/'+i;
  if(!binding(v)){add('FLOOR_SCHEMA',path,'Expected closed bounded floor binding');return;}
  const key=floorTargetKey(v.target),id=v.target.kind==='surface'?v.target.surfaceId:v.target.roomId;
  if(seen.has(key)||!(v.target.kind==='surface'?floors:rooms).has(id.toLowerCase()))add('FLOOR_REFERENCE',path+'/target','Expected unique existing typed floor or room target');
  seen.add(key);
  if(v.sound?.mode==='explicit'&&v.sound.assetIds.some(id=>!wav.has(id.toLowerCase())))add('FLOOR_REFERENCE',path+'/sound/assetIds','Explicit sound requires existing WAV media UUIDs');
 });
 return {valid:errors.length===0,errors};
}
/** A copy for validated callers. A room-base stays stored but is inactive when any authored floor exists. */
export function floorFor(candidate:{extensions?:unknown;surfaces?:readonly {type:string;roomId:string}[]},hit:{roomId:string;surfaceId?:string}):FloorBinding|undefined {
 const extensions=obj(candidate.extensions)?candidate.extensions:undefined;
 const value=extensions?.[FLOOR_NAMESPACE] as StudioFloors|undefined;
 const found=hit.surfaceId?value?.bindings.find(b=>b.target.kind==='surface'&&b.target.surfaceId.toLowerCase()===hit.surfaceId!.toLowerCase()):undefined;
 if(found)return structuredClone(found);
 if(candidate.surfaces?.some(s=>s.type==='floor'&&s.roomId.toLowerCase()===hit.roomId.toLowerCase()))return undefined;
 const base=value?.bindings.find(b=>b.target.kind==='room-base'&&b.target.roomId.toLowerCase()===hit.roomId.toLowerCase());
 return base?structuredClone(base):undefined;
}
/** Typed remap for imports/public snapshots. Missing IDs fail closed. */
export function remapStudioFloors(value:StudioFloors,ids:ReadonlyMap<string,string>):StudioFloors {
 const normalized=new Map<string,string>();for(const [a,b] of ids){if(!uuid(a)||!uuid(b)||normalized.has(a.toLowerCase()))throw Error('FLOOR_REFERENCE');normalized.set(a.toLowerCase(),b);}
 const remap=(id:string)=>{const result=normalized.get(id.toLowerCase());if(!result)throw Error('FLOOR_REFERENCE');return result;};
 const result:StudioFloors=structuredClone(value);
 for(const b of result.bindings){b.target=b.target.kind==='surface'?{kind:'surface',surfaceId:remap(b.target.surfaceId)}:{kind:'room-base',roomId:remap(b.target.roomId)};if(b.sound?.mode==='explicit'){b.sound.assetIds=b.sound.assetIds.map(remap);if(new Set(b.sound.assetIds.map(id=>id.toLowerCase())).size!==b.sound.assetIds.length)throw Error('FLOOR_REFERENCE');}}
 if(new Set(result.bindings.map(b=>floorTargetKey(b.target))).size!==result.bindings.length)throw Error('FLOOR_REFERENCE');
 return result;
}
/** Authored display defaults, never claims of measured material or provider units. */
export function floorPresetDefaults(preset:FloorPreset):Omit<FloorBinding,'target'> {
 return {preset,repeatMeters:preset==='wood'?[1.8,1.8]:preset==='tile'?[2.1,2.1]:[1,1],rotation:0,materialOverride:{color:'#ffffff',roughness:1,metalness:0},texturePack:{id:({wood:'WoodFloor051',marble:'Marble006',tile:'Tiles074',carpet:'Carpet004'} as const)[preset],version:1},normalScale:1,aoStrength:1,sound:{mode:'material-default',gain:1}};
}
export function floorMaterial(binding:FloorBinding,legacy?:PbrMaterial):PbrMaterial {return {...DEFAULT_MATERIAL,...floorPresetDefaults(binding.preset).materialOverride,...legacy,...binding.materialOverride};}
export function floorSoundFamily(preset:FloorPreset):FloorPreset {return preset;}
