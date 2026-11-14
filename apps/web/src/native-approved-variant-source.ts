// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {freezeCanonical,lodVariantsFor,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import type {Session} from './cms-client';
import {approvedPlacementArtwork} from './native-placement-source';
import {qualifiedNativeModelPair} from './native-ordinary-scene-variants';

/** Same authenticated display authority as the primary preview, bound to the
 * current approved declared variant. A display copy need not hash as its source. */
export async function readNativeApprovedVariant(art:Artwork,asset:Artwork['assets'][number],session:Session,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ArrayBuffer>{
 const binding=art.extensions?.['org.exhibitos.studio/cms'] as {tenantId?:string;artworkId?:string;revision?:number}|undefined;
 if(binding?.tenantId!==session.tenantId||typeof binding.artworkId!=='string'||!Number.isSafeInteger(binding.revision)||binding.revision!<1||asset.id===art.primaryAssetId||asset.mime!=='model/gltf-binary'||!qualifiedNativeModelPair(art)||!lodVariantsFor(art).some(v=>v.detail==='coarse'&&v.assetId.toLowerCase()===asset.id.toLowerCase()))throw Error('DERIVATIVE_UNAVAILABLE');
 const current=await approvedPlacementArtwork({tenantId:session.tenantId,artworkId:binding.artworkId,expectedRevision:binding.revision!},signal,fetcher);
 if(current.revisionId!==art.revisionId||current.primaryAssetId!==art.primaryAssetId||freezeCanonical(current.assets)!==freezeCanonical(art.assets)||freezeCanonical(current.rights)!==freezeCanonical(art.rights)||freezeCanonical(current.extensions?.[LOD_NAMESPACE])!==freezeCanonical(art.extensions?.[LOD_NAMESPACE])||!qualifiedNativeModelPair(current)||!current.assets.some(a=>a.id===asset.id&&freezeCanonical(a)===freezeCanonical(asset)))throw Error('DERIVATIVE_REVISION_CHANGED');
 const selectedId=asset.id.toLowerCase();
 const url=`/api/v1/tenants/${session.tenantId}/cms/artworks/${binding.artworkId}/preview?expectedRevision=${binding.revision}&assetId=${selectedId}`;
 const response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',signal});
 if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='model/gltf-binary'||response.headers.get('x-exhibitos-display-copy')!=='true'||response.headers.get('x-exhibitos-artwork-revision')!==String(binding.revision)||response.headers.get('x-exhibitos-artwork-asset-id')!==selectedId){await response.body?.cancel().catch(()=>{});throw Error('DERIVATIVE_UNAVAILABLE');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 const cancelled=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancelled,{once:true});
 try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>33554432)throw Error('DERIVATIVE_UNAVAILABLE');parts.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',cancelled);reader.releaseLock();}
 signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes.buffer;
}
