// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishingDescriptor,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';

/** The same aggregate bound applies before preparation and on public reads. */
export function workspaceFurnishingPublicationWithinBudget(sizes:readonly number[]){
 let total=0;for(const size of sizes){if(!Number.isSafeInteger(size)||size<1||!Number.isSafeInteger(total+size))return false;total+=size;if(total>64*1024*1024)return false;}return true;
}

/** Public identifiers never identify the private workspace or registered source. */
export function projectWorkspaceFurnishings(candidate:{extensions?:Record<string,unknown>;rooms?:unknown},map:(id:string)=>string){
 if(!candidate.extensions||!Object.hasOwn(candidate.extensions,WORKSPACE_FURNISHING_NAMESPACE))return undefined;
 const source=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings;
 if(!validateWorkspaceFurnishings(candidate).valid)throw new ApiError(422,'DRAFT_INVALID');
 const bindings:Array<{publicId:string;descriptor:WorkspaceFurnishingDescriptor}>=source.furnishings.map(descriptor=>({publicId:map(descriptor.id),descriptor:structuredClone(descriptor)}));
 const furnishingIds=new Map(bindings.map(binding=>[binding.descriptor.id,binding.publicId]));
 const extension:WorkspaceFurnishings={version:1,furnishings:source.furnishings.map(descriptor=>({...structuredClone(descriptor),id:furnishingIds.get(descriptor.id)!,provenance:'Provided by the exhibition editor.'})),placements:source.placements.map(placement=>({...structuredClone(placement),id:map(placement.id),roomId:map(placement.roomId),furnishingId:furnishingIds.get(placement.furnishingId)!}))};
 return {extension,bindings};
}

/** Resolve only immutable private rows for this publication. A public descriptor
 * is evidence of placement, never a workspace authority or an object key. */
export async function admittedPublicationWorkspaceFurnishings(c:import('pg').PoolClient,tenantId:string,publicationId:string,candidate:{extensions?:Record<string,unknown>;rooms?:unknown},service?:import('./workspace-furnishing-intakes.ts').WorkspaceFurnishingIntakes,retainPublicId?:string){
 if(!candidate.extensions||!Object.hasOwn(candidate.extensions,WORKSPACE_FURNISHING_NAMESPACE))return [];
 const source=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings;
 if(!service||!validateWorkspaceFurnishings(candidate).valid)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 const rows=(await c.query('SELECT public_id,workspace_id,tenant_id,user_id,source_id,source_version,source_descriptor FROM publication_workspace_furnishings WHERE tenant_id=$1 AND publication_id=$2',[tenantId,publicationId])).rows as Array<{public_id:string;workspace_id:string;tenant_id:string;user_id:string;source_id:string;source_version:number;source_descriptor:WorkspaceFurnishingDescriptor}>;
 if(rows.length!==source.furnishings.length||new Set(rows.map(row=>row.public_id)).size!==rows.length)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 if(!workspaceFurnishingPublicationWithinBudget(source.furnishings.map(item=>item.model.bytes)))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 const result:Array<{publicId:string;bytes?:Buffer;mime:string;sha256:string;sourceDescriptor:WorkspaceFurnishingDescriptor}>=[];
 for(const published of source.furnishings){
  const row=rows.find(item=>item.public_id===published.id),original=row?.source_descriptor;
  if(!row||!original||row.tenant_id!==tenantId||row.source_id!==original.id||row.source_version!==original.version||!isDeepStrictEqual({...original,id:row.public_id,provenance:'Provided by the exhibition editor.'},published))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const model=await service.publicationModel(c,{workspaceId:row.workspace_id,tenantId:row.tenant_id,userId:row.user_id,descriptor:original});
  if(model.bytes.length!==published.model.bytes||model.sha256!==published.model.sha256||model.mime!==published.model.mime)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  result.push({publicId:published.id,mime:model.mime,sha256:model.sha256,sourceDescriptor:original,...(published.id===retainPublicId?{bytes:model.bytes}:{})});
 }
 await service.publicationFence(c,result.map(item=>item.sourceDescriptor));
 return result;
}
