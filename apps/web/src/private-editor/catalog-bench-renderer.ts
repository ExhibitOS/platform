// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {PublicAsset} from '../publication-client';
import type {Session} from '../cms-client';
import {furnishingsFor,resolveFurnishing,trackSpotStaticRailContext,validateFurnishings} from '@exhibitos/studio-contract';
import {loadCatalogModel} from './catalog-furnishing-loader';
import {applyWallwasherModelPose} from './wallwasher-model-pose';
import {installWallwasherEmission} from './wallwasher-emission';
import {catalogBenchReserve} from './catalog-bench';
import {mountedFurnishingCollision,type MountedFurnishingCollision} from '../viewer/furnishing-collision-mesh';

/** One verified private catalogue visual. The normal bench remains the collision/Sit host and fallback. */
export function privateCatalogBench(document:Exhibition){
 if(!validateFurnishings(document).valid)return undefined;const value=furnishingsFor(document);if(!value)return undefined;
 const rows=value.bindings.filter(b=>b.hostKind==='bench'&&value.assets.some(a=>a.id.toLowerCase()===b.assetId.toLowerCase()&&['backless-oak-bench','sculpture-bench-refined'].includes(a.catalogId)));
 if(rows.length!==1)return undefined;const binding=rows[0]!,asset=value.assets.find(a=>a.id.toLowerCase()===binding.assetId.toLowerCase())!;
 try{return {asset,binding,resolved:resolveFurnishing(document,binding,asset)};}catch{return undefined;}
}
/** A verified local source grants only the asset URL in its own immutable inventory. */
export function catalogBenchSource(document:Exhibition,source:{publicationId:string;revisionSha256:string;assets:PublicAsset[];fetcher?:typeof fetch;check?:()=>Promise<void>}|undefined,privateCatalogue:boolean){
 const selected=privateCatalogBench(document);if(!selected||!source?.check)return undefined;
 const candidates=source.assets.filter(a=>a.assetId===selected.asset.id);
 const reserveBytes=catalogBenchReserve(selected.asset.catalogId);
 if(candidates.length===1&&source.fetcher&&candidates[0]!.mime==='model/gltf-binary'&&candidates[0]!.url===`/api/v1/publications/${source.publicationId}/assets/${selected.asset.id}`)return {url:candidates[0]!.url,fetcher:source.fetcher,check:source.check,revision:source.revisionSha256,reserveBytes};
 if(candidates.length||!privateCatalogue||selected.asset.catalogId!=='backless-oak-bench')return undefined;
 return {url:`/furnish-catalog/${selected.asset.catalogId}/1/model.glb`,fetcher:fetch,check:source.check,reserveBytes};
}
/** Authenticated ordinary Studio source; no publication or static-export authority is invented. */
export function authenticatedCatalogBenchSource(document:Exhibition,session:Session,signal:AbortSignal){
 const selected=privateCatalogBench(document);
 if(!selected||!['admin','artist','curator'].includes(session.role)||!Number.isFinite(Date.parse(session.expiresAt))||Date.parse(session.expiresAt)<=Date.now())return undefined;
 const url=`/api/v1/tenants/${session.tenantId}/studio/furnishings/${selected.asset.catalogId}/1/model`;
 const check=async()=>{
  signal.throwIfAborted();if(Date.parse(session.expiresAt)<=Date.now())throw Error('CATALOG_SESSION_EXPIRED');
  const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok)throw Error('CATALOG_SESSION_REQUIRED');const current=await response.json() as Session;
  if(current.tenantId!==session.tenantId||current.userId!==session.userId||current.role!==session.role||current.csrfToken!==session.csrfToken||current.expiresAt!==session.expiresAt)throw Error('CATALOG_SCOPE_CHANGED');signal.throwIfAborted();
 };
 const fetcher:typeof fetch=async(input,init)=>{
  if(input!==url)throw Error('CATALOG_SOURCE_INVALID');signal.throwIfAborted();
  return fetch(url,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[]),AbortSignal.timeout(30000)])});
 };
 return {url,check,fetcher,reserveBytes:catalogBenchReserve(selected.asset.catalogId)};
}
export function installPrivateCatalogBench(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,fallback:readonly Three.Group[],signal:AbortSignal,check:()=>Promise<void>,unavailable:()=>boolean,maxTriangles:number,changed:(model:Three.Object3D,hostId:string)=>void,assetSource?:{url:string;fetcher:typeof fetch;revision?:string},maxTextureSize=2048){
 const selected=privateCatalogBench(document);let disposed=false,loaded:Awaited<ReturnType<typeof loadCatalogModel>>|undefined,hiddenHost:Three.Group|undefined;
 const dispose=()=>{disposed=true;if(hiddenHost)hiddenHost.visible=true;loaded?.dispose();};
 const start=async()=>{
  if(!selected)return 'unavailable';
  try{
   loaded=await loadCatalogModel(three,selected.resolved.source,{url:assetSource?.url??`/furnish-catalog/${selected.asset.catalogId}/1/model.glb`,fetcher:assetSource?.fetcher??fetch,revision:assetSource?.revision,check,maxTextureSize},signal,()=>disposed||unavailable(),maxTriangles,catalogBenchReserve(selected.asset.catalogId));
   if(disposed||signal.aborted||unavailable())throw Error('CATALOG_INACTIVE');
   const {resolved,binding}=selected,room=rooms.get(resolved.roomId.toLowerCase()),host=fallback.find(g=>String(g.userData.benchId).toLowerCase()===binding.hostId.toLowerCase());if(!room||!host)throw Error('CATALOG_HOST');
   const p=resolved.pose;loaded.model.position.fromArray(p.position);loaded.model.quaternion.fromArray(p.rotation);loaded.model.scale.fromArray(p.scale);room.add(loaded.model);hiddenHost=host;host.visible=false;changed(loaded.model,binding.hostId);return 'ready';
  }catch{dispose();return 'fallback';}
 };
 return {start,dispose};
}

