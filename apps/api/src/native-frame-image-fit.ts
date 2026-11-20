// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE,frameImageContactFit,validateWorkspaceFurnishings,type FrameImageFit,type WorkspaceFrameAttachment,type WorkspaceFurnishingDescriptor,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';

export const NATIVE_FRAME_IMAGE_FIT_PROPOSAL_PROFILE='saved-head-frame-image-fit-v1';
export const NATIVE_MEASURED_FRAME_ATTACHMENT_PROPOSAL_PROFILE='saved-head-measured-frame-attachment-v1';
export type NativeMeasuredFrameAttachmentCommand={type:'attach-measured-frame';placementId:string;furnishingId:string;furnishingVersion:1};
export type NativeFrameImageFitCommand={type:'reconcile-frame-image-fit';placementId:string};

/** Derive the selected row only. The caller supplies approved-primary inspection,
 * authenticated saved-head fencing and ordinary save; no descriptor is replaced. */
export function nativeFrameImageFitProposal<T extends Exhibition>(candidate:T,command:NativeFrameImageFitCommand,imageFit:FrameImageFit){
 const value=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(!value||![7,9,10,11].includes(value.version)||!validateWorkspaceFurnishings(candidate).valid)throw Error('FRAME_IMAGE_FIT_INVALID');
 const rows=value.frameAttachments?.filter(row=>row.placementId===command.placementId)??[],row=rows[0];
 if(rows.length!==1||!row)throw Error('FRAME_IMAGE_FIT_STALE');
 if(row.imageFit){
  if(!isDeepStrictEqual(row.imageFit,imageFit))throw Error('FRAME_IMAGE_FIT_STALE');
  return {candidate:structuredClone(candidate),placementId:row.placementId};
 }
 const next=structuredClone(candidate),workspace=next.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 if(workspace.version!==11)workspace.version=10;const selected=workspace.frameAttachments!.find(item=>item.placementId===row.placementId)!;selected.imageFit=structuredClone(imageFit);
 const art=next.artworks.find(item=>item.revisionId===row.artworkRevisionId),descriptor=workspace.furnishings.find(item=>item.id===row.furnishingId),geometry=workspaceFitGeometry(descriptor);
 if(!art||!geometry||!['straight-ring-v1','straight-miter-ring-v1'].includes(geometry.profile)||!frameImageContactFit(next,selected,art,geometry as import('@exhibitos/spec/workspace-fit-models').MeasuredFrameFit)||!validateWorkspaceFurnishings(next).valid)throw Error('FRAME_IMAGE_FIT_UNSUPPORTED');
 return {candidate:next,placementId:row.placementId};
}

const workspaceFor=(candidate:Exhibition)=>candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;

function measuredFrame(descriptor:WorkspaceFurnishingDescriptor|undefined):boolean {
 const profile=workspaceFitGeometry(descriptor)?.profile;
 return profile==='straight-ring-v1'||profile==='straight-miter-ring-v1';
}

/** Reuse the frame contact rule after constructing the one authoritative
 * attachment from the saved painting and its verified catalogue entry. */
export function nativeMeasuredFrameAttachmentProposal<T extends Exhibition>(candidate:T,command:NativeMeasuredFrameAttachmentCommand,
 descriptor:WorkspaceFurnishingDescriptor,imageFit:FrameImageFit){
 if(!validateWorkspaceFurnishings(candidate).valid)throw Error('FRAME_IMAGE_FIT_INVALID');
 if(descriptor.id!==command.furnishingId||descriptor.version!==command.furnishingVersion||!measuredFrame(descriptor))
  throw Error('FRAME_ASSET_UNSUPPORTED');
 const placement=candidate.placements.find(row=>row.id===command.placementId);
 const artwork=placement&&candidate.artworks.find(row=>row.revisionId===placement.artworkRevisionId);
 if(!placement||artwork?.artworkType!=='image'||placement.assetId!==artwork.primaryAssetId)throw Error('FRAME_IMAGE_FIT_STALE');

 const next=structuredClone(candidate), existing=workspaceFor(next);
 const workspace:WorkspaceFurnishings={version:existing?.version===11?11:10,
  furnishings:existing?.furnishings??[],placements:existing?.placements??[],
  frameAttachments:existing?.frameAttachments??[],openingAttachments:existing?.openingAttachments??[],
  ...(existing?.version===11?{ceilingAttachments:existing.ceilingAttachments!}:{})};
 const registered=workspace.furnishings.find(item=>item.id===descriptor.id);
 if(registered&&!isDeepStrictEqual(registered,descriptor))throw Error('FRAME_IMAGE_FIT_STALE');
 if(!registered)workspace.furnishings.push(structuredClone(descriptor));

 const attachment:WorkspaceFrameAttachment={placementId:placement.id,artworkRevisionId:artwork.revisionId,assetId:artwork.primaryAssetId,
  furnishingId:descriptor.id,furnishingVersion:descriptor.version,modelSha256:descriptor.model.sha256};
 const attachments=workspace.frameAttachments!;
 const index=attachments.findIndex(row=>row.placementId===attachment.placementId), retained=attachments[index];
 if(retained){
  const {imageFit:priorFit,...oldBinding}=retained;
  if(priorFit&&isDeepStrictEqual(oldBinding,attachment)){
   if(!isDeepStrictEqual(priorFit,imageFit))throw Error('FRAME_IMAGE_FIT_STALE');
   return {candidate:next,placementId:placement.id};
  }
  attachments[index]=attachment;
  if(retained.furnishingId!==descriptor.id&&![...attachments,...workspace.placements].some(row=>row.furnishingId===retained.furnishingId)){
   workspace.furnishings=workspace.furnishings.filter(item=>item.id!==retained.furnishingId||item.kind!=='artwork-frame');
  }
 }else attachments.push(attachment);
 next.extensions={...next.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:workspace as unknown as NonNullable<Exhibition['extensions']>[string]};
 return nativeFrameImageFitProposal(next,{type:'reconcile-frame-image-fit',placementId:placement.id},imageFit);
}

/** Existing fitted or legacy rows reopen unchanged. New or replaced measured
 * models use the server-issued fit, even if the caller submits a draft directly. */
export function requiresMeasuredFrameAttachmentFit(before:Exhibition,after:Exhibition):boolean{
 const previous=workspaceFor(before),proposed=workspaceFor(after);
 return (proposed?.frameAttachments??[]).some(row=>{
  if(row.imageFit||!measuredFrame(proposed?.furnishings.find(item=>item.id===row.furnishingId)))return false;
  const old=previous?.frameAttachments?.find(item=>item.placementId===row.placementId);
  return !old||old.furnishingId!==row.furnishingId||old.furnishingVersion!==row.furnishingVersion||old.modelSha256!==row.modelSha256;
 });
}
