// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE,frameImageContactFit,validateWorkspaceFurnishings,type FrameImageFit,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';

export const NATIVE_FRAME_IMAGE_FIT_PROPOSAL_PROFILE='saved-head-frame-image-fit-v1';
export type NativeFrameImageFitCommand={type:'reconcile-frame-image-fit';placementId:string};

/** Derive the selected row only. The caller supplies approved-primary inspection,
 * authenticated saved-head fencing and ordinary save; no descriptor is replaced. */
export function nativeFrameImageFitProposal<T extends Exhibition>(candidate:T,command:NativeFrameImageFitCommand,imageFit:FrameImageFit){
 const value=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(!value||![7,9,10].includes(value.version)||!validateWorkspaceFurnishings(candidate).valid)throw Error('FRAME_IMAGE_FIT_INVALID');
 const rows=value.frameAttachments?.filter(row=>row.placementId===command.placementId)??[],row=rows[0];
 if(rows.length!==1||!row)throw Error('FRAME_IMAGE_FIT_STALE');
 if(row.imageFit){
  if(!isDeepStrictEqual(row.imageFit,imageFit))throw Error('FRAME_IMAGE_FIT_STALE');
  return {candidate:structuredClone(candidate),placementId:row.placementId};
 }
 const next=structuredClone(candidate),workspace=next.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 workspace.version=10;const selected=workspace.frameAttachments!.find(item=>item.placementId===row.placementId)!;selected.imageFit=structuredClone(imageFit);
 const art=next.artworks.find(item=>item.revisionId===row.artworkRevisionId),descriptor=workspace.furnishings.find(item=>item.id===row.furnishingId),geometry=workspaceFitGeometry(descriptor);
 if(!art||!geometry||!['straight-ring-v1','straight-miter-ring-v1'].includes(geometry.profile)||!frameImageContactFit(next,selected,art,geometry as import('@exhibitos/spec/workspace-fit-models').MeasuredFrameFit)||!validateWorkspaceFurnishings(next).valid)throw Error('FRAME_IMAGE_FIT_UNSUPPORTED');
 return {candidate:next,placementId:row.placementId};
}
