// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {ApiError,uuid} from './auth.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';

/** Prepare typed destination identities only. No bytes, ownership, database
 * rows or authority are created; attachment must still verify the exact staged
 * bytes and commit the destination workspace under the live import fence. */
export function remapWorkspaceMaterialImport(source:{extensions?:Record<string,unknown>;surfaces?:unknown},existing:Readonly<Record<string,string>>,nextId:()=>string=randomUUID){
 const resources=workspaceMaterialOutputInventory(source);if(!resources.length)return {extension:undefined,idMap:{...existing}};
 const sourceBindings=source.extensions![WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings,idMap={...existing},allocated=new Set(Object.values(existing).map(id=>id.toLowerCase())),mappedMaterials=new Set<string>();
 if(allocated.size!==Object.keys(existing).length)throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');
 for(const [from,to] of Object.entries(existing)){try{uuid(from);uuid(to);}catch{throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');}if(from!==from.toLowerCase()||to!==to.toLowerCase())throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');}
 for(const material of sourceBindings.materials){
  const from=material.id.toLowerCase();if(mappedMaterials.has(from))continue;if(Object.hasOwn(idMap,from))throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');
  const to=nextId();uuid(to);if(to!==to.toLowerCase()||allocated.has(to))throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');idMap[from]=to;allocated.add(to);
  mappedMaterials.add(from);
 }
 const extension:WorkspaceMaterialBindings={version:1,materials:sourceBindings.materials.map(material=>({...structuredClone(material),id:idMap[material.id.toLowerCase()]!})),bindings:sourceBindings.bindings.map(binding=>{
  const surfaceId=idMap[binding.surfaceId.toLowerCase()],materialId=idMap[binding.materialId.toLowerCase()];if(!surfaceId||!materialId)throw new ApiError(422,'OEX_WORKSPACE_ID_CONFLICT');
  return {...structuredClone(binding),surfaceId,materialId};
 })};
 return {extension,idMap};
}
