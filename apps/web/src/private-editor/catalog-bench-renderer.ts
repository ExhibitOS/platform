// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {PublicAsset} from '../publication-client';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from '@exhibitos/studio-contract';
import {loadCatalogModel} from './catalog-furnishing-loader';
import {BENCH_CATALOG,BENCH_CATALOG_PATH,BENCH_RESERVE_BYTES} from './catalog-bench';

/** One verified private catalogue visual. The normal bench remains the collision/Sit host and fallback. */
export function privateCatalogBench(document:Exhibition){
 if(!validateFurnishings(document).valid)return undefined;const value=furnishingsFor(document);if(!value)return undefined;
 const rows=value.bindings.filter(b=>b.hostKind==='bench'&&value.assets.some(a=>a.id===b.assetId&&a.catalogId==='backless-oak-bench'));
 if(rows.length!==1)return undefined;const binding=rows[0]!,asset=value.assets.find(a=>a.id===binding.assetId)!;
 try{return {asset,binding,resolved:resolveFurnishing(document,binding,asset)};}catch{return undefined;}
}
/** A verified local source grants only the asset URL in its own immutable inventory. */
export function catalogBenchSource(document:Exhibition,source:{publicationId:string;revisionSha256:string;assets:PublicAsset[];fetcher?:typeof fetch;check?:()=>Promise<void>}|undefined,privateCatalogue:boolean){
 const selected=privateCatalogBench(document);if(!selected||!source?.check)return undefined;
 const candidates=source.assets.filter(a=>a.assetId===selected.asset.id);
 if(candidates.length===1&&source.fetcher&&candidates[0]!.mime==='model/gltf-binary'&&candidates[0]!.url===`/api/v1/publications/${source.publicationId}/assets/${selected.asset.id}`)return {url:candidates[0]!.url,fetcher:source.fetcher,check:source.check,revision:source.revisionSha256};
 if(candidates.length||!privateCatalogue)return undefined;
 return {url:'/'+BENCH_CATALOG_PATH,fetcher:fetch,check:source.check};
}
export function installPrivateCatalogBench(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,fallback:readonly Three.Group[],signal:AbortSignal,check:()=>Promise<void>,unavailable:()=>boolean,maxTriangles:number,changed:()=>void,assetSource?:{url:string;fetcher:typeof fetch;revision?:string}){
 const selected=privateCatalogBench(document);let disposed=false,loaded:Awaited<ReturnType<typeof loadCatalogModel>>|undefined,hiddenHost:Three.Group|undefined;
 const dispose=()=>{disposed=true;if(hiddenHost)hiddenHost.visible=true;loaded?.dispose();};
 const start=async()=>{
  if(!selected)return 'unavailable';
  try{
   loaded=await loadCatalogModel(three,BENCH_CATALOG,{url:assetSource?.url??'/'+BENCH_CATALOG_PATH,fetcher:assetSource?.fetcher??fetch,revision:assetSource?.revision,check},signal,()=>disposed||unavailable(),maxTriangles,BENCH_RESERVE_BYTES);
   if(disposed||signal.aborted||unavailable())throw Error('CATALOG_INACTIVE');
   const {resolved,binding}=selected,room=rooms.get(resolved.roomId.toLowerCase()),host=fallback.find(g=>g.userData.benchId===binding.hostId);if(!room||!host)throw Error('CATALOG_HOST');
   const p=resolved.pose;loaded.model.position.fromArray(p.position);loaded.model.quaternion.fromArray(p.rotation);loaded.model.scale.fromArray(p.scale);room.add(loaded.model);hiddenHost=host;host.visible=false;changed();return 'ready';
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
  const asset=value.assets.find(a=>a.id===binding.assetId),matches=source.assets.filter(a=>a.assetId===binding.assetId);
  if(!asset||matches.length!==1||matches[0]!.mime!=='model/gltf-binary'||matches[0]!.url!==`/api/v1/publications/${source.publicationId}/assets/${asset.id}`)return [];
  try{return [{binding,asset,resolved:resolveFurnishing(document,binding,asset),source:{url:matches[0]!.url,fetcher:source.fetcher!,check:source.check!,revision:source.revisionSha256}}];}catch{return [];}
 });
}
export function installCatalogOtherVisuals(three:typeof Three,items:ReturnType<typeof catalogOtherSources>,rooms:ReadonlyMap<string,Three.Group>,fixtures:ReadonlyMap<string,Three.Object3D[]>,pedestals:ReadonlyMap<string,Three.Object3D[]>,signal:AbortSignal,unavailable:()=>boolean,maxTriangles:number,changed:()=>void){
 let disposed=false,remaining=FURNISHING_RESERVE_BYTES,triangles=0;const loaded:Awaited<ReturnType<typeof loadCatalogModel>>[]=[],hidden:{object:Three.Object3D;visible:boolean}[]=[];
 const dispose=()=>{if(disposed)return;disposed=true;for(const h of hidden)h.object.visible=h.visible;for(const l of loaded)l.dispose();hidden.length=0;loaded.length=0;};
 const start=async()=>{const results:{kind:string;id:string;status:string}[]=[];for(const item of items){
  if(disposed||signal.aborted||unavailable())break;
  const {binding,resolved}=item,room=rooms.get(resolved.roomId.toLowerCase()),fallback=binding.hostKind==='light'?fixtures.get(binding.hostId.toLowerCase()):binding.hostKind==='pedestal'?pedestals.get(binding.hostId.toLowerCase()):[];
  if(!room||(binding.hostKind==='pedestal'&&!fallback?.length)){results.push({kind:binding.hostKind,id:binding.hostId,status:'fallback'});continue;}
  let visual:Awaited<ReturnType<typeof loadCatalogModel>>|undefined;const previous=(fallback??[]).map(object=>({object,visible:object.visible}));
  try{
   visual=await loadCatalogModel(three,resolved.source,item.source,signal,()=>disposed||unavailable(),Math.max(0,maxTriangles-triangles),remaining);
   if(disposed||signal.aborted||unavailable())throw Error('CATALOG_INACTIVE');
   const target=binding.hostKind==='pedestal'?fallback?.[0]?.parent:room;if(!target)throw Error('CATALOG_HOST');const parent=new three.Group(),p=resolved.parent;parent.position.fromArray(p.position);parent.quaternion.fromArray(p.rotation);parent.scale.fromArray(p.scale);
   const pose=resolved.pose;visual.model.position.fromArray(pose.position);visual.model.quaternion.fromArray(pose.rotation);visual.model.scale.fromArray(pose.scale);
   visual.model.userData.editorSelection=binding.hostKind==='pedestal'?{kind:'placement',id:binding.hostId}:binding.hostKind==='opening'?{kind:'opening',id:binding.hostId}:undefined;
   parent.add(visual.model);target.add(parent);const disposeVisual=visual.dispose;visual.dispose=()=>{disposeVisual();parent.removeFromParent();};
   for(const h of previous)h.object.visible=false;changed();remaining-=visual.resident;triangles+=visual.triangles;loaded.push(visual);hidden.push(...previous);results.push({kind:binding.hostKind,id:binding.hostId,status:'ready'});
  }catch{for(const h of previous)h.object.visible=h.visible;visual?.dispose();results.push({kind:binding.hostKind,id:binding.hostId,status:'fallback'});}
 }return results;};return {start,dispose};
}
