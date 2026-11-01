// SPDX-License-Identifier: AGPL-3.0-or-later
import {checkArtworkThumbnailPng} from '@exhibitos/studio-contract';
import {produceArtworkThumbnail} from './native-artwork-thumbnail';
import type {ThumbnailRequest} from './native-catalog-protocol';
import type {Session} from './cms-client';

type Request={version:1;origin:string;requestId:string;epoch:string;tenantId:string;principalId:string;artworkId:string;expectedRevision:number};
type Image={pngBase64:string;width:number;height:number};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Candidate generation only. Native host owns origin/navigation, request
 * scope and lifetime; server approval, rights and asset receipt remain final. */
export function createNativeThumbnailHost(input:{location:()=>Pick<Location,'origin'|'pathname'|'search'|'hash'>;fetcher:typeof fetch;produce:(request:ThumbnailRequest,signal:AbortSignal)=>Promise<Image>}){
 let disposed=false,busy=false,active:AbortController|undefined,drained:Promise<void>=Promise.resolve(),finishDrain:(()=>void)|undefined;const seen=new Set<string>();
 const location=(origin:string)=>{const v=input.location();if(v.origin!==origin||v.pathname!=='/native-thumbnail.html'||v.search||v.hash)throw Error('THUMBNAIL_ORIGIN');};
 const session=async(request:Request,signal:AbortSignal)=>{
  const response=await input.fetcher('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});if(!response.ok)throw Error('THUMBNAIL_SESSION');
  const s=await response.json() as Session;if(s.tenantId!==request.tenantId||s.userId!==request.principalId||!['admin','artist','curator'].includes(s.role)||typeof s.csrfToken!=='string'||!s.csrfToken||typeof s.expiresAt!=='string'||!s.expiresAt)throw Error('THUMBNAIL_SESSION');return s;
 };
 const produce=async(value:unknown)=>{
  if(disposed)throw Error('THUMBNAIL_DISPOSED');if(busy)throw Error('THUMBNAIL_BUSY');
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('THUMBNAIL_REQUEST');const v=value as Request;
  if(Object.keys(v).sort().join(',')!=='artworkId,epoch,expectedRevision,origin,principalId,requestId,tenantId,version'||v.version!==1||typeof v.origin!=='string'||![v.requestId,v.epoch,v.tenantId,v.principalId,v.artworkId].every(x=>typeof x==='string'&&uuid.test(x))||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>2147483647)throw Error('THUMBNAIL_REQUEST');
  const request=structuredClone(v);location(request.origin);const requestKey=request.requestId.toLowerCase();if(seen.size>=128||seen.has(requestKey))throw Error('THUMBNAIL_REQUEST');seen.add(requestKey);busy=true;drained=new Promise(resolve=>{finishDrain=resolve;});const abort=new AbortController();active=abort;
  try{
   const before=await session(request,abort.signal);location(request.origin);
   const thumbnailRequest:ThumbnailRequest={version:1,epoch:request.epoch,sequence:1,tenantId:request.tenantId,principalId:request.principalId,requestId:request.requestId,artworkId:request.artworkId,expectedRevision:request.expectedRevision};
   const image=await input.produce(thumbnailRequest,abort.signal);abort.signal.throwIfAborted();location(request.origin);
   const after=await session(request,abort.signal);if(before.tenantId!==after.tenantId||before.userId!==after.userId||before.role!==after.role||before.csrfToken!==after.csrfToken||before.expiresAt!==after.expiresAt)throw Error('THUMBNAIL_SESSION');
   location(request.origin);abort.signal.throwIfAborted();
   if(image.width<1||image.height<1||image.width>256||image.height>256||!Number.isInteger(image.width)||!Number.isInteger(image.height)||typeof image.pngBase64!=='string'||image.pngBase64.length>699052)throw Error('THUMBNAIL_RESULT');
   let raw:string;try{raw=atob(image.pngBase64);}catch{throw Error('THUMBNAIL_RESULT');}const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(btoa(raw)!==image.pngBase64||!checkArtworkThumbnailPng(bytes.buffer)||new DataView(bytes.buffer).getUint32(16)!==image.width||new DataView(bytes.buffer).getUint32(20)!==image.height)throw Error('THUMBNAIL_RESULT');
   return {...request,...image};
  }finally{active=undefined;busy=false;finishDrain?.();finishDrain=undefined;}
 };
 return Object.freeze({produce,async dispose(){disposed=true;active?.abort();await drained;}});
}
export function nativeThumbnailHost(){return createNativeThumbnailHost({location:()=>window.location,fetcher:fetch,produce:produceArtworkThumbnail});}
