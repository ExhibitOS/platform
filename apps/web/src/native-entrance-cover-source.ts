// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical,MAX_COVER_BYTES} from '@exhibitos/studio-contract';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {EntranceCoverSource} from './EntranceCover';
import {approvedPlacementArtwork} from './native-placement-source';
/** Reuses the existing approved CMS display derivative; never requests original/download bytes.
 * The shared cover still owns PNG validation, decoding, generation and object-URL lifetime. */
export function nativeEntranceCoverSource(frame:NativeViewportFrame,check:(signal:AbortSignal)=>Promise<void>,fetcher:typeof fetch=fetch):EntranceCoverSource {
 return {image:async(assetId,signal)=>{
  signal.throwIfAborted();await check(signal);
  const artwork=frame.draft.candidate.artworks.find(a=>a.primaryAssetId.toLowerCase()===assetId.toLowerCase()),binding=artwork?.extensions?.['org.exhibitos.studio/cms'];
  if(!artwork||artwork.artworkType!=='image'||!binding||binding.tenantId!==frame.tenantId||typeof binding.artworkId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(binding.artworkId)||!Number.isSafeInteger(binding.revision)||Number(binding.revision)<1||Number(binding.revision)>2147483647)throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');
  const base=`/api/v1/tenants/${frame.tenantId}`,preview=`${base}/cms/artworks/${binding.artworkId}/preview`,options={credentials:'same-origin' as const,cache:'no-store' as const,redirect:'error' as const,signal};
  const metadata=async()=>{
   const approved=await approvedPlacementArtwork({tenantId:frame.tenantId,artworkId:binding.artworkId as string,expectedRevision:Number(binding.revision)},signal,fetcher);
   if(freezeCanonical(approved)!==freezeCanonical(artwork))throw Error('ENTRANCE_PREVIEW_IMAGE_STALE');
  };
  await metadata();const response=await fetcher(`${preview}?expectedRevision=${binding.revision}`,options);
  if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='image/png'||response.headers.get('x-exhibitos-watermarked')!=='true'||response.headers.get('x-exhibitos-artwork-revision')!==String(binding.revision)){await response.body?.cancel().catch(()=>{});throw Error('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_COVER_BYTES)throw Error('ENTRANCE_PREVIEW_IMAGE_LIMIT');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  // Rights/revision may change during the download. No stale bytes reach the shared cover.
  await metadata();await check(signal);signal.throwIfAborted();
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
 }};
}
