// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {SURFACE_MATERIAL_FILES,SURFACE_MATERIAL_PACKS,surfaceMaterialNotice} from '@exhibitos/spec/surface-material-resources';
import {surfaceMaterialCatalog,surfaceMaterialResourceBytes} from './surface-materials.ts';
const tenant='11111111-1111-4111-8111-111111111111',exhibition='22222222-2222-4222-8222-222222222222';
test('the protected catalogue wire has two exact material defaults and explicit unavailable thumbnails',()=>{
 const value=JSON.parse(JSON.stringify(surfaceMaterialCatalog()));expect(Object.keys(value).sort()).toEqual(['items','version']);expect(value.version).toBe(1);expect(value.items.map((i:{id:string})=>i.id)).toEqual(['museum-matte-paint','fine-lime-plaster']);
 for(const item of value.items){expect(Object.keys(item).sort()).toEqual(['defaults','id','name','preview','version']);expect(item.preview).toBeNull();expect(item.version).toBe(1);expect(item.defaults.material).toEqual({color:'#ffffff',roughness:1,metalness:0});expect(item.defaults.texture.pack).toEqual({id:item.id,version:1});}
 expect(value.items[0].defaults.texture.repeatMeters).toEqual([1,1]);expect(value.items[1].defaults.texture.repeatMeters).toEqual([2,2]);
});
test('imported selected resource bytes remain independent of installed maps and reject cross-tenant references',async()=>{
 const entry=SURFACE_MATERIAL_FILES.find(f=>f.role==='notice')!,pack=SURFACE_MATERIAL_PACKS.find(p=>p.id===entry.packId)!,bytes=Buffer.from(surfaceMaterialNotice(pack)),row={object_key:tenant+'/oex-import/job/lease/notice',resource_path:entry.artifactPath,bytes:entry.bytes,sha256:entry.sha256},get=vi.fn(async()=>bytes),client={query:vi.fn(async()=>({rows:[row]}))} as unknown as PoolClient,blobs={get} as unknown as BlobStore;
 expect(await surfaceMaterialResourceBytes(client,blobs,tenant,exhibition,entry)).toEqual(bytes);expect(get).toHaveBeenCalledTimes(1);
 row.object_key='another-tenant/oex-import/job/notice';await expect(surfaceMaterialResourceBytes(client,blobs,tenant,exhibition,entry)).rejects.toMatchObject({code:'SURFACE_MATERIAL_INTEGRITY'});expect(get).toHaveBeenCalledTimes(1);
 get.mockResolvedValue(Buffer.from('altered'));row.object_key=tenant+'/oex-import/job/lease/notice';await expect(surfaceMaterialResourceBytes(client,blobs,tenant,exhibition,entry)).rejects.toMatchObject({code:'SURFACE_MATERIAL_INTEGRITY'});
});
test('arbitrary file descriptors reject before SQL or blob access',async()=>{
 const query=vi.fn(),get=vi.fn(),client={query} as unknown as PoolClient,blobs={get} as unknown as BlobStore,entry=SURFACE_MATERIAL_FILES[0]!;
 await expect(surfaceMaterialResourceBytes(client,blobs,tenant,exhibition,{...entry,artifactPath:'../private/source'})).rejects.toMatchObject({code:'SURFACE_MATERIAL_DESCRIPTOR'});expect(query).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
});
