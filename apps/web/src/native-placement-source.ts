// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {validateArtwork} from './drafts/artwork-validation.mjs';
import type {PlacementBegin} from './native-placement-protocol';
/** Server-owned approved snapshot: no caller-supplied artwork, asset, or URL. */
export async function approvedPlacementArtwork(request:PlacementBegin,signal:AbortSignal):Promise<Artwork> {
 const response=await fetch(`/api/v1/tenants/${request.tenantId}/studio/artworks/${request.artworkId}`,{credentials:'same-origin',redirect:'error',cache:'no-store',signal});
 if(!response.ok||!response.body)throw Error('PLACEMENT_APPROVAL_UNAVAILABLE');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>1100000)throw Error('PLACEMENT_SNAPSHOT_LIMIT');parts.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);let cursor=0;for(const part of parts){bytes.set(part,cursor);cursor+=part.length;}
 const result=JSON.parse(new TextDecoder().decode(bytes)) as {artwork:Artwork};const artwork=result.artwork;
 const binding=artwork?.extensions?.['org.exhibitos.studio/cms'] as {tenantId?:string;artworkId?:string;revision?:number}|undefined;
 if(!validateArtwork(artwork).valid||artwork.id!==request.artworkId||binding?.tenantId!==request.tenantId||binding.artworkId!==request.artworkId||binding.revision!==request.expectedRevision||artwork.rights.permissions.display!==true)throw Error('PLACEMENT_APPROVAL_CHANGED');
 signal.throwIfAborted();return structuredClone(artwork);
}
