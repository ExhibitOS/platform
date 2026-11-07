// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_MATERIAL_NAMESPACE,packageWorkspaceMaterialManifest,type WorkspaceMaterialBindings,type WorkspaceMaterialResource} from '@exhibitos/spec/workspace-material';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {assertWorkspaceMaterialSnapshot} from './workspace-material-snapshot.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

/** Restrict V6 selected imports before inventory writes. Only the locally
 * issued V7 catalog context can grant wall support to the owner pipeline. */
export function assertWorkspaceImportKind(candidate:{extensions?:Record<string,unknown>},wallImport:boolean,multimap=false){
 const ext=candidate.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings|undefined;
 if(!ext||!Array.isArray(ext.materials)||!wallImport&&ext.materials.some(m=>m.kind!=='floor')||!multimap&&ext.materials.some(m=>Object.keys(m.maps??{}).some(role=>role!=='color')))throw new ApiError(422,'WORKSPACE_MATERIAL_IMPORT_UNSUPPORTED');
}

/** The output profile handles floor and wall color, normal and roughness maps. Reject other
 * declared content explicitly instead of producing an incomplete archive. */
export function workspaceMaterialOutputInventory(candidate:{extensions?:Record<string,unknown>;surfaces?:unknown}):WorkspaceMaterialResource[]{
 const value=candidate.extensions?.[WORKSPACE_MATERIAL_NAMESPACE];if(value===undefined)return [];
 let resources:WorkspaceMaterialResource[];
 try{resources=packageWorkspaceMaterialManifest(candidate);}catch{throw new ApiError(422,'DRAFT_INVALID');}
 const data=value as WorkspaceMaterialBindings;
 if(!resources.length||data.materials.some(m=>!['floor','wall'].includes(m.kind)||!m.maps.color||Object.keys(m.maps).some(role=>!['color','normal','roughness'].includes(role)))||resources.some(r=>!['color','normal','roughness'].includes(r.role)))throw new ApiError(422,'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 return resources;
}

/** The public owner gate and publication admission share this exact ceiling. */
export function workspaceMaterialPublicationWithinBudget(resources:readonly WorkspaceMaterialResource[]){
 let total=0;for(const resource of resources){total+=resource.bytes;if(!Number.isSafeInteger(total)||total>64*1024*1024)return false;}return true;
}

/** Obtain only owner-registered bytes and recheck the descriptor rather than
 * trusting archive paths or a portable-looking snapshot as authority. */
export async function workspaceMaterialOutputBytes(c:PoolClient,s:Session,candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},service:WorkspaceMaterialIntakes|undefined,resource:WorkspaceMaterialResource,purpose:'display'|'export'){
 const inventory=workspaceMaterialOutputInventory(candidate);
 if(!inventory.some(item=>isDeepStrictEqual(item,resource)))throw new ApiError(422,'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 try{await assertWorkspaceMaterialSnapshot(c,s,candidate,service);}
 catch(error){if(purpose==='export'&&error instanceof ApiError&&error.code==='DISPLAY_PERMISSION_REQUIRED')throw new ApiError(403,'RIGHTS_DENIED');throw error;}
 if(!service)throw new ApiError(422,'WORKSPACE_MATERIAL_UNAVAILABLE');
 if(inventory.some(item=>item.role!=='color')&&service.supportsMultimap?.()!==true)throw new ApiError(422,'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 return purpose==='display'?service.preview(c,s,resource.materialId,resource.materialVersion,resource.role):service.exportMap(c,s,resource.materialId,resource.materialVersion,resource.role);
}
