// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
export const INSTALLATION_NAMESPACE='org.exhibitos.studio/installation';
export const INSTALLATION_LIMITS=Object.freeze({bindings:128,materials:256,primitives:1664,triangles:34816,cylinderSegments:32});
export interface InstallationMaterial {preset:'paint'|'wood'|'stone'|'metal';color:string;roughness:number;metalness:number}
export type InstallationPedestal={kind:'none'}|{kind:'box';position:[number,number,number];yaw:number;dimensions:{width:number;depth:number;height:number};material:InstallationMaterial}|{kind:'cylinder';position:[number,number,number];yaw:number;dimensions:{diameter:number;height:number};material:InstallationMaterial};
export type InstallationFrame={kind:'none'}|{kind:'flat'|'stepped'|'floating';borderWidth:number;thickness:number;depth:number;gap:number;matWidth:number;matColor:string;material:Omit<InstallationMaterial,'preset'>&{preset:'paint'|'wood'|'metal'}};
export interface InstallationBinding {placementId:string;pedestal?:InstallationPedestal;frame?:InstallationFrame}
export interface StudioInstallation {version:1;placements:InstallationBinding[]}
export interface InstallationIssue {code:'INSTALLATION_SCHEMA'|'INSTALLATION_REFERENCE'|'INSTALLATION_LIMIT';path:string;message:string}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const colour=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function material(v:unknown,frame=false):v is InstallationMaterial {
 return obj(v)&&closed(v,['preset','color','roughness','metalness'])&&(frame?['paint','wood','metal']:['paint','wood','stone','metal']).includes(v.preset as string)&&colour(v.color)&&number(v.roughness,0,1)&&number(v.metalness,0,1);
}
function pedestal(v:unknown):v is InstallationPedestal {
 if(!obj(v))return false;if(v.kind==='none')return closed(v,['kind']);
 if(!['box','cylinder'].includes(v.kind as string)||!closed(v,['kind','position','yaw','dimensions','material'])||!Array.isArray(v.position)||v.position.length!==3||!v.position.every(n=>number(n,-10000,10000))||!number(v.yaw,-Math.PI,Math.PI)||!material(v.material)||!obj(v.dimensions))return false;
 const d=v.dimensions;return number(d.height,.01,5)&&(v.kind==='box'?closed(d,['width','depth','height'])&&number(d.width,.01,10)&&number(d.depth,.01,10):closed(d,['diameter','height'])&&number(d.diameter,.01,10));
}
function frame(v:unknown):v is InstallationFrame {
 if(!obj(v))return false;if(v.kind==='none')return closed(v,['kind']);
 return ['flat','stepped','floating'].includes(v.kind as string)&&closed(v,['kind','borderWidth','thickness','depth','gap','matWidth','matColor','material'])&&number(v.borderWidth,.005,.5)&&number(v.thickness,.002,.2)&&number(v.depth,0,.5)&&number(v.gap,0,.2)&&(v.kind==='floating'||v.gap===0)&&number(v.matWidth,0,.5)&&colour(v.matColor)&&material(v.material,true);
}
/** Reject caps before constructing any renderer/physics geometry or material. */
export function installationBudget(bindings:readonly InstallationBinding[]) {
 const materials=new Set<string>();let primitives=0,triangles=0;
 const add=(m:InstallationMaterial)=>materials.add(JSON.stringify([m.color.toLowerCase(),m.roughness,m.metalness]));
 for(const b of bindings){
  if(b.pedestal&&b.pedestal.kind!=='none'){add(b.pedestal.material);primitives++;triangles+=b.pedestal.kind==='box'?12:128;}
  if(b.frame&&b.frame.kind!=='none'){
   const f=b.frame,layers=f.kind==='stepped'&&f.depth>0?2:1;add(f.material);primitives+=4*layers;triangles+=48*layers;
   if(f.matWidth>0){add({preset:'paint',color:f.matColor,roughness:1,metalness:0});primitives+=4;triangles+=8;}
  }
 }
 const result={bindings:bindings.length,materials:materials.size,primitives,triangles};
 if(result.bindings>128||result.materials>256||result.primitives>1664||result.triangles>34816)throw Error('INSTALLATION_LIMIT');
 return result;
}
/** Admission for the optional namespace; complete base-document validation stays with the caller. */
export function validateStudioInstallation(candidate:unknown){
 const errors:InstallationIssue[]=[],base='/candidate/extensions/org.exhibitos.studio~1installation';
 const issue=(code:InstallationIssue['code'],path:string,message:string)=>errors.push({code,path:base+path,message});
 if(!obj(candidate)||!obj(candidate.extensions)||!Object.hasOwn(candidate.extensions,INSTALLATION_NAMESPACE))return {valid:true,errors};
 const v=candidate.extensions[INSTALLATION_NAMESPACE];
 if(!obj(v)||!closed(v,['version','placements'])||v.version!==1||!Array.isArray(v.placements)){issue('INSTALLATION_SCHEMA','','Expected closed installation version1');return {valid:false,errors};}
 if(v.placements.length>128){issue('INSTALLATION_LIMIT','/placements','Maximum128 installation bindings');return {valid:false,errors};}
 const placed=Array.isArray(candidate.placements)?candidate.placements:[],ids=new Set(placed.filter(obj).map(p=>typeof p.id==='string'?p.id.toLowerCase():'')),seen=new Set<string>(),bindings:InstallationBinding[]=[];
 v.placements.forEach((b,i)=>{
  const path='/placements/'+i;
  if(!obj(b)||!closed(b,['placementId'],['pedestal','frame'])||!uuid(b.placementId)||Object.hasOwn(b,'pedestal')&&!pedestal(b.pedestal)||Object.hasOwn(b,'frame')&&!frame(b.frame)){issue('INSTALLATION_SCHEMA',path,'Invalid closed bounded installation binding');return;}
  const id=b.placementId.toLowerCase();if(seen.has(id)||!ids.has(id))issue('INSTALLATION_REFERENCE',path+'/placementId','Expected unique existing placement UUID');seen.add(id);bindings.push(b as unknown as InstallationBinding);
 });
 if(!errors.length)try{installationBudget(bindings);}catch{issue('INSTALLATION_LIMIT','/placements','Material or geometry allocation cap exceeded');}
 return {valid:errors.length===0,errors};
}
/** Call only after complete candidate validation. Absence is the legacy no-decoration projection. */
export function installationFor(candidate:Pick<Exhibition,'extensions'>,placementId:string):InstallationBinding|undefined {
 const v=candidate.extensions?.[INSTALLATION_NAMESPACE] as StudioInstallation|undefined;
 const b=v?.placements.find(b=>b.placementId.toLowerCase()===placementId.toLowerCase());return b?structuredClone(b):undefined;
}
/** Typed reference remap only. Never rewrites opaque namespaces, assets or artwork transforms. */
export function remapStudioInstallation(value:StudioInstallation,placements:ReadonlyMap<string,string>):StudioInstallation {
 const normalized=new Map<string,string>();for(const [source,destination] of placements){if(!uuid(source)||!uuid(destination)||normalized.has(source.toLowerCase()))throw Error('INSTALLATION_REFERENCE');normalized.set(source.toLowerCase(),destination);}
 const ids=new Set<string>();return {version:1,placements:value.placements.map(b=>{
  const id=normalized.get(b.placementId.toLowerCase());
  if(!uuid(id)||ids.has(id.toLowerCase()))throw Error('INSTALLATION_REFERENCE');ids.add(id.toLowerCase());return {...structuredClone(b),placementId:id};
 })};
}
