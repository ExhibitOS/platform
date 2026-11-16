// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {validateOexManifest,type Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE,packageWorkspaceFurnishingManifest} from '@exhibitos/spec/workspace-furnishing';
import {validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';

export const CURRENT_WORKSPACE_RAIL_OEX_FORMAT='1.0.0-draft.23' as const;

/** Restrict the selected reader to the resource kinds it can actually preserve. */
export function currentWorkspaceRailManifest(input:unknown):Record<string,unknown>|undefined {
 if(!input||typeof input!=='object'||Array.isArray(input))return;
 const value=input as Record<string,unknown>,rows=value.workspaceFurnishingResources;
 if(value.formatVersion!==CURRENT_WORKSPACE_RAIL_OEX_FORMAT||value.archiveProfile!=='bounded-file-v1'||
    !Array.isArray(value.assets)||value.assets.length!==0||!Array.isArray(rows)||rows.length!==1||rows[0]?.furnishingVersion!==1||
    ['floorResources','furnishingNotices','materialResources','footstepResources','workspaceMaterialResources'].some(key=>Object.hasOwn(value,key))||
    !validateOexManifest(value).valid)return;
 return value;
}

/** The worker passes a Spec-validated scene; the receiver still checks owner, rights and exact fit on the model bytes. */
export function bindCurrentWorkspaceRailResource(input:unknown,scene:Exhibition){
 const manifest=currentWorkspaceRailManifest(input);
 if(!manifest||!validateWorkspaceFurnishings(scene).valid)throw Error('OEX_CURRENT_WORKSPACE_RAIL');
 const extension=scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(extension?.version!==11||extension.furnishings.length!==1||extension.placements.length!==1||
    extension.ceilingAttachments?.length!==1||extension.frameAttachments?.length||extension.openingAttachments?.length||
    extension.furnishings[0]?.kind!=='ceiling-rail')throw Error('OEX_CURRENT_WORKSPACE_RAIL');
 const resources=packageWorkspaceFurnishingManifest(scene);
 if(!isDeepStrictEqual(resources,manifest.workspaceFurnishingResources))throw Error('OEX_CURRENT_WORKSPACE_RAIL');
 return {descriptor:extension.furnishings[0],resource:resources[0]!};
}
