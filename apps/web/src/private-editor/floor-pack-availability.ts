// SPDX-License-Identifier: AGPL-3.0-or-later
import {FLOOR_TEXTURE_PACKS,floorTextureFiles,floorTextureNotice,type FloorPreset} from '@exhibitos/studio-contract';
import type {PrivateSeed} from './model';

const presets:Record<string,FloorPreset>={WoodFloor051:'wood',Marble006:'marble',Tiles074:'tile',Carpet004:'carpet'};
/** Manifest availability is advisory; the existing renderer verifies the map bytes. */
export async function availableFloorPacks(value:unknown,seed:Pick<PrivateSeed,'source'|'indexSha256'>):Promise<FloorPreset[]>{
 if(!value||typeof value!=='object'||Array.isArray(value))return [];
 const m=value as Record<string,unknown>;
 if(m.format!=='exhibitos-static-publication-v1'||m.publicationId!==seed.source.publication.id||m.revisionSha256!==seed.source.publication.revisionSha256||m.indexSha256!==seed.indexSha256||!Array.isArray(m.files)||m.files.length>20000)return [];
 const files=new Map<string,{bytes?:unknown;sha256?:unknown}>();
 for(const entry of m.files){if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.path!=='string'||files.has(entry.path))return [];files.set(entry.path,entry);}
 const packs=FLOOR_TEXTURE_PACKS.filter(p=>floorTextureFiles(p).every(f=>{const x=files.get(f.path);return x?.bytes===f.bytes&&x.sha256===f.sha256;}));
 if(!packs.length)return [];
 const notice=new TextEncoder().encode(packs.map(floorTextureNotice).join('\n'));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',notice)),b=>b.toString(16).padStart(2,'0')).join('');
 const entry=files.get('floor-texture-notices.txt');
 if(entry?.bytes!==notice.length||entry.sha256!==digest)return [];
 return packs.map(p=>presets[p.id]!).filter(Boolean);
}
export async function loadAvailableFloorPacks(seed:PrivateSeed,signal:AbortSignal):Promise<FloorPreset[]>{
 try{
  await seed.source.local!.check();const response=await fetch('/static-export-manifest.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok||!response.body)return [];const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4*1024*1024){await reader.cancel();return [];}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return await availableFloorPacks(JSON.parse(new TextDecoder().decode(bytes)),seed);
 }catch{return [];}
}
