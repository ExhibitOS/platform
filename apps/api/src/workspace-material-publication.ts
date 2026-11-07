// SPDX-License-Identifier: AGPL-3.0-or-later
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {workspaceMaterialOutputInventory,workspaceMaterialPublicationWithinBudget} from './workspace-material-output.ts';

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
export async function admittedPublicationWorkspaceMaterials(c:import('pg').PoolClient,tenantId:string,publicationId:string,candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},service?:import('./workspace-material-intakes.ts').WorkspaceMaterialIntakes,retainPublicId?:string,retainResourceHash?:string,retainAll=false,signal?:AbortSignal,bindingsOnly=false){
 if(!candidate.extensions||!Object.hasOwn(candidate.extensions,WORKSPACE_MATERIAL_NAMESPACE))return [];
 const {ApiError}=await import('./auth.ts'),{isDeepStrictEqual}=await import('node:util');
 const source=candidate.extensions[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings;
 if(!service)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 try{const inventory=workspaceMaterialOutputInventory(candidate);if(!workspaceMaterialPublicationWithinBudget(inventory)||inventory.some(item=>item.role!=='color')&&service.supportsMultimap?.()!==true)throw Error();}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
 const rows=(await c.query('SELECT public_id,workspace_id,tenant_id,user_id,source_id,source_version,source_descriptor FROM publication_workspace_materials WHERE tenant_id=$1 AND publication_id=$2',[tenantId,publicationId])).rows as Array<{public_id:string;workspace_id:string;tenant_id:string;user_id:string;source_id:string;source_version:number;source_descriptor:Material}>;
 if(rows.length!==source.materials.length||new Set(rows.map(row=>row.public_id)).size!==rows.length)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 let total=0;const result:Array<{publicId:string;bytes?:Buffer;mime:string;sha256:string;sourceDescriptor:Material;auxiliary:Array<{sha256:string;bytes?:Buffer;mime:string}>}>=[];
 for(const published of source.materials){signal?.throwIfAborted();
  const row=rows.find(item=>item.public_id===published.id),original=row?.source_descriptor;
  if(!row||!original||row.tenant_id!==tenantId||row.source_id!==original.id||row.source_version!==original.version||!isDeepStrictEqual({...original,id:row.public_id,provenance:'Provided by the exhibition editor.'},published))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const auxiliary:Array<{sha256:string;bytes?:Buffer;mime:string}>=[];let color:{bytes?:Buffer;mime:string;sha256:string}|undefined;
  for(const role of ['color','normal','roughness'] as const){signal?.throwIfAborted();const expected=published.maps[role];if(!expected)continue;total+=expected.bytes;if(!Number.isSafeInteger(total)||total>64*1024*1024)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
   const binding={workspaceId:row.workspace_id,tenantId:row.tenant_id,userId:row.user_id,descriptor:original};
   const map=bindingsOnly?await service.publicationMapBinding(c,binding,role,signal).then(value=>({mime:value.map.mime,sha256:value.map.sha256,bytes:undefined})):await service.publicationMap(c,binding,role,signal);
   signal?.throwIfAborted();if((!bindingsOnly&&map.bytes?.length!==expected.bytes)||map.sha256!==expected.sha256||map.mime!==expected.mime)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
   if(role==='color')color=map;else auxiliary.push({sha256:map.sha256,mime:map.mime,...((retainAll||map.sha256===retainResourceHash)&&map.bytes?{bytes:map.bytes}:{})});
  }
  if(!color)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  result.push({publicId:published.id,mime:color.mime,sha256:color.sha256,sourceDescriptor:original,auxiliary,...((retainAll||published.id===retainPublicId)&&color.bytes?{bytes:color.bytes}:{})});
 }
 await service.publicationFence(c,result.map(item=>item.sourceDescriptor));return result;
}
