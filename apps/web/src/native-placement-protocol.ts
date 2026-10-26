// SPDX-License-Identifier: AGPL-3.0-or-later
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
export const NATIVE_PLACEMENT_CAPABILITY='place-artwork-v1' as const;
export type PlacementTargetKind='wall'|'floor';
export interface PlacementBegin extends CatalogBinding {
 phase:'begin';artworkId:string;expectedRevision:number;placementId:string;roomId:string;targetKind:PlacementTargetKind;
}
export interface PlacementCommit extends CatalogBinding {phase:'commit';placementRequestId:string;targetToken:string}
export interface PlacementCancel extends CatalogBinding {phase:'cancel';placementRequestId:string}
export type PlacementRequest=PlacementBegin|PlacementCommit|PlacementCancel;
export interface PlacementTarget {
 placementRequestId:string;targetToken:string|null;surfaceId:string|null;offset:[number,number]|null;valid:boolean;reason:string;
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function checkedPlacementRequest(value:unknown,frame:NativeViewportFrame|undefined):PlacementRequest {
 if(!frame||frame.disabled||frame.presentation==='plan'||!value||typeof value!=='object'||Array.isArray(value))throw Error('PLACEMENT_REQUEST_INVALID');
 const v=value as PlacementRequest;
 const common=['version','epoch','sequence','tenantId','principalId','requestId','phase'];
 const fields=v.phase==='begin'?['artworkId','expectedRevision','placementId','roomId','targetKind']:v.phase==='commit'?['placementRequestId','targetToken']:v.phase==='cancel'?['placementRequestId']:null;
 if(!fields||Object.keys(v).sort().join(',')!==[...common,...fields].sort().join(',')||v.version!==1||!uuid.test(v.requestId)||v.epoch!==frame.epoch||v.sequence!==frame.sequence||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId)throw Error('PLACEMENT_REQUEST_STALE');
 if(v.phase==='begin') {
  if(!uuid.test(v.artworkId)||!uuid.test(v.placementId)||!uuid.test(v.roomId)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>2147483647||!['wall','floor'].includes(v.targetKind)||!frame.draft.candidate.rooms.some(r=>same(r.id,v.roomId))||frame.draft.candidate.placements.some(p=>same(p.id,v.placementId)))throw Error('PLACEMENT_SOURCE_INVALID');
 }else if(!uuid.test(v.placementRequestId)||(v.phase==='commit'&&!uuid.test(v.targetToken)))throw Error('PLACEMENT_REQUEST_INVALID');
 return structuredClone(v);
}
/** Sequence-only native UI redraws may rebind, but never a different draft or view. */
export function placementFrameCompatible(previous:NativeViewportFrame,next:NativeViewportFrame) {
 return !next.disabled&&next.presentation!=='plan'&&next.sequence>=previous.sequence&&next.epoch===previous.epoch&&next.tenantId===previous.tenantId&&next.principalId===previous.principalId&&next.draft===previous.draft&&next.presentation===previous.presentation&&next.mode===previous.mode&&next.view===previous.view&&next.cameraSequence===previous.cameraSequence&&next.transparent===previous.transparent&&next.selection?.kind===previous.selection?.kind&&next.selection?.id===previous.selection?.id;
}
