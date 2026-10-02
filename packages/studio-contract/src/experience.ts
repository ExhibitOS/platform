// SPDX-License-Identifier: AGPL-3.0-or-later
export const EXPERIENCE_NAMESPACE = 'org.exhibitos.viewer/experience';
export interface ViewerExperience {
  version: 1;
  footsteps: {surfaceId:string;material:'wood'|'stone'|'concrete'|'carpet'|'metal';assetId?:string}[];
  voices: {placementId:string;assetId:string;transcript:string;locale:string}[];
  annotations: {annotationId:string;position:[number,number,number]}[];
  rooms: {roomId:string;reverb:number}[];
  translations: {placementId:string;locale:string;title:string;description:string}[];
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const locale=(v:unknown)=>typeof v==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(v);
export function validateViewerExperience(candidate:unknown) {
  const errors:{code:string;path:string;message:string}[]=[];
  const fail=(message:string)=>errors.push({code:'VIEWER_EXPERIENCE_INVALID',path:'/extensions/org.exhibitos.viewer~1experience',message});
  if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,EXPERIENCE_NAMESPACE))return {valid:true,errors};
  const value=candidate.extensions[EXPERIENCE_NAMESPACE];
  if(!object(value)||!keys(value,['version','footsteps','voices','annotations','rooms','translations'])||value.version!==1){fail('Expected experience version1 and its five bounded arrays');return {valid:false,errors};}
  const ref=(v:unknown)=>typeof v==='string'?v.toLowerCase():'';
  const ids=(name:string)=>new Set(Array.isArray(candidate[name])?candidate[name].filter(object).map(x=>ref(x.id)):[]);
  const floors=new Set(Array.isArray(candidate.surfaces)?candidate.surfaces.filter(object).filter(x=>x.type==='floor').map(x=>ref(x.id)):[]);
  const media=ids('mediaAssets'),placements=ids('placements'),annotations=ids('annotations'),rooms=ids('rooms');
  const check=(name:string,max:number,valid:(v:Record<string,unknown>)=>boolean,identity:(v:Record<string,unknown>)=>string)=>{
    const list=value[name];if(!Array.isArray(list)||list.length>max){fail(`Invalid bounded ${name} array`);return;}
    const seen=new Set<string>();for(const x of list){if(!object(x)||!valid(x)){fail(`Invalid ${name} entry or reference`);continue;}const id=identity(x);if(seen.has(id))fail(`Duplicate ${name} identity`);seen.add(id);}
  };
  check('footsteps',256,x=>keys(x,['surfaceId','material'],['assetId'])&&floors.has(ref(x.surfaceId))&&['wood','stone','concrete','carpet','metal'].includes(String(x.material))&&(x.assetId===undefined||media.has(ref(x.assetId))),x=>ref(x.surfaceId));
  check('voices',64,x=>keys(x,['placementId','assetId','transcript','locale'])&&placements.has(ref(x.placementId))&&media.has(ref(x.assetId))&&text(x.transcript,16384)&&locale(x.locale),x=>`${ref(x.placementId)}:${String(x.locale).toLowerCase()}`);
  const anchorBounds=(x:Record<string,unknown>)=>{
    const annotation=Array.isArray(candidate.annotations)?candidate.annotations.filter(object).find(a=>ref(a.id)===ref(x.annotationId)):undefined;
    const placement=Array.isArray(candidate.placements)?candidate.placements.filter(object).find(p=>ref(p.id)===ref(annotation?.placementId)):undefined;
    const artwork=Array.isArray(candidate.artworks)?candidate.artworks.filter(object).find(a=>ref(a.revisionId)===ref(placement?.artworkRevisionId)):undefined;
    const dimensions=artwork&&object(artwork.dimensions)?artwork.dimensions:undefined;
    return !!dimensions&&Array.isArray(x.position)&&x.position.every((n,i)=>typeof n==='number'&&Math.abs(n)<=Number(dimensions[['width','height','depth'][i]!]??0)/2+0.001);
  };
  check('annotations',256,x=>keys(x,['annotationId','position'])&&annotations.has(ref(x.annotationId))&&Array.isArray(x.position)&&x.position.length===3&&x.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000000)&&anchorBounds(x),x=>ref(x.annotationId));
  check('rooms',32,x=>keys(x,['roomId','reverb'])&&rooms.has(ref(x.roomId))&&typeof x.reverb==='number'&&Number.isFinite(x.reverb)&&x.reverb>=0&&x.reverb<=1,x=>ref(x.roomId));
  check('translations',256,x=>keys(x,['placementId','locale','title','description'])&&placements.has(ref(x.placementId))&&locale(x.locale)&&text(x.title,512)&&text(x.description,16384),x=>`${ref(x.placementId)}:${String(x.locale).toLowerCase()}`);
  return {valid:errors.length===0,errors};
}
export function experienceFor(candidate:{extensions?:unknown}):ViewerExperience {
  const value=object(candidate.extensions)?candidate.extensions[EXPERIENCE_NAMESPACE]:undefined;
  return structuredClone((value as ViewerExperience|undefined)??{version:1,footsteps:[],voices:[],annotations:[],rooms:[],translations:[]});
}
