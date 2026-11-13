// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {installedFrameDescriptorFor,installedFrameThumbnail,readInstalledFrameThumbnail,INSTALLED_FRAME_ID} from './installed-artwork-frame.ts';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import {furnishingThumbnailCanonicalHash} from './workspace-furnishing-thumbnail-contract.ts';
vi.mock('./furnishing-assets.ts',()=>({readInstalledFurnishing:vi.fn()}));
const id='af88109b-27e2-4d10-a08c-3ddc0224451a',tenantId='66d45ba8-457e-4d23-999d-f242fc1c7590';
afterEach(()=>vi.mocked(readInstalledFurnishing).mockReset());
it('binds only the immutable installed original and exposes safe product job lineage',()=>{
 const value=installedFrameThumbnail(id)!,descriptor=installedFrameDescriptorFor(id)!;
 expect(value.source).toEqual({furnishingId:id,furnishingVersion:1,modelBytes:7892,modelSha256:descriptor.model.sha256,descriptorSha256:furnishingThumbnailCanonicalHash(descriptor),rightsSha256:furnishingThumbnailCanonicalHash(descriptor.rights)});
 expect(value.provenance).toEqual({recipeId:'furnishing-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1',renderRequestId:'0d02fc63-52ed-43a1-846e-a87b11edef8d'});
 expect(Object.keys(value).sort()).toEqual(['png','profile','provenance','source']);
 expect(installedFrameThumbnail(tenantId)).toBeUndefined();expect(installedFrameThumbnail(INSTALLED_FRAME_ID)).toBeUndefined();
 value.source.modelSha256='f'.repeat(64);expect(installedFrameThumbnail(id)!.source.modelSha256).toBe(descriptor.model.sha256);
});
it('reads only the pinned packaged PNG, preserves its exact bytes and never aliases tenant selection',async()=>{
 const png=await readFile(new URL('../test-fixtures/thin-brass-frame/thumbnail.png',import.meta.url));
 vi.mocked(readInstalledFurnishing).mockResolvedValue(png);
 const result=await readInstalledFrameThumbnail(id);expect(result!.bytes).toEqual(png);expect(result!.thumbnail.png).toMatchObject({bytes:5176,width:256,height:256,sha256:'6973f99f18bc88f0d0ff6797b43a9549504e41f3d05423354cd88ce36c5f648a'});
 expect(readInstalledFurnishing).toHaveBeenCalledExactlyOnceWith('assets/furnishings/user-authored-20261027/thin-brass-frame/thumbnail.png',5176,result!.thumbnail.png.sha256,undefined);
 vi.mocked(readInstalledFurnishing).mockClear();expect(await readInstalledFrameThumbnail(tenantId)).toBeUndefined();expect(readInstalledFurnishing).not.toHaveBeenCalled();
});
it('rejects a substituted valid PNG descriptor and propagates missing/corrupt packaged custody',async()=>{
 const png=await readFile(new URL('../test-fixtures/thin-brass-frame/thumbnail.png',import.meta.url));png[png.length-1]=png[png.length-1]!^1;vi.mocked(readInstalledFurnishing).mockResolvedValue(png);
 await expect(readInstalledFrameThumbnail(id)).rejects.toMatchObject({code:'FURNISHING_INTEGRITY'});
 vi.mocked(readInstalledFurnishing).mockRejectedValue(Object.assign(new Error('missing pinned asset'),{code:'FURNISHING_INTEGRITY'}));await expect(readInstalledFrameThumbnail(id)).rejects.toMatchObject({code:'FURNISHING_INTEGRITY'});
});
