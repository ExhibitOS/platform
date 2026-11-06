// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {WorkspaceMaterialBinding} from '@exhibitos/spec/workspace-material';
import type {Session} from './cms-client';
import {workspaceFloorMaterials} from './drafts/workspace-material-validation.mjs';
import {materialMapPlan} from './material-texture-plan';
import {createRegisteredMaterialTextureRenderer,type MaterialTextureFile,type MaterialTexturePack} from './floor-texture-renderer';

/** Only paths derived from validated IDs and hashes enter the local registry. */
export function workspaceFloorPlan(document:Exhibition,maxTextureSize:number,availableBytes:number){
 const entries=workspaceFloorMaterials(document),packs=new Map<string,MaterialTexturePack>(),registry:MaterialTextureFile[]=[],targets=new Map<string,WorkspaceMaterialBinding>(),grants=new Map<string,typeof entries[number]['material']['rights']>();
 for(const {binding,material} of entries){
  const key=material.id.toLowerCase()+':'+material.version;targets.set(binding.surfaceId.toLowerCase(),binding);grants.set(key,material.rights);
  if(!packs.has(key)){const color=material.maps.color,file:MaterialTextureFile={path:`workspace-materials/${material.id.toLowerCase()}/${material.version}/color-${color.sha256}.png`,mime:color.mime,bytes:color.bytes,sha256:color.sha256,width:color.width,height:color.height,colorSpace:color.colorSpace};registry.push(file);packs.set(key,{id:key,maps:{color:file}});}
 }
 const cost=materialMapPlan(registry.map(file=>({...file,role:'color' as const})),maxTextureSize,availableBytes),sizes=new Map(registry.map((file,i)=>[file,cost.sizes[i]??0]));
 return {packs:cost.blocked?[]:[...packs.values()],blocked:cost.blocked?[...packs.keys()]:[],registry,targets,grants,reserveBytes:cost.reserveBytes,residentBytes:cost.residentBytes,sizeFor:(file:MaterialTextureFile)=>sizes.get(file)??0,packFor:(binding:WorkspaceMaterialBinding)=>packs.get(binding.materialId.toLowerCase()+':'+binding.materialVersion)};
}

/** Authenticated owner preview; no input URL or storage key comes from a draft. */
export function workspaceFloorFetcher(plan:ReturnType<typeof workspaceFloorPlan>,session:Session):typeof fetch{
 const paths=new Map<string,string>();
 for(const pack of plan.packs){const file=pack.maps.color;if(!file)continue;const [id,version]=pack.id.split(':');paths.set('/'+file.path,`/api/v1/tenants/${session.tenantId}/workspace/materials/${id}/versions/${version}/maps/color`);}
 return async(input,init)=>{if(typeof input!=='string'||!paths.has(input))throw Error('WORKSPACE_MATERIAL_PATH');return fetch(paths.get(input)!,{...init,credentials:'same-origin',cache:'no-store',redirect:'error'});};
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
 return {add:renderer.add,async start(notify:()=>void){changed=notify;refresh();return renderer.start(notify);},dispose(){if(disposed)return;disposed=true;if(timer!==undefined)clearTimeout(timer);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',onResume);if(typeof window!=='undefined'){window.removeEventListener('focus',onResume);window.removeEventListener('pageshow',onResume);}renderer.dispose();}};
}
