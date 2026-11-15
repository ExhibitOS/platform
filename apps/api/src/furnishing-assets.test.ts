// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {furnishingAsset,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {readFurnishingBytes,readInstalledFurnishing} from './furnishing-assets.ts';
const id='11111111-1111-4111-8111-111111111111';
it.each(['museum-track-spot','museum-track-spot-fixed-64p1'] as const)('reads both exact packaged publication resources for %s',async catalogId=>{
 const asset=furnishingAsset(id,catalogId),entry=furnishingCatalogueEntry(catalogId);
 for(const role of ['model','notice'] as const){
  const bytes=await readFurnishingBytes(asset,role);
  expect(bytes.length).toBe(role==='model'?entry.bytes:entry.rights.noticeBytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(role==='model'?entry.sha256:entry.rights.noticeSha256);
 }
});
it('retains exact identity, resource role, path and body integrity fences',async()=>{
 const asset=furnishingAsset(id,'museum-track-spot-fixed-64p1'),entry=furnishingCatalogueEntry(asset.catalogId);
 await expect(readFurnishingBytes({...asset,sha256:'f'.repeat(64)})).rejects.toMatchObject({code:'FURNISHING_UNAVAILABLE'});
 for(const path of ['assets/furnishings/exhibitos-authored-20261115/museum-track-spot-fixed-64p1/other.glb','assets/furnishings/exhibitos-authored-20261115/unqualified/model.glb','assets/furnishings/exhibitos-authored-20261115/museum-track-spot-fixed-64p1/../model.glb'])await expect(readInstalledFurnishing(path,entry.bytes,entry.sha256)).rejects.toMatchObject({code:'FURNISHING_UNAVAILABLE'});
 await expect(readInstalledFurnishing(entry.path,entry.bytes,'f'.repeat(64))).rejects.toMatchObject({code:'FURNISHING_INTEGRITY'});
});
