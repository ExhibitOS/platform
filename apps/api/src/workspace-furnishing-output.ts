// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_FURNISHING_NAMESPACE,packageWorkspaceFurnishingManifest,type WorkspaceFurnishingResource} from '@exhibitos/spec/workspace-furnishing';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';

/** Only placed, structurally valid workspace resources belong in an output. */
export function workspaceFurnishingOutputInventory(candidate:{extensions?:Record<string,unknown>;rooms?:unknown}):WorkspaceFurnishingResource[]{
 if(candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE]===undefined)return [];
 try{return packageWorkspaceFurnishingManifest(candidate);}catch{throw new ApiError(422,'DRAFT_INVALID');}
}

/** A scene descriptor is not ownership: rebind it to the live registered
 * version and obtain bytes through the purpose-specific rights check. */
export async function workspaceFurnishingOutputBytes(c:PoolClient,s:Session,candidate:{extensions?:Record<string,unknown>;rooms?:unknown},service:WorkspaceFurnishingIntakes|undefined,resource:WorkspaceFurnishingResource,purpose:'display'|'export'){
 if(!workspaceFurnishingOutputInventory(candidate).some(entry=>isDeepStrictEqual(entry,resource)))throw new ApiError(422,'WORKSPACE_FURNISHING_OUTPUT_UNSUPPORTED');
 try{await assertWorkspaceFurnishingSnapshot(c,s,candidate,service);}catch(error){if(purpose==='export'&&error instanceof ApiError&&error.code==='DISPLAY_PERMISSION_REQUIRED')throw new ApiError(403,'RIGHTS_DENIED');throw error;}
 if(!service)throw new ApiError(422,'WORKSPACE_FURNISHING_UNAVAILABLE');
 return service.model(c,s,resource.furnishingId,resource.furnishingVersion,purpose);
}
