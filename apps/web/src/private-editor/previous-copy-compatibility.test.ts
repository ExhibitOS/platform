// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { ExhibitionV1 } from '@exhibitos/spec';
import { LOD_NAMESPACE } from '@exhibitos/studio-contract';
import { newDraft } from '../drafts/example';
import { syntheticArtwork } from '../placement/model';
import { retainsCopyInventory, retainsCopyRights,retainedWheatCopyFiles } from './previous-copy-compatibility';

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

  it('keeps each ordinary previous category when moving only from v1–3 to v4',()=>{
    for(const version of [1,2,3]){
      const old={version,assets:[first,first],resources:[added],furnishingNotices:[added]};
      const active={...old,version:4,detailAssets:[first]};
      expect(retainsCopyInventory(old,active)).toBe(false);
      expect(retainsCopyInventory(old,active,true)).toBe(true);
      expect(retainsCopyInventory(old,{...active,assets:[first]},true)).toBe(false);
      expect(retainsCopyInventory(old,{...active,resources:[]},true)).toBe(false);
      expect(retainsCopyInventory(old,{...active,furnishingNotices:[]},true)).toBe(false);
      expect(retainsCopyInventory(active,old,true)).toBe(false);
    }
    expect(retainsCopyInventory({version:5,assets:[first]},{version:4,assets:[first]})).toBe(false);
  });

  it('requires each previous work’s assets, roles and rights despite remapped IDs', () => {
    const work=syntheticArtwork('image');
    const project=(artworks:ExhibitionV1['artworks']):ExhibitionV1=>({...newDraft().candidate,artworks,mediaAssets:[]} as ExhibitionV1);
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
    const project=(artworks:ExhibitionV1['artworks']):ExhibitionV1=>({...newDraft().candidate,artworks,mediaAssets:[]} as ExhibitionV1);
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
    const voice:ExhibitionV1['mediaAssets'][number]={...file('4'.repeat(64)),id:crypto.randomUUID(),mime:'audio/wav',rights:work.rights};
    expect(retainsCopyRights({...before,mediaAssets:[voice]},project([current]))).toBe(false);
    expect(retainsCopyRights({...before,mediaAssets:[voice]},{...project([current]),mediaAssets:[voice]})).toBe(true);
    fails(candidate=>{candidate.assets[0]!.sha256='3'.repeat(64);});
    fails(candidate=>{candidate.assets[0]!.role='preview';});
    fails(candidate=>{candidate.primaryAssetId=coarse.id;});
    fails(candidate=>{candidate.extensions={};});
    fails(candidate=>{candidate.extensions={[LOD_NAMESPACE]:{version:1,variants:[{...full,assetId:current.primaryAssetId},{...reduced,textureSize:513}]}};});
  });

  it('recognizes only the two exact approved Wheat derivatives of the same source',()=>{
    const old=syntheticArtwork('image'),full=old.assets[0]!,coarse={...full,id:crypto.randomUUID()};
    const raw='b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',evidence='8c89d1cc6dc07d25e11f8ba084472a3aa8db2fce882dfa78970a034156d3e215';
    const variants=[{approval:'9e57417c-72a7-557e-af97-2935ef654733',full:'2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f',bytes:7503560,coarse:'e246eae77c461d0c3aed5949fe24ff1805f175e44aacf1752f2143cd2b9fbc0b',lowBytes:633155,edge:1792,recipe:'fe002ad256885d6c1899025aa2a07910faaf6eca9055bd87880a2b3b43a8ef24'},{approval:'ce328328-97fa-56cf-8fc1-6bafd4573153',full:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',bytes:8103573,coarse:'0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304',lowBytes:509458,edge:2048,recipe:'5206824d01e36782dbdd9dc9d0872f64c5e17990000495e511bc80d11bb979fd'}];
    old.assets.push(coarse);
    function prepare(work:typeof old,index:number){const v=variants[index]!;work.assets[0]!.sha256=v.full;work.assets[0]!.bytes=v.bytes;work.assets[1]!.sha256=v.coarse;work.assets[1]!.bytes=v.lowBytes;work.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:work.primaryAssetId,detail:'full',textureSize:v.edge},{assetId:work.assets[1]!.id,detail:'coarse',textureSize:512}]},'org.exhibitos.viewer/display-policy':{version:1,profile:'approved-open-access-demo-v1',approvalId:v.approval,sourceAssetSha256:v.full,rightsEvidenceSha256:evidence}};work.provenance.events=[{id:crypto.randomUUID(),at:'2026-01-01T00:00:00Z',type:'exhibited',description:`Approved exact selected open-access display. Object https://www.metmuseum.org/art/collection/search/436535; raw SHA256 ${raw}; canonical SHA256 ${v.full}; recipe SHA256 ${v.recipe}; rights evidence SHA256 ${evidence}.`}];}
    prepare(old,0);const active=structuredClone(old);prepare(active,1);
    const project=(artworks:ExhibitionV1['artworks']):ExhibitionV1=>({...newDraft().candidate,artworks,mediaAssets:[]} as ExhibitionV1),previous=project([old]),current=project([active]);
    expect(retainsCopyRights(previous,current)).toBe(true);expect(retainedWheatCopyFiles(previous,current).map(x=>x.sha256)).toEqual([variants[0]!.full,variants[0]!.coarse]);
    for(const change of [(x:typeof active)=>{x.rights.permissions.export=false;},(x:typeof active)=>{x.metadata.title='Another work';},(x:typeof active)=>{x.dimensions.width+=1;},(x:typeof active)=>{x.assets[1]!.sha256='0'.repeat(64);},(x:typeof active)=>{x.provenance.events[0]!.description+=' altered';},(x:typeof active)=>{(x.extensions!['org.exhibitos.viewer/display-policy'] as {rightsEvidenceSha256:string}).rightsEvidenceSha256='0'.repeat(64);}]){const candidate=structuredClone(active);change(candidate);expect(retainsCopyRights(previous,project([candidate]))).toBe(false);expect(retainedWheatCopyFiles(previous,project([candidate]))).toEqual([]);}
    expect(retainsCopyRights(current,previous)).toBe(false);
  });
});
