// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Exhibition } from '@exhibitos/spec';
import { LOD_NAMESPACE } from '@exhibitos/studio-contract';
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

  it('accepts only an approved coarse PNG added to an otherwise identical full image', () => {
    const work=syntheticArtwork('image');
    work.assets[0]!.bytes=100;
    const full={assetId:work.primaryAssetId,detail:'full',textureSize:2048};
    work.extensions={[LOD_NAMESPACE]:{version:1,variants:[full]}};
    const current=structuredClone(work);
    current.id=crypto.randomUUID();
    current.revisionId=crypto.randomUUID();
    current.primaryAssetId=crypto.randomUUID();
    current.assets[0]!.id=current.primaryAssetId;
    const coarse={...work.assets[0]!,id:crypto.randomUUID(),bytes:42,sha256:added.sha256};
    current.assets.push(coarse);
    const reduced={assetId:coarse.id,detail:'coarse',textureSize:512};
    current.extensions={[LOD_NAMESPACE]:{version:1,variants:[{...full,assetId:current.primaryAssetId},reduced]}};
    const project=(artworks:Exhibition['artworks'])=>({...newDraft().candidate,artworks,mediaAssets:[]});
    const before=project([work]);
    expect(retainsCopyRights(before,project([current]))).toBe(true);
    expect(retainsCopyRights(project([work,current]),project([current,work]))).toBe(true);
    expect(retainsCopyRights(project([work,work]),project([current]))).toBe(false);
    expect(retainsCopyRights(project([current]),before)).toBe(false);
    const fails=(change:(candidate:typeof current)=>void)=>{
      const candidate=structuredClone(current);
      change(candidate);
      expect(retainsCopyRights(before,project([candidate]))).toBe(false);
    };
    fails(candidate=>{candidate.rights.permissions.display=false;});
    fails(candidate=>{candidate.metadata.description='Different source';});
    fails(candidate=>{candidate.provenance.events[0]!.description='Different provenance';});
    const voice:Exhibition['mediaAssets'][number]={...file('4'.repeat(64)),id:crypto.randomUUID(),mime:'audio/wav',rights:work.rights};
    expect(retainsCopyRights({...before,mediaAssets:[voice]},project([current]))).toBe(false);
    expect(retainsCopyRights({...before,mediaAssets:[voice]},{...project([current]),mediaAssets:[voice]})).toBe(true);
    fails(candidate=>{candidate.assets[0]!.sha256='3'.repeat(64);});
    fails(candidate=>{candidate.assets[0]!.role='preview';});
    fails(candidate=>{candidate.primaryAssetId=coarse.id;});
    fails(candidate=>{candidate.extensions={};});
    fails(candidate=>{candidate.extensions={[LOD_NAMESPACE]:{version:1,variants:[{...full,assetId:current.primaryAssetId},{...reduced,textureSize:513}]}};});
  });
});
