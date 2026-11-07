// SPDX-License-Identifier: AGPL-3.0-or-later
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';

type Material=WorkspaceMaterialBindings['materials'][number];

/** The public snapshot does not carry workspace identifiers or original provenance.
 * The returned private bindings must be committed with the publication; a public
 * descriptor alone must never authorize the original material or its map. */
export function projectWorkspaceMaterials(candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},map:(id:string)=>string){
 if(!candidate.extensions||!Object.hasOwn(candidate.extensions,WORKSPACE_MATERIAL_NAMESPACE))return undefined;
 workspaceMaterialOutputInventory(candidate);
 const source=candidate.extensions[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings;
 const bindings:Array<{publicId:string;descriptor:Material}>=source.materials.map(descriptor=>({publicId:map(descriptor.id),descriptor:structuredClone(descriptor)}));
 const ids=new Map(bindings.map(binding=>[binding.descriptor.id.toLowerCase(),binding.publicId]));
 const extension:WorkspaceMaterialBindings={version:1,materials:source.materials.map(descriptor=>({...structuredClone(descriptor),id:ids.get(descriptor.id.toLowerCase())!,provenance:'Provided by the exhibition editor.'})),bindings:source.bindings.map(binding=>({...structuredClone(binding),surfaceId:map(binding.surfaceId),materialId:ids.get(binding.materialId.toLowerCase())!}))};
 return {extension,bindings};
}

/** Public reads must rebind each public identifier to the actual immutable
 * workspace row and independently verify current display and export rights. */
export async function admittedPublicationWorkspaceMaterials(c:import('pg').PoolClient,tenantId:string,publicationId:string,candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},service?:import('./workspace-material-intakes.ts').WorkspaceMaterialIntakes,retainPublicId?:string){
 if(!candidate.extensions||!Object.hasOwn(candidate.extensions,WORKSPACE_MATERIAL_NAMESPACE))return [];
 const {ApiError}=await import('./auth.ts'),{isDeepStrictEqual}=await import('node:util');
 const source=candidate.extensions[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings;
 if(!service)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 try{workspaceMaterialOutputInventory(candidate);}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
 const rows=(await c.query('SELECT public_id,workspace_id,tenant_id,user_id,source_id,source_version,source_descriptor FROM publication_workspace_materials WHERE tenant_id=$1 AND publication_id=$2',[tenantId,publicationId])).rows as Array<{public_id:string;workspace_id:string;tenant_id:string;user_id:string;source_id:string;source_version:number;source_descriptor:Material}>;
 if(rows.length!==source.materials.length||new Set(rows.map(row=>row.public_id)).size!==rows.length)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 let total=0;const result:Array<{publicId:string;bytes?:Buffer;mime:string;sha256:string;sourceDescriptor:Material}>=[];
 for(const published of source.materials){
  const row=rows.find(item=>item.public_id===published.id),original=row?.source_descriptor;
  if(!row||!original||row.tenant_id!==tenantId||row.source_id!==original.id||row.source_version!==original.version||!isDeepStrictEqual({...original,id:row.public_id,provenance:'Provided by the exhibition editor.'},published))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  total+=published.maps.color.bytes;if(!Number.isSafeInteger(total)||total>64*1024*1024)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const map=await service.publicationMap(c,{workspaceId:row.workspace_id,tenantId:row.tenant_id,userId:row.user_id,descriptor:original});
  if(map.bytes.length!==published.maps.color.bytes||map.sha256!==published.maps.color.sha256||map.mime!==published.maps.color.mime)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  result.push({publicId:published.id,mime:map.mime,sha256:map.sha256,sourceDescriptor:original,...(published.id===retainPublicId?{bytes:map.bytes}:{})});
 }
 await service.publicationFence(c,result.map(item=>item.sourceDescriptor));return result;
}
