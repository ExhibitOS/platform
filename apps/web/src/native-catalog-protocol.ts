// SPDX-License-Identifier: AGPL-3.0-or-later
import type {NativeViewportFrame} from './native-viewport-protocol';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const NATIVE_CATALOG_CAPABILITIES=['artwork-thumbnail-v1','find-selection-v1'] as const;
export interface CatalogBinding {version:1;epoch:string;sequence:number;tenantId:string;principalId:string;requestId:string}
export interface ThumbnailRequest extends CatalogBinding {artworkId:string;expectedRevision:number}
export interface FindRequest extends CatalogBinding {selection:{kind:'placement';id:string}}
export function checkedCatalogRequest(value:unknown,frame:NativeViewportFrame|undefined,kind:'thumbnail'):ThumbnailRequest;
export function checkedCatalogRequest(value:unknown,frame:NativeViewportFrame|undefined,kind:'find'):FindRequest;
export function checkedCatalogRequest(value:unknown,frame:NativeViewportFrame|undefined,kind:'thumbnail'|'find'){
 if(!frame||frame.disabled||!value||typeof value!=='object'||Array.isArray(value))throw Error('CATALOG_REQUEST_INVALID');
 const v=value as ThumbnailRequest&FindRequest;
 const keys=kind==='thumbnail'?'artworkId,epoch,expectedRevision,principalId,requestId,sequence,tenantId,version':'epoch,principalId,requestId,selection,sequence,tenantId,version';
 if(Object.keys(v).sort().join(',')!==keys||v.version!==1||!uuid.test(v.requestId)||v.epoch!==frame.epoch||v.sequence!==frame.sequence||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId)throw Error('CATALOG_REQUEST_STALE');
 if(kind==='thumbnail'){
  if(!uuid.test(v.artworkId)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>2147483647)throw Error('CATALOG_REQUEST_INVALID');
 }else if(frame.presentation==='plan'||!v.selection||Object.keys(v.selection).sort().join(',')!=='id,kind'||v.selection.kind!=='placement'||!uuid.test(v.selection.id)||frame.selection?.kind!=='placement'||v.selection.id!==frame.selection.id||!frame.draft.candidate.placements.some(p=>p.id===v.selection.id))throw Error('CATALOG_SELECTION_INVALID');
 return structuredClone(v);
}
export function catalogBinding(v:CatalogBinding){const {version,epoch,sequence,tenantId,principalId,requestId}=v;return {version,epoch,sequence,tenantId,principalId,requestId};}
/** The queue retains the running task until its resources really finish, including cancellation. */
export class SerialThumbnailQueue {
 private tail:Promise<unknown>=Promise.resolve();private count=0;
 run<T>(task:()=>Promise<T>){
  if(this.count>=4)return Promise.reject(new Error('THUMBNAIL_BUSY'));
  this.count++;const result=this.tail.then(task);this.tail=result.catch(()=>{}).finally(()=>{this.count--;});return result;
 }
}
