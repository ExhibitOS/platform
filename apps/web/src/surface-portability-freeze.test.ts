// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {readOex,writeOex,fixtureURL,type Exhibition} from '@exhibitos/spec';
import {SURFACE_MATERIAL_PACKS,packageSurfaceMaterialManifest,surfaceMaterialNotice} from '@exhibitos/spec/surface-material-resources';
import {surfaceTextureDefaults,SURFACE_TEXTURE_FILES,MATERIAL_NAMESPACE,freezeCanonical,type FreezeBundle} from '@exhibitos/studio-contract';
import {decodeFreezeOex,freezeHash} from './freeze-oex';
import {frozenPublication} from './OfflineExhibition';
import {fetchRegisteredMaterialTexture} from './floor-texture-renderer';
test('selected wall and ceiling maps survive a real portable archive and use authority-checked frozen bytes',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),e=structuredClone(original.exhibition),wall=e.surfaces.find(s=>s.type==='wall')!,room=e.rooms.find(r=>r.id===wall.roomId)!,ceiling=structuredClone(wall);
 ceiling.id=randomUUID();ceiling.type='ceiling';ceiling.dimensions={width:room.dimensions.width,height:room.dimensions.depth};ceiling.transform={position:[0,room.dimensions.height,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]};e.surfaces.push(ceiling);
 e.extensions={...e.extensions,[MATERIAL_NAMESPACE]:{version:1,surfaces:{},surfaceTextures:{[wall.id]:surfaceTextureDefaults('museum-matte-paint').texture,[ceiling.id]:surfaceTextureDefaults('fine-lime-plaster').texture}}} as unknown as Exhibition['extensions'];
 const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
 for(const pack of SURFACE_MATERIAL_PACKS){files.set(pack.notice.path,new TextEncoder().encode(surfaceMaterialNotice(pack)));for(const file of Object.values(pack.maps))files.set(file.path,await readFile(new URL('../public/'+file.path,import.meta.url)));}
 const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),hash=await freezeHash(new TextEncoder().encode(freezeCanonical(e))),decoded=await decodeFreezeOex(archive,hash,'1.0.0-draft.7');
 expect(decoded.exhibition).toEqual(e);expect(decoded.materialResources?.size).toBe(8);expect(packageSurfaceMaterialManifest(e)).toHaveLength(8);
 await expect(decodeFreezeOex(archive,hash,'1.0.0-draft.5')).rejects.toThrow('OEX_VERSION_UNSUPPORTED');
 const bundle={manifest:{id:randomUUID(),source:{exhibitionHash:hash},createdAt:original.manifest.createdAt}} as FreezeBundle;
 let checks=0;const publication=frozenPublication(bundle,decoded,async()=>{checks++;}),fetcher=publication.local!.floorFetcher!;
 expect(publication.local!.retainedMaterialBytes).toBeGreaterThan(0);
 const firstResource=decoded.materialResources!.values().next().value!;decoded.materialResources!.set('shared-buffer-test',firstResource);
 expect(frozenPublication(bundle,decoded,async()=>{}).local!.retainedMaterialBytes).toBe(publication.local!.retainedMaterialBytes);
 decoded.materialResources!.delete('shared-buffer-test');
 for(const file of SURFACE_TEXTURE_FILES){const bytes=await fetchRegisteredMaterialTexture(file,SURFACE_TEXTURE_FILES,new AbortController().signal,fetcher);expect(Buffer.from(bytes).equals(Buffer.from(files.get(file.path)!))).toBe(true);}
 expect(checks).toBeGreaterThanOrEqual(12);await expect(fetcher('/surface-material-textures/../private')).rejects.toThrow('OFFLINE_FLOOR_URL');
 const file=SURFACE_TEXTURE_FILES[0]!,data=decoded.materialResources!.get(file.path)!;data.bytes[0]=data.bytes[0]!^1;
 await expect(fetchRegisteredMaterialTexture(file,SURFACE_TEXTURE_FILES,new AbortController().signal,fetcher)).rejects.toThrow('OFFLINE_FLOOR_INTEGRITY');
});
