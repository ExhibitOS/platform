// SPDX-License-Identifier: AGPL-3.0-or-later
import type {EntranceThemeId} from '@exhibitos/studio-contract';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {catalogBinding,type CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';

/** Advertise only after the shared DOM host and snapshot readiness are qualified. */
export const NATIVE_ENTRANCE_PREVIEW_CAPABILITY='entrance-preview-v1';
export interface EntrancePreviewRequest extends CatalogBinding {
 type:'show'|'replay'|'walk'|'thumbnail'|'close';
 device:'desktop'|'mobile';scenario:'normal'|'slow'|'image-failed';
 reducedMotion:boolean;theme:EntranceThemeId|null;locale:string|null;
}
export interface EntrancePreviewGeometry {
 renderGeneration:number;imageStatus:'absent'|'ready'|'failed';
 viewport:{width:number;height:number};snapshotRect:{x:number;y:number;width:number;height:number};
}
export interface EntrancePreviewReply extends CatalogBinding,EntrancePreviewGeometry {
 baseDraft:NativeViewportFrame['draft'];
 theme:EntrancePreviewRequest['theme'];locale:string|null;
 device:EntrancePreviewRequest['device'];scenario:EntrancePreviewRequest['scenario'];reducedMotion:boolean;
 status:'ready';mode:'cover'|'walk'|'editor';
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const themes=['catalogue','poster','artwork','invitation','threshold'];
/** Read-only previews remain available when native editing is disabled. */
export function checkedEntrancePreviewRequest(value:unknown,frame:NativeViewportFrame|undefined):EntrancePreviewRequest {
 if(!frame||!value||typeof value!=='object'||Array.isArray(value))throw Error('ENTRANCE_PREVIEW_INVALID');
 const v=value as EntrancePreviewRequest;
 if(Object.keys(v).sort().join(',')!=='device,epoch,locale,principalId,reducedMotion,requestId,scenario,sequence,tenantId,theme,type,version'||
 v.version!==1||typeof v.requestId!=='string'||!uuid.test(v.requestId)||
 !['show','replay','walk','thumbnail','close'].includes(v.type)||!['desktop','mobile'].includes(v.device)||
 !['normal','slow','image-failed'].includes(v.scenario)||typeof v.reducedMotion!=='boolean'||
 (v.theme!==null&&!themes.includes(v.theme))||
 (v.locale!==null&&(typeof v.locale!=='string'||v.locale.length>35||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(v.locale))))throw Error('ENTRANCE_PREVIEW_INVALID');
 if(v.epoch!==frame.epoch||v.sequence!==frame.sequence||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId)throw Error('ENTRANCE_PREVIEW_STALE');
 return structuredClone(v);
}
/** Geometry is measured from the real shared host in CSS pixels, never a guessed card. */
export function entrancePreviewReply(request:EntrancePreviewRequest,frame:NativeViewportFrame,geometry:EntrancePreviewGeometry):EntrancePreviewReply {
 checkedEntrancePreviewRequest(request,frame);
 const {viewport:v,snapshotRect:r}=geometry;
 if(!Number.isSafeInteger(geometry.renderGeneration)||geometry.renderGeneration<1||!['absent','ready','failed'].includes(geometry.imageStatus)||
 ![v.width,v.height,r.x,r.y,r.width,r.height].every(Number.isFinite)||v.width<=0||v.height<=0||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>v.width||r.y+r.height>v.height)throw Error('ENTRANCE_PREVIEW_BOUNDS');
 return {...catalogBinding(request),baseDraft:structuredClone(frame.draft),theme:request.theme,locale:request.locale,
 device:request.device,scenario:request.scenario,reducedMotion:request.reducedMotion,status:'ready',
 mode:request.type==='close'?'editor':request.type==='walk'?'walk':'cover',renderGeneration:geometry.renderGeneration,imageStatus:geometry.imageStatus,
 viewport:{width:v.width,height:v.height},snapshotRect:{x:r.x,y:r.y,width:r.width,height:r.height}};
}
/** State checks compare the original request and full draft without consuming a replay ID. */
export function entrancePreviewStateMatches(original:EntrancePreviewRequest,request:EntrancePreviewRequest,frame:NativeViewportFrame,reply:EntrancePreviewReply,geometry:EntrancePreviewGeometry){
 checkedEntrancePreviewRequest(request,frame);
 return freezeCanonical(original)===freezeCanonical(request)&&freezeCanonical(reply)===freezeCanonical(entrancePreviewReply(request,frame,geometry));
}
