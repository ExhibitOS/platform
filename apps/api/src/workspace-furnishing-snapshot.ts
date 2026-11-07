// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
/** A scene descriptor is never workspace ownership or a live rights grant. */
export async function assertWorkspaceFurnishingSnapshot(c:PoolClient,s:Session,candidate:{extensions?:Record<string,unknown>},service?:WorkspaceFurnishingIntakes){
 const extensions=candidate.extensions;if(!extensions||!Object.hasOwn(extensions,WORKSPACE_FURNISHING_NAMESPACE))return;
 if(!service)throw new ApiError(422,'WORKSPACE_FURNISHING_UNAVAILABLE');const checked=validateWorkspaceFurnishings(candidate);if(!checked.valid)throw new ApiError(422,checked.errors[0]?.code??'DRAFT_INVALID');
 if((extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).version===2&&!service.supportsStool())throw new ApiError(422,'WORKSPACE_FURNISHING_UNAVAILABLE');
 if((extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).version===3&&!service.supportsRoomVisual())throw new ApiError(422,'WORKSPACE_FURNISHING_UNAVAILABLE');
 if((extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).version===4&&!service.supportsArtworkFrame())throw new ApiError(422,'WORKSPACE_FURNISHING_UNAVAILABLE');
 for(const furnishing of (extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).furnishings){const registered=await service.readVersion(c,s,furnishing.id,furnishing.version);if(!isDeepStrictEqual(registered,furnishing))throw new ApiError(409,'FURNISHING_VERSION_MISMATCH');}
 for(const furnishing of (extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).furnishings)if(!allowedRights(furnishing.rights,'display'))throw new ApiError(403,'DISPLAY_PERMISSION_REQUIRED');
 // The immutable frame is attached to a work, so every save/preflight must
 // recheck the actual model bytes, not just the persisted descriptor.
 const checkedFrames=new Set<string>();for(const a of (extensions[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings).frameAttachments??[]){if(checkedFrames.has(a.furnishingId))continue;await service.checkDisplay(c,s,a.furnishingId,a.furnishingVersion);checkedFrames.add(a.furnishingId);}
}
