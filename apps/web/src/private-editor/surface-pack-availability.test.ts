// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {SURFACE_TEXTURE_PACKS} from '@exhibitos/studio-contract';
import {availableSurfacePacks} from './surface-pack-availability';
import type {PrivateSeed} from './model';

const seed={source:{publication:{id:'publication',revisionSha256:'revision'}},indexSha256:'index'} as PrivateSeed;
const manifest=()=>({format:'exhibitos-static-publication-v1',publicationId:'publication',revisionSha256:'revision',indexSha256:'index',files:SURFACE_TEXTURE_PACKS.flatMap(p=>[...Object.values(p.maps),p.notice].map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})))});
describe('private surface pack availability',()=>{
 it('exposes only complete registered packs belonging to the loaded publication',()=>{
  const m=manifest();expect(availableSurfacePacks(m,seed)).toEqual(SURFACE_TEXTURE_PACKS.map(p=>p.id));
  m.files=m.files.filter(f=>f.path!==SURFACE_TEXTURE_PACKS[0]!.notice.path);expect(availableSurfacePacks(m,seed)).toEqual([SURFACE_TEXTURE_PACKS[1]!.id]);
  m.indexSha256='other';expect(availableSurfacePacks(m,seed)).toEqual([]);
 });
 it('fails closed for inconsistent metadata and duplicate paths',()=>{
  const m=manifest();m.files[0]!.sha256='0'.repeat(64);expect(availableSurfacePacks(m,seed)).toEqual([SURFACE_TEXTURE_PACKS[1]!.id]);
  m.files.push(m.files[0]!);expect(availableSurfacePacks(m,seed)).toEqual([]);
 });
});
