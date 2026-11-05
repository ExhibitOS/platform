// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_MATERIAL_NAMESPACE,validateWorkspaceMaterialBindings,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

/** A portable-looking descriptor is not proof of workspace ownership. */
export async function assertWorkspaceMaterialSnapshot(c:PoolClient,s:Session,candidate:{extensions?:Record<string,unknown>;surfaces?:unknown},service?:WorkspaceMaterialIntakes){
 const extensions=candidate.extensions;if(!extensions||!Object.hasOwn(extensions,WORKSPACE_MATERIAL_NAMESPACE))return;
 if(!service)throw new ApiError(422,'WORKSPACE_MATERIAL_UNAVAILABLE');
 const value=extensions[WORKSPACE_MATERIAL_NAMESPACE];
 if(!validateWorkspaceMaterialBindings(value,candidate.surfaces).valid)throw new ApiError(422,'DRAFT_INVALID');
 for(const material of (value as WorkspaceMaterialBindings).materials){
  const registered=await service.readVersion(c,s,material.id,material.version);
  if(!isDeepStrictEqual(registered,material))throw new ApiError(409,'MATERIAL_VERSION_MISMATCH');
 }
 // Recheck all grants after the last owner-scoped database read.
 for(const material of (value as WorkspaceMaterialBindings).materials)if(!allowedRights(material.rights,'display'))throw new ApiError(403,'DISPLAY_PERMISSION_REQUIRED');
}
