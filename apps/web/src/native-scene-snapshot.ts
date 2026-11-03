// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical,presentationFor,watermarkFor} from '@exhibitos/studio-contract';
import {catalogBinding,type CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {approvedPlacementArtwork} from './native-placement-source';
import {validateArtwork} from './drafts/artwork-validation.mjs';
import type {SceneSnapshotImage,SceneSnapshotInput} from './scene-snapshot';
import {checkedInspectionCamera} from './scene-snapshot-camera';
export const NATIVE_SCENE_SNAPSHOT_CAPABILITY='scene-snapshot-v1' as const;
export const NATIVE_SCENE_SNAPSHOT_INSPECTION_CAPABILITY='scene-snapshot-inspection-v1' as const;
export type SceneSnapshotRequest=CatalogBinding&{expectedETag:string}&SceneSnapshotInput;
export interface SavedSceneIdentity {exhibitionId:string;draftId:string;revision:number;etag:string}
export type SceneSnapshotReply=CatalogBinding&{expectedETag:string;saved:SavedSceneIdentity;candidateSha256:string}&SceneSnapshotImage;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function checkedSceneSnapshotRequest(value:unknown,frame:NativeViewportFrame|undefined):SceneSnapshotRequest {
 if(frame&&watermarkFor(frame.draft.candidate).mode==='overlay')throw Error('SCENE_SNAPSHOT_OVERLAY_UNSUPPORTED');
 if(!frame||frame.disabled||frame.transparent||frame.presentation==='plan'||!value||typeof value!=='object'||Array.isArray(value))throw Error('SCENE_SNAPSHOT_INVALID');
 const v=value as SceneSnapshotRequest;
 const keys='inspectionCamera' in v?'epoch,expectedETag,height,inspectionCamera,placementId,principalId,requestId,sequence,tenantId,version,width':'epoch,expectedETag,height,placementId,principalId,requestId,sequence,tenantId,version,viewpointId,width';
 if(Object.keys(v).sort().join(',')!==keys||v.version!==1||v.epoch!==frame.epoch||v.sequence!==frame.sequence||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId||!uuid(v.requestId)||!uuid(v.placementId)||v.width!==640||v.height!==360||typeof v.expectedETag!=='string'||!/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(v.expectedETag)||frame.baseETag!==undefined&&frame.baseETag!==v.expectedETag)throw Error('SCENE_SNAPSHOT_STALE');
 if('inspectionCamera' in v)checkedInspectionCamera(v.inspectionCamera,frame.draft.candidate,v.placementId);
 else {
  if(!uuid(v.viewpointId))throw Error('SCENE_SNAPSHOT_STALE');
  const placement=frame.draft.candidate.placements.find(p=>p.id===v.placementId),view=presentationFor(frame.draft.candidate).viewpoints.find(p=>p.id===v.viewpointId);
  if(!placement||!view||placement.roomId!==view.roomId)throw Error('SCENE_SNAPSHOT_TARGET_INVALID');
 }
 return structuredClone(v);
}
/** Fresh authenticated source reads bind the image to persisted content, not
 * an opaque ETag supplied by a caller or to a native edit counter. */
export async function checkedSavedScene(frame:NativeViewportFrame,request:SceneSnapshotRequest,signal:AbortSignal):Promise<SavedSceneIdentity>{
 const response=await fetch(`/api/v1/tenants/${frame.tenantId}/studio/exhibitions/${frame.draft.exhibitionId}`,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!response.ok||response.headers.get('etag')!==request.expectedETag||!response.body)throw Error('SCENE_SNAPSHOT_SAVED_CHANGED');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>1100000)throw Error('SCENE_SNAPSHOT_SAVED_LIMIT');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {exhibitionId:string;revision:number;etag:string;draft:NativeViewportFrame['draft']};signal.throwIfAborted();
 if(saved.draft?.exhibitionId!==frame.draft.exhibitionId||saved.draft?.id!==frame.draft.id||!Number.isSafeInteger(saved.revision)||saved.revision<1||saved.etag!==request.expectedETag||!saved.etag.startsWith(`"studio-r${saved.revision}-`)||freezeCanonical(saved.draft)!==freezeCanonical(frame.draft))throw Error('SCENE_SNAPSHOT_SAVED_CHANGED');
 const placed=new Set(frame.draft.candidate.placements.map(p=>p.artworkRevisionId));
 for(const art of frame.draft.candidate.artworks.filter(a=>placed.has(a.revisionId))){
  const binding=art.extensions?.['org.exhibitos.studio/cms'] as {tenantId?:string;artworkId?:string;revision?:number}|undefined;
  if(binding?.tenantId!==frame.tenantId||!uuid(binding.artworkId)||!Number.isSafeInteger(binding.revision)||binding.revision!<1)throw Error('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
  const permissionResponse=await fetch(`/api/v1/tenants/${frame.tenantId}/cms/artworks/${binding.artworkId}/display`,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!permissionResponse.ok)throw Error('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
  const permission=await permissionResponse.json() as {id:string;revision:number;export:boolean};
  if(permission.id!==binding.artworkId||permission.revision!==binding.revision||permission.export!==true)throw Error('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
  const current=await approvedPlacementArtwork({tenantId:frame.tenantId,artworkId:binding.artworkId,expectedRevision:binding.revision!},signal);
  if(!validateArtwork(current,{publicationTime:new Date().toISOString()}).valid||current.rights.permissions.export!==true||freezeCanonical(current.rights)!==freezeCanonical(art.rights)||current.primaryAssetId!==art.primaryAssetId||freezeCanonical(current.assets)!==freezeCanonical(art.assets))throw Error('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
 }
 return {exhibitionId:saved.draft.exhibitionId,draftId:saved.draft.id,revision:saved.revision,etag:saved.etag};
}
export async function snapshotCandidateHash(frame:NativeViewportFrame){const bytes=new TextEncoder().encode(freezeCanonical(frame.draft.candidate));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function sceneSnapshotBinding(request:SceneSnapshotRequest){return {...catalogBinding(request),expectedETag:request.expectedETag};}


export interface PendingSceneEdit {epoch:string;sequence:number;candidate:string}
/** A selection/camera-only frame is not an edit acknowledgment. It can clear a
 * pending edit only after the renderer proves that frame's poses are applied. */
export function snapshotEditSettled(pending:PendingSceneEdit,frame:NativeViewportFrame,verifiedRollback:boolean){
 return pending.epoch===frame.epoch&&frame.sequence>pending.sequence&&(pending.candidate===freezeCanonical(frame.draft.candidate)||verifiedRollback);
}
