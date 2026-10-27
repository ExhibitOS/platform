// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {USER_ASSET_CATALOGUE,type UserAssetCatalogueEntry} from './user-asset-catalogue.js';
import {artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {BENCH_NAMESPACE,benchesFor,type StudioBenches} from './benches.js';
import {INSTALLATION_NAMESPACE,installationFor,type StudioInstallation} from './installation.js';
import {lightDetailsFor,lightDetailsOrientation} from './light-details.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';

export const FURNISHING_NAMESPACE='org.exhibitos.studio/furnishing-visuals';
export const FURNISHING_LIMITS=Object.freeze({assets:8,bindings:32,bytes:32768});
/** Catalogue qualification and functional admission are separate. Expand this
 * list only with the corresponding host, inventory and consumer checks. */
export const SUPPORTED_FURNISHINGS=Object.freeze({
 'backless-oak-bench':'bench',
 'museum-track-spot':'light',
 'gallery-open-portal':'opening',
 'rectangular-plinth':'pedestal',
} as const);
export type FurnishingCatalogId=keyof typeof SUPPORTED_FURNISHINGS;
export type FurnishingHostKind=typeof SUPPORTED_FURNISHINGS[FurnishingCatalogId];
export interface FurnishingPose {position:AffinePoint;yaw:number;scale:number}
export interface FurnishingAsset {
 id:string;catalogId:FurnishingCatalogId;catalogVersion:1;mime:'model/gltf-binary';path:string;bytes:number;sha256:string;
 rights:{licenseId:'CC0-1.0';notice:{path:string;bytes:number;sha256:string}};
 provenance:UserAssetCatalogueEntry['provenance'];
}
export interface FurnishingBinding {hostKind:FurnishingHostKind;hostId:string;assetId:string;pose:FurnishingPose}
export interface StudioFurnishings {version:1;assets:FurnishingAsset[];bindings:FurnishingBinding[]}
export type FurnishingCommand={type:'set-furnishing-visual';hostKind:FurnishingHostKind;hostId:string;catalogId:FurnishingCatalogId;catalogVersion:1;pose:FurnishingPose}|{type:'remove-furnishing-visual';hostKind:FurnishingHostKind;hostId:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[0-9a-f]{12}$/i.test(v);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b));
const identity=():ArtifactPose=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function furnishingCatalogueEntry(id:unknown):UserAssetCatalogueEntry {
 if(typeof id!=='string'||!Object.hasOwn(SUPPORTED_FURNISHINGS,id))throw Error('FURNISHING_UNSUPPORTED');
 const entry=USER_ASSET_CATALOGUE.find(e=>e.id===id);if(!entry)throw Error('FURNISHING_UNSUPPORTED');return entry;
}
export function furnishingAsset(id:string,catalogId:FurnishingCatalogId):FurnishingAsset {
 if(!uuid(id))throw Error('FURNISHING_REFERENCE');const e=furnishingCatalogueEntry(catalogId);
 return {id,catalogId,catalogVersion:1,mime:e.mime,path:`furnishings/${id}/model.glb`,bytes:e.bytes,sha256:e.sha256,
  rights:{licenseId:'CC0-1.0',notice:{path:`furnishings/${id}/LICENSE-NOTICE.txt`,bytes:e.rights.noticeBytes,sha256:e.rights.noticeSha256}},provenance:structuredClone(e.provenance)};
}
export function furnishingsFor(e:Pick<Exhibition,'extensions'>):StudioFurnishings|undefined {return e.extensions?.[FURNISHING_NAMESPACE]===undefined?undefined:structuredClone(e.extensions[FURNISHING_NAMESPACE]) as unknown as StudioFurnishings;}
export function furnishingFor(e:Pick<Exhibition,'extensions'>,kind:FurnishingHostKind,id:string){return furnishingsFor(e)?.bindings.find(b=>b.hostKind===kind&&same(b.hostId,id));}
export function furnishingPoseTransform(p:FurnishingPose):ArtifactPose{return {position:[...p.position],rotation:[0,Math.sin(p.yaw/2),0,Math.cos(p.yaw/2)],scale:[p.scale,p.scale,p.scale]};}
export function furnishingPoint(p:AffinePoint,pose:FurnishingPose){return artifactPoint(p,furnishingPoseTransform(pose));}
function validPose(p:unknown):p is FurnishingPose {
 return closed(p,['position','yaw','scale'])&&object(p)&&Array.isArray(p.position)&&p.position.length===3&&p.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)&&typeof p.yaw==='number'&&Number.isFinite(p.yaw)&&Math.abs(p.yaw)<=Math.PI&&typeof p.scale==='number'&&Number.isFinite(p.scale)&&p.scale>=.1&&p.scale<=4;
}
function dimensions(e:UserAssetCatalogueEntry,scale:number){return {width:(e.bounds.max[0]-e.bounds.min[0])*scale,height:e.bounds.max[1]*scale,depth:(e.bounds.max[2]-e.bounds.min[2])*scale};}
function pedestal(e:UserAssetCatalogueEntry,p:FurnishingPose){return {kind:'box' as const,position:furnishingPoint([(e.bounds.min[0]+e.bounds.max[0])/2,0,(e.bounds.min[2]+e.bounds.max[2])/2],p),yaw:p.yaw,dimensions:dimensions(e,p.scale),material:{preset:'paint' as const,color:'#deded7',roughness:.65,metalness:0}};}
/** Host poses preserve the existing room/surface/light coordinate systems. The
 * light origin is its luminous aperture, independently of the opaque lens. */
