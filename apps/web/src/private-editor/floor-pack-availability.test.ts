// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {FLOOR_TEXTURE_PACKS,floorTextureFiles,floorTextureNotice} from '@exhibitos/studio-contract';
import {availableFloorPacks} from './floor-pack-availability';
import type {PrivateSeed} from './model';
const seed={source:{publication:{id:'publication',revisionSha256:'revision'}},indexSha256:'index'} as PrivateSeed;
function manifest(){const packs=FLOOR_TEXTURE_PACKS,notice=Buffer.from(packs.map(floorTextureNotice).join('\n'));return {format:'exhibitos-static-publication-v1',publicationId:'publication',revisionSha256:'revision',indexSha256:'index',files:[...packs.flatMap(floorTextureFiles).map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})),{path:'floor-texture-notices.txt',bytes:notice.length,sha256:createHash('sha256').update(notice).digest('hex')}]};}
describe('private floor availability',()=>{
 it('requires registered maps and the exact aggregate notices for the loaded publication',async()=>{
  const m=manifest();expect(await availableFloorPacks(m,seed)).toEqual(['wood','marble','tile','carpet']);
  m.files[0]!.sha256='0'.repeat(64);expect(await availableFloorPacks(m,seed)).toEqual([]);
 });
 it('rejects mismatched identity and duplicate paths',async()=>{
  const m=manifest();m.revisionSha256='other';expect(await availableFloorPacks(m,seed)).toEqual([]);
  m.revisionSha256='revision';m.files.push(m.files[0]!);expect(await availableFloorPacks(m,seed)).toEqual([]);
 });
});
