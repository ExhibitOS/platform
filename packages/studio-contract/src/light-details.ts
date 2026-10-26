// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {TEMPLATE_NAMESPACE} from './architecture.js';
import {artifactBounds,artifactCorners} from './artifact-affine.js';
import type {AffinePoint,ArtifactPose} from './artifact-affine.js';

export const LIGHT_DETAILS_NAMESPACE='org.exhibitos.studio/light-details';
export const LIGHT_DETAILS_LIMITS=Object.freeze({bindings:32,bytes:16384,fixtureTriangles:1920,fixtureMeshes:64});
export type ExhibitionLight=Exhibition['lights'][number];
export type LightAim={kind:'rotation'}|{kind:'placement-center'}|{kind:'point';position:AffinePoint};
export interface LightDetails {
  lightId:string;
  fixture:'none'|'spot-can'|'disc'|'panel';
  aim?:LightAim;
  /** Spot beam edge only, independent of bounded shadow filtering. */
  penumbra?:number;
  /** Existing Three point/spot distance cutoff in metres. */
  range?:number;
  /** Explicit edit intent. Never used to repaint stored RGB during loading. */
  temperatureKelvin?:number;
}
export interface StudioLightDetails {version:1;lights:LightDetails[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vector=(v:unknown):v is AffinePoint=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,-10000,10000));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Existing bounded visual approximation; neither spectrum nor calibrated white. */
export function lightKelvinHex(kelvin:number):string {
  if(!finite(kelvin,1000,20000))throw Error('LIGHT_TEMPERATURE_INVALID');
  const t=kelvin/100,clamp=(n:number)=>Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0');
  return '#'+[t<=66?255:329.698727446*Math.pow(t-60,-.1332047592),t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492),t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307].map(clamp).join('');
}
/** Base Light.color is linear RGB. Applying K is an explicit command, never a load effect. */
export function lightKelvinLinear(kelvin:number):AffinePoint {
  const hex=lightKelvinHex(kelvin);
  return [1,3,5].map(i=>{const c=parseInt(hex.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}) as AffinePoint;
}
/** Pure local target; caller has admitted the full candidate and namespace. */
export function lightDetailsTarget(document:Exhibition,light:ExhibitionLight,details:LightDetails):AffinePoint|undefined {
  if(details.aim?.kind==='rotation')return undefined;
  if(details.aim?.kind==='point')return [...details.aim.position];
  if(details.aim?.kind!=='placement-center'&&light.type!=='spot'&&light.type!=='directional')return undefined;
  const placement=document.placements.find(p=>light.targetPlacementId&&same(p.id,light.targetPlacementId));
  if(!placement)return undefined;
  if(!details.aim)return [...placement.transform.position]; // Preserve the legacy placement-origin target.
  const artwork=document.artworks.find(a=>same(a.revisionId,placement.artworkRevisionId));
  if(!artwork)throw Error('LIGHT_DETAILS_REFERENCE');
  return artifactBounds(artifactCorners(artwork.dimensions,[artwork.transform,placement.transform])).center;
}
export function lightDetailsOrientation(document:Exhibition,light:ExhibitionLight,details:LightDetails):ArtifactPose['rotation'] {
  const target=lightDetailsTarget(document,light,details);if(!target)return [...light.transform.rotation];
  const direction=target.map((n,i)=>n-light.transform.position[i]!) as AffinePoint,length=Math.hypot(...direction);
  if(!Number.isFinite(length)||length<.001)throw Error('LIGHT_DETAILS_DIRECTION');
  const [x,y,z]=direction.map(n=>n/length),w=1-z!;
  if(w<1e-10)return [0,1,0,0];
  const norm=Math.hypot(y!,-x!,w);return [y!/norm,-x!/norm,0,w/norm];
}
export function lightFixtureDimensions(light:ExhibitionLight,details:LightDetails){
  if(details.fixture==='none')return undefined;
  return details.fixture==='panel'?{width:light.dimensions!.width,height:light.dimensions!.height,depth:.034}:details.fixture==='disc'?{width:.18,height:.18,depth:.044}:{width:.12,height:.12,depth:.204};
}
export function validateStudioLightDetails(candidate:unknown){
  const errors:{code:string;path:string;message:string}[]=[],base='/candidate/extensions/org.exhibitos.studio~1light-details';
  const add=(code:string,path:string,message:string)=>errors.push({code,path:base+path,message});
  if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,LIGHT_DETAILS_NAMESPACE))return {valid:true,errors};
  const value=candidate.extensions[LIGHT_DETAILS_NAMESPACE];
  if(!object(value)||!closed(value,['version','lights'])||value.version!==1||!Array.isArray(value.lights)){add('LIGHT_DETAILS_SCHEMA','','Expected closed light details version1');return {valid:false,errors};}
  if(value.lights.length>32){add('LIGHT_DETAILS_LIMIT','/lights','Maximum32 details bindings');return {valid:false,errors};}
  try{if(new TextEncoder().encode(JSON.stringify(value)).length>16384){add('LIGHT_DETAILS_LIMIT','','Maximum16KiB light details');return {valid:false,errors};}}catch{add('LIGHT_DETAILS_SCHEMA','','Expected finite JSON');return {valid:false,errors};}
  const lights=Array.isArray(candidate.lights)?candidate.lights.filter(object):[],rooms=Array.isArray(candidate.rooms)?candidate.rooms.filter(object):[],seen=new Set<string>();
  value.lights.forEach((entry,i)=>{
    const path='/lights/'+i;
    if(!object(entry)||!closed(entry,['lightId','fixture'],['aim','penumbra','range','temperatureKelvin'])||!uuid(entry.lightId)||typeof entry.fixture!=='string'||!['none','spot-can','disc','panel'].includes(entry.fixture)){add('LIGHT_DETAILS_SCHEMA',path,'Expected bounded closed typed light binding');return;}
    const light=lights.find(l=>typeof l.id==='string'&&same(l.id,entry.lightId as string)),room=light&&rooms.find(r=>typeof r.id==='string'&&typeof light.roomId==='string'&&same(r.id,light.roomId));
    if(seen.has(entry.lightId.toLowerCase())||!light||!room||!object(room.dimensions)){add('LIGHT_DETAILS_REFERENCE',path,'Expected unique existing light and room');return;}seen.add(entry.lightId.toLowerCase());
    if(entry.fixture==='spot-can'&&light.type!=='spot'||entry.fixture==='disc'&&light.type!=='point'||entry.fixture==='panel'&&(light.type!=='area'||!object(light.dimensions)||!finite(light.dimensions.width,.1,4)||!finite(light.dimensions.height,.1,4)))add('LIGHT_DETAILS_COMPATIBILITY',path+'/fixture','Fixture must match the supported light type/size');
    if(entry.fixture!=='none'&&entry.aim===undefined&&typeof light.targetPlacementId==='string'){const placements=Array.isArray(candidate.placements)?candidate.placements.filter(object):[],target=placements.find(p=>typeof p.id==='string'&&same(p.id,light.targetPlacementId as string));if(!target||typeof target.roomId!=='string'||typeof light.roomId!=='string'||!same(target.roomId,light.roomId))add('LIGHT_DETAILS_REFERENCE',path,'A fixture with a legacy placement target requires the same room');}
    if(Object.hasOwn(entry,'penumbra')&&(light.type!=='spot'||!finite(entry.penumbra,0,1)))add('LIGHT_DETAILS_COMPATIBILITY',path+'/penumbra','Spot beam edge must be0..1');
    if(Object.hasOwn(entry,'range')&&((light.type!=='spot'&&light.type!=='point')||!finite(entry.range,.1,50)))add('LIGHT_DETAILS_COMPATIBILITY',path+'/range','Point/spot cutoff must be.1..50m');
    if(Object.hasOwn(entry,'temperatureKelvin')){
      if(!finite(entry.temperatureKelvin,1000,20000))add('LIGHT_DETAILS_COLOR',path+'/temperatureKelvin','Expected1000..20000K visual approximation');
      else {const expected=lightKelvinLinear(entry.temperatureKelvin);if(!Array.isArray(light.color)||light.color.length!==3||light.color.some((n,j)=>!finite(n,0,1)||Math.abs(n-expected[j]!)>1e-6))add('LIGHT_DETAILS_COLOR',path+'/temperatureKelvin','Stored linear RGB must match explicit K intent; direct edits must clear K atomically');}
    }
    const aim=entry.aim;
    if(Object.hasOwn(entry,'aim')){
      if(!object(aim)||!((aim.kind==='rotation'||aim.kind==='placement-center')&&closed(aim,['kind'])||aim.kind==='point'&&closed(aim,['kind','position'])&&vector(aim.position)))add('LIGHT_DETAILS_SCHEMA',path+'/aim','Expected rotation, placement-center or local point aim');
      else if(aim.kind==='rotation'||aim.kind==='point'){
        if(light.targetPlacementId!==undefined)add('LIGHT_DETAILS_REFERENCE',path+'/aim','Explicit rotation/point must clear the legacy placement target');
        if(aim.kind==='point'&&vector(aim.position)){const p=aim.position,d=room.dimensions;if(light.type==='point'||Math.abs(p[0])>Number(d.width)/2||p[1]<0||p[1]>Number(d.height)||Math.abs(p[2])>Number(d.depth)/2)add('LIGHT_DETAILS_DIRECTION',path+'/aim','Directional target must be inside the light room');}
      }else {
        const placements=Array.isArray(candidate.placements)?candidate.placements.filter(object):[],p=placements.find(p=>typeof p.id==='string'&&typeof light.targetPlacementId==='string'&&same(p.id,light.targetPlacementId));
        if(light.type==='point'||!p||typeof p.roomId!=='string'||typeof light.roomId!=='string'||!same(p.roomId,light.roomId))add('LIGHT_DETAILS_REFERENCE',path+'/aim','Placement-center requires the existing same-room placement target');
      }
    }
    if(errors.some(e=>e.path.startsWith(base+path)))return;
    try{
      const l=light as unknown as ExhibitionLight,b=entry as unknown as LightDetails,rotation=(b.fixture!=='none'||b.aim!==undefined)?lightDetailsOrientation(candidate as unknown as Exhibition,l,b):l.transform.rotation,dimensions=lightFixtureDimensions(l,b);
      if(dimensions){const pose={...l.transform,rotation},corners=artifactCorners(dimensions,[pose],true),d=room.dimensions;if(corners.some(p=>Math.abs(p[0])>Number(d.width)/2||p[1]<0||p[1]>Number(d.height)||Math.abs(p[2])>Number(d.depth)/2))throw Error('outside-room');artifactCorners(dimensions,[pose,room.transform as unknown as ArtifactPose],true);}
    }catch{add('LIGHT_DETAILS_GEOMETRY',path,'Aim and generated fixture must satisfy finite room/world/Float32 bounds');}
  });
  return {valid:errors.length===0,errors};
}
/** Call after full admission. Legacy absence is never rewritten. */
export function lightDetailsFor(candidate:Pick<Exhibition,'extensions'>):LightDetails[]{return structuredClone((candidate.extensions?.[LIGHT_DETAILS_NAMESPACE] as unknown as StudioLightDetails|undefined)?.lights??[]);}
export function remapStudioLightDetails(value:StudioLightDetails,ids:ReadonlyMap<string,string>):StudioLightDetails {
  return {version:1,lights:value.lights.map(b=>{const lightId=ids.get(b.lightId.toLowerCase());if(!uuid(lightId))throw Error('LIGHT_DETAILS_REFERENCE');return {...structuredClone(b),lightId};})};
}
export function removeLightDetails(candidate:Exhibition,lightId:string):Exhibition {
  const next=structuredClone(candidate);if(next.extensions?.[LIGHT_DETAILS_NAMESPACE]!==undefined)next.extensions[LIGHT_DETAILS_NAMESPACE]={version:1,lights:lightDetailsFor(next).filter(b=>!same(b.lightId,lightId))} as unknown as NonNullable<Exhibition['extensions']>[string];return next;
}
export function setLightDetails(candidate:Exhibition,lightId:string,light:Omit<ExhibitionLight,'id'>,settings:Omit<LightDetails,'lightId'>):Exhibition {
  const next=structuredClone(candidate),index=next.lights.findIndex(l=>same(l.id,lightId));if(index<0)throw Error('LIGHT_DETAILS_REFERENCE');
  const original=next.lights[index]!;
  const units={point:'candela',spot:'candela',directional:'lux',area:'lumen'} as const;
  if(Object.hasOwn(light,'id')||Object.hasOwn(settings,'lightId')||light.roomId!==original.roomId||light.castsShadow!==original.castsShadow||JSON.stringify(light.transform.scale)!==JSON.stringify(original.transform.scale)||light.unit!==(light.type===original.type?original.unit:units[light.type]))throw Error('LIGHT_DETAILS_FIELDS_CHANGED');
  next.lights[index]={...structuredClone(light),id:original.id};
  const bindings=lightDetailsFor(next),entry={...structuredClone(settings),lightId:original.id},at=bindings.findIndex(b=>same(b.lightId,lightId));if(at<0)bindings.push(entry);else bindings[at]=entry;
  next.extensions={...next.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:bindings} as unknown as NonNullable<Exhibition['extensions']>[string]};
  if(next.extensions?.[TEMPLATE_NAMESPACE]){const template=next.extensions[TEMPLATE_NAMESPACE] as unknown as {modified:boolean};template.modified=true;}
  if(!validateStudioLightDetails(next).valid)throw Error('LIGHT_DETAILS_INVALID');return next;
}
