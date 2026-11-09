// SPDX-License-Identifier: AGPL-3.0-or-later
import {artifactPoint,validateArtifactPose,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {WORKSPACE_FURNISHING_NAMESPACE} from './workspace-furnishing.js';
export const EXPERIENCE_NAMESPACE = 'org.exhibitos.viewer/experience';
export interface ExitDestination {name:string;url:string}
export interface ViewerExitDoor {placementId:string;surfaceId:string;primary:ExitDestination;additional:ExitDestination[]}
export interface ViewerExperience {
  version: 1;
  footsteps: {surfaceId:string;material:'wood'|'stone'|'concrete'|'carpet'|'metal';assetId?:string;bank?:{assetId:string}[]}[];
  voices: {placementId:string;assetId:string;transcript:string;locale:string}[];
  annotations: {annotationId:string;position:[number,number,number]}[];
  audioDefaults?: {soundOn:boolean};
  exitDoors?:ViewerExitDoor[];
  rooms: {
    roomId:string;
    reverb:number;
    footstepsOn?:boolean;
    reverbOn?:boolean;
    bgmOn?:boolean;
    bgm?:{assetId:string}|null;
  }[];
  translations: {placementId:string;locale:string;title:string;description:string}[];
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const locale=(v:unknown)=>typeof v==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(v);
/** Parse and canonicalize the destination for comparison and explicit navigation. */
export function exitDestinationUrl(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>2048||!/^https:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value)
    ||/[\s\p{Cc}\\]/u.test(value))return;
  try{
    const url=new URL(value);
    if(url.protocol==='https:'&&url.hostname&&!url.username&&!url.password)return url.href;
  }catch{/* The caller reports invalid authored metadata. */}
}
function anchorsExitToWall(visual:Record<string,unknown>,wall:Record<string,unknown>){
  if(!object(wall.transform)||!object(wall.dimensions)||!Array.isArray(visual.position)||visual.position.length!==3||
    typeof visual.yaw!=='number'||typeof wall.dimensions.width!=='number'||typeof wall.dimensions.height!=='number')return false;
  const pose=wall.transform as unknown as ArtifactPose;
  try{
    validateArtifactPose(pose);
    const [x,y,z,w]=pose.rotation;
    const local=artifactPoint(visual.position.map((n,i)=>n-pose.position[i]!) as AffinePoint,
      {position:[0,0,0],rotation:[-x,-y,-z,w],scale:[1,1,1]});
    const normal=artifactPoint([0,0,1],{position:[0,0,0],rotation:pose.rotation,scale:[1,1,1]});
    const facing=normal[0]*Math.sin(visual.yaw)+normal[2]*Math.cos(visual.yaw);
    return Math.abs(local[2])<=.08&&facing>=.98
      &&Math.abs(local[0])<=wall.dimensions.width*pose.scale[0]/2
      &&Math.abs(local[1])<=wall.dimensions.height*pose.scale[1]/2+.01;
  }catch{return false;}
}
export function validateViewerExperience(candidate:unknown) {
  const errors:{code:string;path:string;message:string}[]=[];
  const fail=(message:string)=>errors.push({code:'VIEWER_EXPERIENCE_INVALID',path:'/extensions/org.exhibitos.viewer~1experience',message});
  if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,EXPERIENCE_NAMESPACE))return {valid:true,errors};
  const value=candidate.extensions[EXPERIENCE_NAMESPACE];
  if(!object(value)||!keys(value,['version','footsteps','voices','annotations','rooms','translations'],['audioDefaults','exitDoors'])||value.version!==1){fail('Expected experience version1 and its five bounded arrays');return {valid:false,errors};}
  const defaults=value.audioDefaults;
  if(defaults!==undefined&&(!object(defaults)||!keys(defaults,['soundOn'])||typeof defaults.soundOn!=='boolean'))
    fail('Expected a boolean sound default');
  const ref=(v:unknown)=>typeof v==='string'?v.toLowerCase():'';
  const ids=(name:string)=>new Set(Array.isArray(candidate[name])?candidate[name].filter(object).map(x=>ref(x.id)):[]);
  const floors=new Set(Array.isArray(candidate.surfaces)?candidate.surfaces.filter(object).filter(x=>x.type==='floor').map(x=>ref(x.id)):[]);
  const media=ids('mediaAssets'),placements=ids('placements'),annotations=ids('annotations'),rooms=ids('rooms');
  const wavMedia=new Set(Array.isArray(candidate.mediaAssets)?candidate.mediaAssets.filter(object).filter(x=>x.mime==='audio/wav').map(x=>ref(x.id)):[]);
  const bank=(x:Record<string,unknown>)=>x.bank===undefined||(x.assetId===undefined&&Array.isArray(x.bank)&&x.bank.length>=2&&x.bank.length<=16&&x.bank.every(s=>object(s)&&keys(s,['assetId'])&&wavMedia.has(ref(s.assetId)))&&new Set(x.bank.map(s=>ref((s as Record<string,unknown>).assetId))).size===x.bank.length);
  const check=(name:string,max:number,valid:(v:Record<string,unknown>)=>boolean,identity:(v:Record<string,unknown>)=>string)=>{
    const list=value[name];if(!Array.isArray(list)||list.length>max){fail(`Invalid bounded ${name} array`);return;}
    const seen=new Set<string>();for(const x of list){if(!object(x)||!valid(x)){fail(`Invalid ${name} entry or reference`);continue;}const id=identity(x);if(seen.has(id))fail(`Duplicate ${name} identity`);seen.add(id);}
  };
  check('footsteps',256,x=>keys(x,['surfaceId','material'],['assetId','bank'])&&floors.has(ref(x.surfaceId))&&['wood','stone','concrete','carpet','metal'].includes(String(x.material))&&(x.assetId===undefined||media.has(ref(x.assetId)))&&bank(x),x=>ref(x.surfaceId));
  check('voices',64,x=>keys(x,['placementId','assetId','transcript','locale'])&&placements.has(ref(x.placementId))&&media.has(ref(x.assetId))&&text(x.transcript,16384)&&locale(x.locale),x=>`${ref(x.placementId)}:${String(x.locale).toLowerCase()}`);
  const anchorBounds=(x:Record<string,unknown>)=>{
    const annotation=Array.isArray(candidate.annotations)?candidate.annotations.filter(object).find(a=>ref(a.id)===ref(x.annotationId)):undefined;
    const placement=Array.isArray(candidate.placements)?candidate.placements.filter(object).find(p=>ref(p.id)===ref(annotation?.placementId)):undefined;
    const artwork=Array.isArray(candidate.artworks)?candidate.artworks.filter(object).find(a=>ref(a.revisionId)===ref(placement?.artworkRevisionId)):undefined;
    const dimensions=artwork&&object(artwork.dimensions)?artwork.dimensions:undefined;
    return !!dimensions&&Array.isArray(x.position)&&x.position.every((n,i)=>typeof n==='number'&&Math.abs(n)<=Number(dimensions[['width','height','depth'][i]!]??0)/2+0.001);
  };
  check('annotations',256,x=>keys(x,['annotationId','position'])&&annotations.has(ref(x.annotationId))&&Array.isArray(x.position)&&x.position.length===3&&x.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000000)&&anchorBounds(x),x=>ref(x.annotationId));
  check('rooms',32,x=>{
    const bgm=x.bgm;
    return keys(x,['roomId','reverb'],['footstepsOn','reverbOn','bgmOn','bgm'])
      &&rooms.has(ref(x.roomId))&&typeof x.reverb==='number'&&Number.isFinite(x.reverb)&&x.reverb>=0&&x.reverb<=1
      &&[x.footstepsOn,x.reverbOn,x.bgmOn].every(v=>v===undefined||typeof v==='boolean')
      &&(bgm===undefined||bgm===null||object(bgm)&&keys(bgm,['assetId'])&&wavMedia.has(ref(bgm.assetId)));
  },x=>ref(x.roomId));
  if(value.exitDoors!==undefined){
    const workspace=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE];
    const visuals=object(workspace)&&Array.isArray(workspace.placements)?workspace.placements.filter(object):[];
    const assets=object(workspace)&&Array.isArray(workspace.furnishings)?workspace.furnishings.filter(object):[];
    const walls=Array.isArray(candidate.surfaces)?candidate.surfaces.filter(object).filter(surface=>surface.type==='wall'):[];
    const destination=(item:unknown)=>object(item)&&keys(item,['name','url'])&&text(item.name,96)
      &&item.name===String(item.name).trim()&&!/[\p{Cc}\u2028\u2029]/u.test(String(item.name))?exitDestinationUrl(item.url):undefined;
    check('exitDoors',32,row=>{
      if(!keys(row,['placementId','surfaceId','primary','additional'])||!Array.isArray(row.additional)||row.additional.length>4)return false;
      const visual=visuals.find(item=>ref(item.id)===ref(row.placementId));
      const wall=walls.find(item=>ref(item.id)===ref(row.surfaceId));
      if(!visual||!wall||!rooms.has(ref(visual.roomId))||ref(visual.roomId)!==ref(wall.roomId)||!anchorsExitToWall(visual,wall)
        ||!assets.some(asset=>asset.kind==='barrier'&&ref(asset.id)===ref(visual.furnishingId)&&asset.version===visual.furnishingVersion))return false;
      const urls=[row.primary,...row.additional].map(destination);
      return urls.every(Boolean)&&new Set(urls).size===urls.length;
    },row=>ref(row.placementId));
  }
  check('translations',256,x=>keys(x,['placementId','locale','title','description'])&&placements.has(ref(x.placementId))&&locale(x.locale)&&text(x.title,512)&&text(x.description,16384),x=>`${ref(x.placementId)}:${String(x.locale).toLowerCase()}`);
  return {valid:errors.length===0,errors};
}
export function experienceFor(candidate:{extensions?:unknown}):ViewerExperience {
  const value=object(candidate.extensions)?candidate.extensions[EXPERIENCE_NAMESPACE]:undefined;
  return structuredClone((value as ViewerExperience|undefined)??{version:1,footsteps:[],voices:[],annotations:[],rooms:[],translations:[]});
}