/** Non-bench visuals share the verified loader; functional hosts remain authoritative. */
export const FURNISHING_RESERVE_BYTES=4*1024*1024;
export function catalogOtherSources(document:Exhibition,source:{publicationId:string;revisionSha256:string;assets:PublicAsset[];fetcher?:typeof fetch;check?:()=>Promise<void>}|undefined){
 if(!source?.check||!source.fetcher||!validateFurnishings(document).valid)return [];
 const value=furnishingsFor(document);if(!value)return [];
 return value.bindings.flatMap(binding=>{
  if(binding.hostKind==='bench')return [];
  const asset=value.assets.find(a=>a.id.toLowerCase()===binding.assetId.toLowerCase()),matches=source.assets.filter(a=>a.assetId===binding.assetId);
  if(!asset||matches.length!==1||matches[0]!.mime!=='model/gltf-binary'||matches[0]!.url!==`/api/v1/publications/${source.publicationId}/assets/${asset.id}`)return [];
  try{
   const coupling:{expectedCoupled?:boolean}={expectedCoupled:asset.catalogId==='museum-track-spot'&&binding.hostKind==='light'&&trackSpotStaticRailContext(document,binding.hostId)};
   return [{binding,asset,...coupling,resolved:resolveFurnishing(document,binding,asset),source:{url:matches[0]!.url,fetcher:source.fetcher!,check:source.check!,revision:source.revisionSha256}}];
  }catch{return [];}
 });
}
export function installCatalogOtherVisuals(three:typeof Three,items:ReturnType<typeof catalogOtherSources>,rooms:ReadonlyMap<string,Three.Group>,fixtures:ReadonlyMap<string,Three.Object3D[]>,pedestals:ReadonlyMap<string,Three.Object3D[]>,signal:AbortSignal,unavailable:()=>boolean,maxTriangles:number,changed:()=>void,collisionPolicy?:{scene:Three.Scene;enabled:(kind:'light'|'opening',id:string)=>boolean},lights?:ReadonlyMap<string,{light:Three.Light}>){
 let disposed=false,remaining=FURNISHING_RESERVE_BYTES,triangles=0;const loaded:Awaited<ReturnType<typeof loadCatalogModel>>[]=[],hidden:{object:Three.Object3D;visible:boolean}[]=[];
 const collisions=new Map<string,MountedFurnishingCollision>();
 const dispose=()=>{if(disposed)return;disposed=true;collisions.clear();for(const h of hidden)h.object.visible=h.visible;for(const l of loaded)l.dispose();hidden.length=0;loaded.length=0;};
 const start=async()=>{const results:{kind:string;id:string;status:string}[]=[];for(const item of items){
  if(disposed||signal.aborted||unavailable())break;
  const {binding,resolved}=item,room=rooms.get(resolved.roomId.toLowerCase()),fallback=binding.hostKind==='light'?fixtures.get(binding.hostId.toLowerCase()):binding.hostKind==='pedestal'?pedestals.get(binding.hostId.toLowerCase()):[];
  if(!room||(binding.hostKind==='pedestal'&&!fallback?.length)){results.push({kind:binding.hostKind,id:binding.hostId,status:'fallback'});continue;}
  let visual:Awaited<ReturnType<typeof loadCatalogModel>>|undefined;const previous=(fallback??[]).map(object=>({object,visible:object.visible})),collisionId=binding.hostKind+':'+binding.hostId.toLowerCase();
  try{
   visual=await loadCatalogModel(three,resolved.source,item.source,signal,()=>disposed||unavailable(),Math.max(0,maxTriangles-triangles),remaining);
   if(disposed||signal.aborted||unavailable())throw Error('CATALOG_INACTIVE');
   const target=binding.hostKind==='pedestal'?fallback?.[0]?.parent:room;if(!target)throw Error('CATALOG_HOST');const parent=new three.Group(),p=resolved.parent;parent.position.fromArray(p.position);parent.quaternion.fromArray(p.rotation);parent.scale.fromArray(p.scale);
   const wallwasher='wallwasher' in resolved?resolved.wallwasher:undefined;
   const mountProfile='mountProfile' in resolved?resolved.mountProfile:undefined;
   if(item.expectedCoupled||item.asset.catalogId==='museum-wallwasher-rear-relief'||wallwasher!==undefined||mountProfile!==undefined){
    const expectedProfile=item.asset.catalogId==='museum-track-spot'?'museum-track-spot-fixed-head-v1':item.asset.catalogId==='museum-wallwasher-rear-relief'?'museum-wallwasher-rear-relief-fixed-head-v1':undefined;
    if(!expectedProfile||mountProfile!==expectedProfile||!wallwasher||binding.hostKind!=='light'||[resolved.parent,resolved.pose].some(p=>p.position.some(n=>n!==0)||p.rotation.some((n,i)=>n!==(i===3?1:0))||p.scale.some(n=>n!==1)))throw Error('WALLWASHER_MODEL_PAIR_INVALID');
    applyWallwasherModelPose(three,visual.model,item.asset,wallwasher);
    if(lights&&item.asset.catalogId==='museum-wallwasher-rear-relief'){const light=[...lights].find(([id])=>id.toLowerCase()===binding.hostId.toLowerCase())?.[1].light;if(!light)throw Error('WALLWASHER_EMITTER_LIGHT_REQUIRED');
     const emission=installWallwasherEmission(three,visual.model,item.asset,light),disposeSource=visual.dispose;visual.dispose=()=>{emission.dispose();disposeSource();};
    }
   }else{const pose=resolved.pose;visual.model.position.fromArray(pose.position);visual.model.quaternion.fromArray(pose.rotation);visual.model.scale.fromArray(pose.scale);}
   visual.model.userData.editorSelection=binding.hostKind==='pedestal'?{kind:'placement',id:binding.hostId}:binding.hostKind==='opening'?{kind:'opening',id:binding.hostId}:undefined;
   parent.add(visual.model);target.add(parent);const disposeVisual=visual.dispose;visual.dispose=()=>{disposeVisual();parent.removeFromParent();};
   if((binding.hostKind==='light'||binding.hostKind==='opening')&&collisionPolicy?.enabled(binding.hostKind,binding.hostId)){
    const collision=mountedFurnishingCollision(three,collisionId,visual.model,collisionPolicy.scene,()=>disposed||signal.aborted||unavailable());
    if(collision)collisions.set(collisionId,collision);
   }
   for(const h of previous)h.object.visible=false;changed();if(disposed||signal.aborted||unavailable())throw Error('CATALOG_INACTIVE');remaining-=visual.resident;triangles+=visual.triangles;loaded.push(visual);hidden.push(...previous);results.push({kind:binding.hostKind,id:binding.hostId,status:'ready'});
  }catch{collisions.delete(collisionId);for(const h of previous)h.object.visible=h.visible;visual?.dispose();results.push({kind:binding.hostKind,id:binding.hostId,status:'fallback'});}
 }return results;};return {start,dispose,collisions};
}
