// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {WorkspaceMaterialBinding} from '@exhibitos/spec/workspace-material';
import type {Session} from './cms-client';
import type {PublicAsset,PublicResource} from './publication-client';
import {publicWorkspaceMaterialRights} from './workspace-material-public-rights.mjs';
import {workspaceFloorMaterials} from './drafts/workspace-material-validation.mjs';
import {materialMapPlan} from './material-texture-plan';
import {createRegisteredMaterialTextureRenderer,type MaterialTextureFile,type MaterialTexturePack} from './floor-texture-renderer';
import {openWorkspaceMaterialBatch,type MaterialBatchRecord} from './workspace-material-batch.mjs';

/** Only paths derived from validated IDs and hashes enter the local registry. */
export function workspaceFloorPlan(document:Exhibition,maxTextureSize:number,availableBytes:number){
 const entries=workspaceFloorMaterials(document),packs=new Map<string,MaterialTexturePack>(),registry:MaterialTextureFile[]=[],costs:Array<MaterialTextureFile & {role:'color'|'normal'|'roughness'}>=[],targets=new Map<string,WorkspaceMaterialBinding>(),materials=new Map<string,typeof entries[number]['material']>(),grants=new Map<string,typeof entries[number]['material']['rights']>();
 for(const {binding,material} of entries){
  const key=material.id.toLowerCase()+':'+material.version;targets.set(binding.surfaceId.toLowerCase(),structuredClone(binding));materials.set(key,structuredClone(material));grants.set(key,structuredClone(material.rights));
  if(!packs.has(key)){
   const maps:Partial<Record<'color'|'normal'|'roughness',MaterialTextureFile>>={};
   for(const role of ['color','normal','roughness'] as const){const map=material.maps[role];if(!map)continue;const file:MaterialTextureFile={path:`workspace-materials/${material.id.toLowerCase()}/${material.version}/${role}-${map.sha256}.png`,mime:map.mime,bytes:map.bytes,sha256:map.sha256,width:map.width,height:map.height,colorSpace:map.colorSpace};registry.push(file);costs.push({...file,role});maps[role]=file;}
   packs.set(key,{id:key,maps});
  }
 }
 const cost=materialMapPlan(costs,maxTextureSize,availableBytes),sizes=new Map(registry.map((file,i)=>[file,cost.sizes[i]??0]));
 return {packs:cost.blocked?[]:[...packs.values()],blocked:cost.blocked?[...packs.keys()]:[],registry,targets,materials,grants,reserveBytes:cost.reserveBytes,residentBytes:cost.residentBytes,sizeFor:(file:MaterialTextureFile)=>sizes.get(file)??0,packFor:(binding:WorkspaceMaterialBinding)=>packs.get(binding.materialId.toLowerCase()+':'+binding.materialVersion)};
}