export function resolveFurnishing(e:Exhibition,b:FurnishingBinding,asset:FurnishingAsset){
 const source=furnishingCatalogueEntry(asset.catalogId),pose=furnishingPoseTransform(b.pose);let roomId:string,parent=identity();
 if(b.hostKind==='bench'){
  const bench=benchesFor(e).find(v=>same(v.id,b.hostId));if(!bench)throw Error('FURNISHING_REFERENCE');roomId=bench.roomId;
  const f=source.functional;if(f?.kind!=='bench'||bench.kind!=='slab'||!near(bench.yaw,b.pose.yaw)||!bench.position.every((n,i)=>near(n,b.pose.position[i]!))||!near(bench.dimensions.height,f.seatEnvelopeY*b.pose.scale)||!near(bench.dimensions.width,(source.bounds.max[0]-source.bounds.min[0])*b.pose.scale)||!near(bench.dimensions.depth,(source.bounds.max[2]-source.bounds.min[2])*b.pose.scale))throw Error('FURNISHING_FUNCTION');
 }else if(b.hostKind==='pedestal'){
  const placement=e.placements.find(v=>same(v.id,b.hostId)),legacy=installationFor(e,b.hostId)?.pedestal,expected=pedestal(source,b.pose);
  if(!placement||!legacy||legacy.kind!=='box'||!near(legacy.yaw,expected.yaw)||!legacy.position.every((n,i)=>near(n,expected.position[i]!))||!Object.keys(expected.dimensions).every(k=>near(legacy.dimensions[k as keyof typeof expected.dimensions],expected.dimensions[k as keyof typeof expected.dimensions])))throw Error('FURNISHING_FUNCTION');roomId=placement.roomId;
 }else if(b.hostKind==='light'){
  const light=e.lights.find(v=>same(v.id,b.hostId)),f=source.functional;
  if(!light||light.type!=='spot'||f?.kind!=='light'||!near(b.pose.yaw,0)||!b.pose.position.every((n,i)=>near(n,-f.apertureCentre[i]!*b.pose.scale)))throw Error('FURNISHING_FUNCTION');
  const details=lightDetailsFor(e).find(v=>same(v.lightId,light.id));parent={...light.transform,rotation:details?lightDetailsOrientation(e,light,details):light.transform.rotation};roomId=light.roomId;
 }else{
  const opening=e.openings.find(v=>same(v.id,b.hostId)),surface=opening&&e.surfaces.find(v=>same(v.id,opening.surfaceId)),f=source.functional;
  if(!opening||opening.type!=='door'||!surface||surface.type!=='wall'||f?.kind!=='portal'||!near(b.pose.yaw,0)||!near(opening.dimensions.width,f.clearOpening.width*b.pose.scale)||!near(opening.dimensions.height,f.clearOpening.height*b.pose.scale)||!near(b.pose.position[0],opening.offset[0])||!near(b.pose.position[1],opening.offset[1]-opening.dimensions.height/2)||!near(b.pose.position[2],0))throw Error('FURNISHING_FUNCTION');
  parent=surface.transform;roomId=surface.roomId;
  for(let i=0;i<8;i++){const p=furnishingPoint([source.bounds[i&1?'max':'min'][0],source.bounds[i&2?'max':'min'][1],source.bounds[i&4?'max':'min'][2]],b.pose);if(Math.abs(p[0])>surface.dimensions.width/2+1e-6||Math.abs(p[1])>surface.dimensions.height/2+1e-6)throw Error('FURNISHING_BOUNDS');}
 }
 const room=e.rooms.find(v=>same(v.id,roomId));if(!room)throw Error('FURNISHING_REFERENCE');
 for(let i=0;i<8;i++){
  const local:AffinePoint=[source.bounds[i&1?'max':'min'][0],source.bounds[i&2?'max':'min'][1],source.bounds[i&4?'max':'min'][2]],point=artifactPoint(local,pose,parent);
  artifactPoint(local,pose,parent,room.transform);
  // A portal straddles its wall plane; its complete face is checked above.
  if(b.hostKind!=='opening'&&(point[1]<-1e-6||point[1]>room.dimensions.height+1e-6||Math.abs(point[0])>room.dimensions.width/2+1e-6||Math.abs(point[2])>room.dimensions.depth/2+1e-6))throw Error('FURNISHING_BOUNDS');
 }
 return {source,roomId,parent,pose};
}
export function validateFurnishings(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[],fail=(code:string)=>errors.push({code,path:'/candidate/extensions/org.exhibitos.studio~1furnishing-visuals',message:'Expected selected immutable furnishing bytes and a compatible existing functional host'});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,FURNISHING_NAMESPACE))return {valid:true,errors};
 try{
  const value=candidate.extensions[FURNISHING_NAMESPACE];
  if(!closed(value,['version','assets','bindings'])||!object(value)||value.version!==1||!Array.isArray(value.assets)||value.assets.length<1||value.assets.length>8||!Array.isArray(value.bindings)||value.bindings.length<1||value.bindings.length>32||new TextEncoder().encode(JSON.stringify(value)).length>32768)throw Error('FURNISHING_SCHEMA');
  const assets=value.assets as FurnishingAsset[],bindings=value.bindings as FurnishingBinding[],used=new Set<string>(),hosts=new Set<string>(),ids=new Set<string>(),recipes=new Set<string>();
  const existing=new Set(['rooms','surfaces','openings','placements','lights','mediaAssets','artworks'].flatMap(k=>(Array.isArray(candidate[k])?candidate[k] as Record<string,unknown>[]:[]).flatMap(v=>[v.id,v.revisionId,...(Array.isArray(v.assets)?v.assets.map(a=>object(a)?a.id:undefined):[])])).filter((v):v is string=>typeof v==='string').map(v=>v.toLowerCase()));
  const e=candidate as unknown as Exhibition;for(const b of benchesFor(e))existing.add(b.id.toLowerCase());const still=candidate.extensions['org.exhibitos.viewer/space-still'];if(object(still)&&object(still.asset)&&typeof still.asset.id==='string')existing.add(still.asset.id.toLowerCase());
  for(const a of assets){if(!object(a)||!uuid(a.id)||!equal(a,furnishingAsset(a.id,a.catalogId)))throw Error('FURNISHING_ASSET');const id=a.id.toLowerCase(),recipe=a.catalogId+':'+a.catalogVersion;if(ids.has(id)||existing.has(id)||recipes.has(recipe))throw Error('FURNISHING_REFERENCE');ids.add(id);recipes.add(recipe);}
  for(const b of bindings){
   if(!closed(b,['hostKind','hostId','assetId','pose'])||!uuid(b.hostId)||!uuid(b.assetId)||!validPose(b.pose))throw Error('FURNISHING_SCHEMA');const asset=assets.find(a=>same(a.id,b.assetId));if(!asset||SUPPORTED_FURNISHINGS[asset.catalogId]!==b.hostKind)throw Error('FURNISHING_REFERENCE');
   const host=b.hostKind+':'+b.hostId.toLowerCase();if(hosts.has(host))throw Error('FURNISHING_REFERENCE');hosts.add(host);used.add(asset.id.toLowerCase());resolveFurnishing(e,b,asset);
  }
  if(used.size!==assets.length)throw Error('FURNISHING_UNUSED');
 }catch(error){fail(error instanceof Error?error.message:'FURNISHING_INVALID');}
 return {valid:errors.length===0,errors};
}
/** One atomic domain command; caller owns base-document admission and history. */
export function applyFurnishingCommand(candidate:Exhibition,input:FurnishingCommand):Exhibition {
 if(!validateFurnishings(candidate).valid||!object(input)||!uuid(input.hostId))throw Error('FURNISHING_INVALID');
 const next=structuredClone(candidate),value=furnishingsFor(next)??{version:1 as const,assets:[],bindings:[]};
 if(input.type==='remove-furnishing-visual'){
  if(!closed(input,['type','hostKind','hostId'])||!Object.values(SUPPORTED_FURNISHINGS).includes(input.hostKind))throw Error('FURNISHING_INVALID');value.bindings=value.bindings.filter(b=>b.hostKind!==input.hostKind||!same(b.hostId,input.hostId));
 }else{
  if(input.type!=='set-furnishing-visual'||!closed(input,['type','hostKind','hostId','catalogId','catalogVersion','pose'])||input.catalogVersion!==1||!validPose(input.pose)||SUPPORTED_FURNISHINGS[input.catalogId]!==input.hostKind)throw Error('FURNISHING_INVALID');
  const source=furnishingCatalogueEntry(input.catalogId),pose=input.pose;let asset=value.assets.find(a=>a.catalogId===input.catalogId);if(!asset){asset=furnishingAsset(crypto.randomUUID(),input.catalogId);value.assets.push(asset);}
  if(input.hostKind==='pedestal'){
   if(!next.placements.some(p=>same(p.id,input.hostId)))throw Error('FURNISHING_REFERENCE');const installation=(next.extensions?.[INSTALLATION_NAMESPACE] as unknown as StudioInstallation|undefined)??{version:1,placements:[]},existing=installation.placements.find(p=>same(p.placementId,input.hostId)),binding=existing??{placementId:input.hostId};binding.pedestal=pedestal(source,pose);if(!existing)installation.placements.push(binding);next.extensions={...next.extensions,[INSTALLATION_NAMESPACE]:installation as unknown as NonNullable<Exhibition['extensions']>[string]};
  }else if(input.hostKind==='bench'){
   const benches=next.extensions?.[BENCH_NAMESPACE] as unknown as StudioBenches|undefined,bench=benches?.benches.find(b=>same(b.id,input.hostId)),f=source.functional;if(!bench||f?.kind!=='bench')throw Error('FURNISHING_REFERENCE');bench.position=[...pose.position];bench.yaw=pose.yaw;bench.kind='slab';bench.dimensions={...dimensions(source,pose.scale),height:f.seatEnvelopeY*pose.scale};
  }else if(input.hostKind==='opening'){
   const opening=next.openings.find(v=>same(v.id,input.hostId)),f=source.functional;if(!opening||f?.kind!=='portal')throw Error('FURNISHING_REFERENCE');opening.dimensions={width:f.clearOpening.width*pose.scale,height:f.clearOpening.height*pose.scale};
  }
  const binding:FurnishingBinding={hostKind:input.hostKind,hostId:input.hostId,assetId:asset.id,pose:structuredClone(pose)},index=value.bindings.findIndex(b=>b.hostKind===input.hostKind&&same(b.hostId,input.hostId));if(index<0)value.bindings.push(binding);else value.bindings[index]=binding;
 }
 value.assets=value.assets.filter(a=>value.bindings.some(b=>same(b.assetId,a.id)));
 if(value.bindings.length)next.extensions={...next.extensions,[FURNISHING_NAMESPACE]:value as unknown as NonNullable<Exhibition['extensions']>[string]};else if(next.extensions)delete next.extensions[FURNISHING_NAMESPACE];
 if(!validateFurnishings(next).valid)throw Error('FURNISHING_INVALID');const template=next.extensions?.[TEMPLATE_NAMESPACE];if(object(template))template.modified=true;return next;
}
export function remapFurnishings(value:StudioFurnishings,ids:ReadonlyMap<string,string>):StudioFurnishings {
 const id=(old:string)=>{const next=ids.get(old.toLowerCase());if(!uuid(next))throw Error('FURNISHING_REFERENCE');return next;};
 return {version:1,assets:value.assets.map(a=>({...structuredClone(a),id:id(a.id),path:`furnishings/${id(a.id)}/model.glb`,rights:{licenseId:'CC0-1.0',notice:{...a.rights.notice,path:`furnishings/${id(a.id)}/LICENSE-NOTICE.txt`}}})),bindings:value.bindings.map(b=>({...structuredClone(b),hostId:id(b.hostId),assetId:id(b.assetId)}))};
}
