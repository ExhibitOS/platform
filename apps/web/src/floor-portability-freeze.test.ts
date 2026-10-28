// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {test,expect} from 'vitest';
import {fixtureURL,readOex,writeOex,type Exhibition} from '@exhibitos/spec';
import {FLOOR_RESOURCE_PACKS,packageFloorResourceManifest,floorResourceNotice} from '@exhibitos/spec/floor-resources';
import {floorPresetDefaults,FLOOR_NAMESPACE,freezeCanonical,type FreezeBundle} from '@exhibitos/studio-contract';
import {decodeFreezeOex,freezeHash} from './freeze-oex';
import {frozenPublication} from './OfflineExhibition';
import {fetchFloorTexture} from './floor-texture-renderer';

const same=(a:Uint8Array,b:Uint8Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength));

test('all four portable packs retain maps and notices and supply actual frozen map bytes without provider IO',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-space-still.oex'))),e=structuredClone(original.exhibition),presets=['wood','marble','tile','carpet'] as const;
 const rooms=presets.map((_,i)=>{const room=structuredClone(e.rooms[0]!);room.id=randomUUID();room.transform.position=[50+i*30,0,0];return room;});e.rooms.push(...rooms);
 e.extensions={...e.extensions,[FLOOR_NAMESPACE]:{version:1,bindings:presets.map((p,i)=>({...floorPresetDefaults(p),target:{kind:'room-base',roomId:rooms[i]!.id}}))}} as Exhibition['extensions'];
 const resources=packageFloorResourceManifest(e),files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
 for(const pack of FLOOR_RESOURCE_PACKS){files.set(pack.notice.path,new TextEncoder().encode(floorResourceNotice(pack)));for(const file of Object.values(pack.maps))if(file)files.set(file.path,await readFile(new URL('../public/'+file.path,import.meta.url)));}
 const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),hash=await freezeHash(new TextEncoder().encode(freezeCanonical(e))),decoded=await decodeFreezeOex(archive,hash,'1.0.0-draft.5');
 expect(resources).toHaveLength(17);expect(decoded.floorResources?.size).toBe(17);for(const f of resources){const bytes=decoded.floorResources?.get(f.artifactPath)?.bytes;expect(!!bytes&&same(bytes,files.get(f.artifactPath)!)).toBe(true);}
 await expect(decodeFreezeOex(archive,hash,'1.0.0-draft.4')).rejects.toThrow('OEX_VERSION_UNSUPPORTED');
 const bundle={manifest:{id:randomUUID(),source:{exhibitionHash:hash},createdAt:original.manifest.createdAt}} as FreezeBundle;
 let checks=0;const value=frozenPublication(bundle,decoded,async()=>{checks++;}),fetcher=value.local!.floorFetcher!;
 for(const file of [FLOOR_RESOURCE_PACKS[0]!.maps.color!,FLOOR_RESOURCE_PACKS[3]!.maps.ao!]){const bytes=await fetchFloorTexture(file,new AbortController().signal,fetcher);expect(same(bytes,files.get(file.path)!)).toBe(true);}
 expect(checks).toBeGreaterThanOrEqual(4);await expect(fetcher('/floor-textures/../private')).rejects.toThrow('OFFLINE_FLOOR_URL');
 const file=FLOOR_RESOURCE_PACKS[0]!.maps.color!,data=decoded.floorResources!.get(file.path)!;data.bytes[0]=data.bytes[0]!^1;
 await expect(fetchFloorTexture(file,new AbortController().signal,fetcher)).rejects.toThrow('OFFLINE_FLOOR_INTEGRITY');
});
