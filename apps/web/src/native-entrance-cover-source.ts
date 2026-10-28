// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical,MAX_COVER_BYTES,spaceStillFor,validateSpaceStillInventory} from '@exhibitos/studio-contract';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {EntranceCoverSource} from './EntranceCover';
import {approvedPlacementArtwork} from './native-placement-source';
import {approvedDisplayCopyResponse} from './approved-display-response';
async function bounded(response:Response,limit:number,signal:AbortSignal){
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('ENTRANCE_PREVIEW_IMAGE_LIMIT');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
/** Reuses the existing approved CMS display derivative; never requests original/download bytes.
 * The shared cover still owns PNG validation, decoding, generation and object-URL lifetime. */
export function nativeEntranceCoverSource(frame:NativeViewportFrame,check:(signal:AbortSignal)=>Promise<void>,fetcher:typeof fetch=fetch):EntranceCoverSource {
 return {image:async(assetId,signal)=>{
  signal.throwIfAborted();await check(signal);
  const still=spaceStillFor(frame.draft.candidate),options={credentials:'same-origin' as const,cache:'no-store' as const,redirect:'error' as const,signal};
  if(still?.id.toLowerCase()===assetId.toLowerCase()){
   const path=`/api/v1/tenants/${frame.tenantId}/studio/exhibitions/${frame.draft.exhibitionId}/cover-images/${still.id}`;
   const metadata=async()=>{
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(await fetcher(path,options),1048576,signal))) as {id:string;revision:number;state:string;revoked:boolean;asset:unknown};
    if(result.id!==still.id||result.revision!==1||result.state!=='approved'||result.revoked!==false||freezeCanonical(result.asset)!==freezeCanonical(still))throw Error('ENTRANCE_PREVIEW_IMAGE_STALE');
   };
   await metadata();const response=await fetcher(`${path}/preview?expectedSha256=${still.sha256}`,options);
   if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png'||!approvedDisplayCopyResponse(response.headers)||response.headers.get('x-exhibitos-cover-sha256')!==still.sha256){await response.body?.cancel().catch(()=>{});throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');}
   const bytes=await bounded(response,MAX_COVER_BYTES,signal);await metadata();await check(signal);signal.throwIfAborted();
   if(!validateSpaceStillInventory(frame.draft.candidate,{publicationTime:new Date().toISOString()}).valid)throw Error('ENTRANCE_PREVIEW_IMAGE_RIGHTS');
   return bytes.buffer;
  }
  const artwork=frame.draft.candidate.artworks.find(a=>a.primaryAssetId.toLowerCase()===assetId.toLowerCase()),binding=artwork?.extensions?.['org.exhibitos.studio/cms'];
  if(!artwork||artwork.artworkType!=='image'||!binding||binding.tenantId!==frame.tenantId||typeof binding.artworkId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(binding.artworkId)||!Number.isSafeInteger(binding.revision)||Number(binding.revision)<1||Number(binding.revision)>2147483647)throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');
  const base=`/api/v1/tenants/${frame.tenantId}`,preview=`${base}/cms/artworks/${binding.artworkId}/preview`;
  const metadata=async()=>{
   const approved=await approvedPlacementArtwork({tenantId:frame.tenantId,artworkId:binding.artworkId as string,expectedRevision:Number(binding.revision)},signal,fetcher);
   if(freezeCanonical(approved)!==freezeCanonical(artwork))throw Error('ENTRANCE_PREVIEW_IMAGE_STALE');
  };
  await metadata();const response=await fetcher(`${preview}?expectedRevision=${binding.revision}`,options);
  if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='image/png'||!approvedDisplayCopyResponse(response.headers)||response.headers.get('x-exhibitos-artwork-revision')!==String(binding.revision)){await response.body?.cancel().catch(()=>{});throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');}
  const bytes=await bounded(response,MAX_COVER_BYTES,signal);
  // Rights/revision may change during the download. No stale bytes reach the shared cover.
  await metadata();await check(signal);signal.throwIfAborted();
  return bytes.buffer;
 }};
}
