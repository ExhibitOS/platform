// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Exhibition } from '@exhibitos/spec';
import { newDraft } from '../drafts/example';
import { syntheticArtwork } from '../placement/model';
import { retainsCopyInventory, retainsCopyRights } from './previous-copy-compatibility';

const file = (digest: string) => ({path:`data/${digest}.bin`,sha256:digest,bytes:42,mime:'image/png'});
const first = file('1'.repeat(64));
const added = file('2'.repeat(64));

describe('previous private copy compatibility', () => {
  it('retains only old files at exact paths in each inventory category', () => {
    const before={version:2,assets:[first],resources:[added]};
    expect(retainsCopyInventory(before,{...before,assets:[first,added]})).toBe(true);
    expect(retainsCopyInventory(before,{...before,assets:[added],resources:[first,added]})).toBe(false);
    expect(retainsCopyInventory(before,{...before,assets:[{...first,bytes:43},added]})).toBe(false);
    expect(retainsCopyInventory(before,{...before,assets:[{...first,path:added.path}]})).toBe(false);
    expect(retainsCopyInventory({...before,assets:[first,first]},before)).toBe(false);
    expect(retainsCopyInventory(before,{...before,version:3})).toBe(false);
  });

  it('requires each previous work’s assets, roles and rights despite remapped IDs', () => {
    const work=syntheticArtwork('image');
    const project=(artworks:Exhibition['artworks'])=>({...newDraft().candidate,artworks,mediaAssets:[]});
    const before=project([work]);
    const remapped={...work,id:crypto.randomUUID(),revisionId:crypto.randomUUID(),
      assets:work.assets.map(asset=>({...asset,id:crypto.randomUUID()}))};
    const other=syntheticArtwork('image');
    other.assets[0]!.sha256=added.sha256;
    expect(retainsCopyRights(before,project([other,remapped]))).toBe(true);
    expect(retainsCopyRights(before,project([other]))).toBe(false);
    expect(retainsCopyRights(before,project([{...remapped,rights:Object.assign({},work.rights,{creditLine:'Changed credit'})}]))).toBe(false);
    expect(retainsCopyRights(before,project([{...remapped,rights:Object.assign({},work.rights,{permissions:Object.assign({},work.rights.permissions,{export:false})})}]))).toBe(false);
    expect(retainsCopyRights(project([work,work]),project([remapped]))).toBe(false);
  });
});