/** Authenticated owner preview; no input URL or storage key comes from a draft. */
export function workspaceFloorFetcher(plan:ReturnType<typeof workspaceFloorPlan>,session:Session):typeof fetch{
 const paths=new Map<string,{url:string;expected:unknown}>(),canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 for(const pack of plan.packs){const [id,version]=pack.id.split(':');for(const role of ['color','normal','roughness'] as const){const file=pack.maps[role];if(!file)continue;paths.set('/'+file.path,{url:`/api/v1/tenants/${session.tenantId}/workspace/materials/${id}/versions/${version}/maps/${role}`,expected:plan.materials.get(pack.id)});}}
 return async(input,init)=>{
  if(typeof input!=='string'||!paths.has(input))throw Error('WORKSPACE_MATERIAL_PATH');const target=paths.get(input)!,options={...init,credentials:'same-origin' as const,cache:'no-store' as const,redirect:'error' as const};
  const descriptorURL=target.url.replace(/\/maps\/(?:color|normal|roughness)$/,'');const response=await fetch(descriptorURL,options);if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/json'){await response.body?.cancel().catch(()=>{});throw Error('WORKSPACE_MATERIAL_AUTHORITY');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('WORKSPACE_MATERIAL_AUTHORITY');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let actual:unknown;try{actual=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('WORKSPACE_MATERIAL_AUTHORITY');}
  if(canonical(actual)!==canonical(target.expected))throw Error('WORKSPACE_MATERIAL_AUTHORITY');
  return fetch(target.url,options);
 };
}
export function createWorkspaceFloorRenderer(three:typeof Three,plan:ReturnType<typeof workspaceFloorPlan>,signal:AbortSignal,unavailable:()=>boolean,session:Session){
 const allowed=(binding:WorkspaceMaterialBinding)=>{const rights=plan.grants.get(binding.materialId.toLowerCase()+':'+binding.materialVersion),now=Date.now();return !!rights&&rights.permissions.display&&(rights.validFrom===undefined||Date.parse(rights.validFrom)<=now)&&(rights.expiresAt===undefined||now<Date.parse(rights.expiresAt));};
 const renderer=createRegisteredMaterialTextureRenderer<WorkspaceMaterialBinding>(three,plan,plan.registry,plan.packFor,signal,unavailable,workspaceFloorFetcher(plan,session),allowed);
 let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,changed:(()=>void)|undefined;
 const refresh=()=>{if(disposed)return;if(timer!==undefined)clearTimeout(timer);if(renderer.revoke(binding=>!allowed(binding)))changed?.();const now=Date.now(),future=[...plan.grants.values()].map(r=>r.expiresAt===undefined?Infinity:Date.parse(r.expiresAt)).filter(t=>t>now&&Number.isFinite(t));if(future.length)timer=setTimeout(refresh,Math.min(2147483647,Math.max(1,Math.min(...future)-now)));};
 const onResume=()=>refresh();
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',onResume);
 if(typeof window!=='undefined'){window.addEventListener('focus',onResume);window.addEventListener('pageshow',onResume);}
 refresh();
 return {add:renderer.add,enforce:refresh,async start(notify:()=>void){changed=notify;refresh();return renderer.start(notify);},dispose(){if(disposed)return;disposed=true;if(timer!==undefined)clearTimeout(timer);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',onResume);if(typeof window!=='undefined'){window.removeEventListener('focus',onResume);window.removeEventListener('pageshow',onResume);}renderer.dispose();}};
}

/** A public map is selected solely from the publication's checked inventory. */
export function createPublicWorkspaceFloorRenderer(three:typeof Three,plan:ReturnType<typeof workspaceFloorPlan>,signal:AbortSignal,unavailable:()=>boolean,source:{publicationId:string;revisionSha256:string;assets:PublicAsset[];resources?:PublicResource[];materialMapBatch?:{url:string};fetcher:typeof fetch;check:()=>Promise<void>}){
 let closed=false,valid=true,changed:(()=>void)|undefined,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined;
 const rights=()=>publicWorkspaceMaterialRights({materials:[...plan.materials.values()]});
 const check=async()=>{if(closed||!valid||!rights())throw Error('PUBLICATION_UNAVAILABLE');await source.check();if(closed||!valid||!rights())throw Error('PUBLICATION_UNAVAILABLE');};
 const paths=new Map<string,string>(),records:MaterialBatchRecord[]=[],recordsByPath=new Map<string,MaterialBatchRecord>();
 for(const pack of plan.packs){const [id]=pack.id.split(':');for(const role of ['color','normal','roughness'] as const){const file=pack.maps[role];if(!file)continue;let url:string;
  if(role==='color'){const matches=source.assets.filter(a=>a.assetId===id);url=`/api/v1/publications/${source.publicationId}/assets/${id}`;if(matches.length!==1||matches[0]!.mime!==file.mime||matches[0]!.url!==url)throw Error('WORKSPACE_MATERIAL_AUTHORITY');}
  else{const matches=(source.resources??[]).filter(r=>r.sha256===file.sha256);url=`/api/v1/publications/${source.publicationId}/resources/${file.sha256}`;if(matches.length!==1||matches[0]!.bytes!==file.bytes||matches[0]!.mime!==file.mime||matches[0]!.url!==url)throw Error('WORKSPACE_MATERIAL_AUTHORITY');}
  paths.set('/'+file.path,url);const record:MaterialBatchRecord={materialId:id!,version:Number(pack.id.split(':')[1]),role,sha256:file.sha256,bytes:file.bytes};records.push(record);recordsByPath.set('/'+file.path,record);
 }}
 const batchURL=source.materialMapBatch?.url;if(batchURL!==undefined&&batchURL!==`/api/v1/publications/${source.publicationId}/material-maps`)throw Error('WORKSPACE_MATERIAL_AUTHORITY');
 const batchAbort=new AbortController();let batch:Awaited<ReturnType<typeof openWorkspaceMaterialBatch>>|undefined,batchPromise:Promise<Awaited<ReturnType<typeof openWorkspaceMaterialBatch>>>|undefined,batchReleased=false;
 const releaseBatch=async()=>{if(batchReleased||!batchURL||!batch)return;batchReleased=true;try{const response=await source.fetcher(`${batchURL}/${batch.token}`,{method:'DELETE',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});await response.body?.cancel().catch(()=>{});}catch{/* The short-lived server token also expires without a release. */}};
 const batchFence=async()=>{try{
  if(!batchURL||!batch||closed||!valid||!rights())throw Error('PUBLICATION_UNAVAILABLE');const response=await source.fetcher(`${batchURL}/${batch.token}/fence`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,batchAbort.signal])});if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/json'){await response.body?.cancel().catch(()=>{});throw Error('PUBLICATION_UNAVAILABLE');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1024)throw Error('PUBLICATION_UNAVAILABLE');chunks.push(next.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));if(!result||Object.keys(result).join(',')!=='revisionSha256'||result.revisionSha256!==source.revisionSha256||closed||!valid||!rights())throw Error('PUBLICATION_UNAVAILABLE');
 }catch(error){valid=false;batchAbort.abort();if(renderer.revoke(()=>true))changed?.();throw error;}};
 const fetcher:typeof fetch=async(input,init)=>{if(typeof input!=='string'||!paths.has(input))throw Error('WORKSPACE_MATERIAL_AUTHORITY');
  if(batchURL){if(!batchPromise)batchPromise=(async()=>{const response=await source.fetcher(batchURL,{...init,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,batchAbort.signal])});batch=await openWorkspaceMaterialBatch(response,records,source.revisionSha256);if(closed||!valid||batchAbort.signal.aborted){await batch.cancel();await releaseBatch();throw Error('PUBLICATION_UNAVAILABLE');}return batch;})();const bytes=await (await batchPromise).next(recordsByPath.get(input)!);if(closed||!valid||!rights())throw Error('PUBLICATION_UNAVAILABLE');return new Response(bytes as BodyInit,{headers:{'content-type':'image/png','x-exhibitos-publication-revision':source.revisionSha256}});}
  await check();const response=await source.fetcher(paths.get(input)!,{...init,credentials:'omit',cache:'no-store',redirect:'error'});if(response.headers.get('x-exhibitos-publication-revision')!==source.revisionSha256){await response.body?.cancel().catch(()=>{});throw Error('WORKSPACE_MATERIAL_AUTHORITY');}try{await check();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}return response;};
 const renderer=createRegisteredMaterialTextureRenderer<WorkspaceMaterialBinding>(three,plan,plan.registry,plan.packFor,signal,()=>unavailable()||closed||!valid,fetcher,()=>valid&&rights(),batchURL?batchFence:check);
 let checking=false;const refresh=()=>{if(closed)return;if(!rights()){valid=false;if(renderer.revoke(()=>true))changed?.();return;}if(checking)return;checking=true;void check().catch(()=>{valid=false;if(renderer.revoke(()=>true))changed?.();}).finally(()=>{checking=false;});};
 const expiry=[...plan.grants.values()].map(r=>r.expiresAt===undefined?Infinity:Date.parse(r.expiresAt)).filter(Number.isFinite);
 const scheduleExpiry=()=>{const remaining=Math.min(...expiry)-Date.now();if(Number.isFinite(remaining))expiryTimer=setTimeout(()=>{if(remaining>2147483647)scheduleExpiry();else refresh();},Math.min(2147483647,Math.max(0,remaining)));};
 const resume=()=>refresh();
 return {add:renderer.add,enforce(){if(!rights()){valid=false;batchAbort.abort();renderer.revoke(()=>true);}},async start(notify:()=>void){changed=notify;try{await check();const result=await renderer.start(notify);await batch?.cancel();await check();await releaseBatch();timer=setInterval(refresh,5000);scheduleExpiry();if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);return result;}catch(error){batchAbort.abort();await batch?.cancel();await releaseBatch();valid=false;renderer.revoke(()=>true);throw error;}},dispose(){closed=true;batchAbort.abort();void batch?.cancel();void releaseBatch();if(timer)clearInterval(timer);if(expiryTimer)clearTimeout(expiryTimer);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);renderer.dispose();}};
}
