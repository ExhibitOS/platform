// SPDX-License-Identifier: AGPL-3.0-or-later
import {SURFACE_TEXTURE_PACKS,type SurfaceTexturePackId} from '@exhibitos/studio-contract';
import type {PrivateSeed} from './model';

/** The manifest only advertises availability. The renderer verifies every map's bytes. */
export function availableSurfacePacks(value:unknown,seed:Pick<PrivateSeed,'source'|'indexSha256'>):SurfaceTexturePackId[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return [];
 const m=value as Record<string,unknown>;
 if(m.format!=='exhibitos-static-publication-v1'||m.publicationId!==seed.source.publication.id||m.revisionSha256!==seed.source.publication.revisionSha256||m.indexSha256!==seed.indexSha256||!Array.isArray(m.files)||m.files.length>20000)return [];
 const files=new Map<string,unknown>();
 for(const entry of m.files){if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.path!=='string'||files.has(entry.path))return [];files.set(entry.path,entry);}
 return SURFACE_TEXTURE_PACKS.filter(pack=>[...Object.values(pack.maps),pack.notice].every(file=>{const entry=files.get(file.path) as {bytes?:unknown;sha256?:unknown}|undefined;return entry?.bytes===file.bytes&&entry.sha256===file.sha256;})).map(pack=>pack.id as SurfaceTexturePackId);
}

export async function loadAvailableSurfacePacks(seed:PrivateSeed,signal:AbortSignal):Promise<SurfaceTexturePackId[]>{
 try{
  await seed.source.local!.check();
  const response=await fetch('/static-export-manifest.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok||!response.body)return [];
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>4*1024*1024){await reader.cancel();return [];}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return availableSurfacePacks(JSON.parse(new TextDecoder().decode(bytes)),seed);
 }catch{return [];}
}
