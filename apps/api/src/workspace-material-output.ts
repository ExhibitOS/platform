// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_MATERIAL_NAMESPACE,packageWorkspaceMaterialManifest,type WorkspaceMaterialBindings,type WorkspaceMaterialResource} from '@exhibitos/spec/workspace-material';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {assertWorkspaceMaterialSnapshot} from './workspace-material-snapshot.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

/** The initial output profile handles only floor color maps. Reject other
 * declared content explicitly instead of producing an incomplete archive. */
export function workspaceMaterialOutputInventory(candidate:{extensions?:Record<string,unknown>;surfaces?:unknown}):WorkspaceMaterialResource[]{
 const value=candidate.extensions?.[WORKSPACE_MATERIAL_NAMESPACE];if(value===undefined)return [];
 let resources:WorkspaceMaterialResource[];
 try{resources=packageWorkspaceMaterialManifest(candidate);}catch{throw new ApiError(422,'DRAFT_INVALID');}
 const data=value as WorkspaceMaterialBindings;
 if(!resources.length||data.materials.some(m=>m.kind!=='floor'||Object.keys(m.maps).length!==1||!m.maps.color)||resources.some(r=>r.role!=='color'))throw new ApiError(422,'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 return resources;
}

/** Obtain only owner-registered bytes and recheck the descriptor rather than
 * trusting archive paths or a portable-looking snapshot as authority. */
export async function workspaceMaterialOutputBytes(c:PoolClient,s:Session,candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},service:WorkspaceMaterialIntakes|undefined,resource:WorkspaceMaterialResource,purpose:'display'|'export'){
 const inventory=workspaceMaterialOutputInventory(candidate);
 if(!inventory.some(item=>isDeepStrictEqual(item,resource)))throw new ApiError(422,'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 await assertWorkspaceMaterialSnapshot(c,s,candidate,service);
 if(!service)throw new ApiError(422,'WORKSPACE_MATERIAL_UNAVAILABLE');
 return purpose==='display'?service.preview(c,s,resource.materialId,resource.materialVersion,resource.role):service.exportMap(c,s,resource.materialId,resource.materialVersion,resource.role);
}
