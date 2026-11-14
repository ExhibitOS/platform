// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {furnishingsFor,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';

export interface SceneSnapshotFurnishings {
 catalog:{kind:'bench'|'light'|'pedestal'|'opening';id:string;assetId:string;modelSha256:string;status:'ready'|'fallback'}[];
 workspace:{placementId:string;furnishingId:string;furnishingVersion:number;modelSha256:string;status:'ready'|'pending'|'failed'}[];
}
/** Include every declared visual, even when its source/budget was unavailable.
 * Identity comes from the admitted document; readiness comes from mounted objects. */
export function snapshotFurnishings(document:Exhibition,catalogReady:(kind:string,id:string)=>boolean,workspaceStatus:(id:string)=>'ready'|'pending'|'failed'):SceneSnapshotFurnishings {
 const catalog=furnishingsFor(document),workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;
 return {
  catalog:(catalog?.bindings??[]).map(binding=>{
   const asset=catalog!.assets.find(a=>a.id.toLowerCase()===binding.assetId.toLowerCase());if(!asset)throw Error('SCENE_SNAPSHOT_UNAVAILABLE');
   return {kind:binding.hostKind,id:binding.hostId,assetId:asset.id,modelSha256:asset.sha256,status:catalogReady(binding.hostKind,binding.hostId)?'ready':'fallback'};
  }),
  workspace:[...(workspace?.placements??[]).map(p=>({placementId:p.id,...p})),...(workspace?.frameAttachments??[]),...(workspace?.openingAttachments??[]).map(p=>({placementId:p.openingId,...p}))].map(p=>{
   const descriptor=workspace!.furnishings.find(d=>d.id===p.furnishingId&&d.version===p.furnishingVersion);if(!descriptor)throw Error('SCENE_SNAPSHOT_UNAVAILABLE');
   return {placementId:p.placementId,furnishingId:descriptor.id,furnishingVersion:descriptor.version,modelSha256:descriptor.model.sha256,status:workspaceStatus(p.placementId)};
  }),
 };
}
