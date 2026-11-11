// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {publicationThumbnailsCurrent} from './publication-thumbnail-freshness.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
const tenant='10000000-0000-4000-8000-000000000001',publication='10000000-0000-4000-8000-000000000002',binding='10000000-0000-4000-8000-000000000003';
function fixture(){
 const candidate=newDraft().candidate,art=syntheticArtwork();candidate.artworks=[art];
 const primary=art.assets.find(a=>a.id===art.primaryAssetId)!;
 const current={artwork_id:art.id,artwork_revision:art.revision,binding_id:binding,source_asset_id:primary.id,source_sha256:primary.sha256};
 const published={artwork_id:art.id,artwork_revision:art.revision,binding_id:binding};
 return {candidate,current,published};
}
it('detects a newly selected preview absent from the immutable publication without changing the saved head',async()=>{
 const f=fixture(),before=structuredClone(f.candidate),query=vi.fn().mockResolvedValueOnce({rows:[f.current]}).mockResolvedValueOnce({rows:[]});
 expect(await publicationThumbnailsCurrent({query} as unknown as PoolClient,tenant,publication,f.candidate)).toBe(false);
 expect(f.candidate).toEqual(before);expect(query.mock.calls[0]![0]).toContain('FROM artwork_thumbnail_selections');
 expect(query.mock.calls[0]![1]).toEqual([tenant,[f.current.artwork_id]]);expect(query.mock.calls[1]![1]).toEqual([tenant,publication]);
 expect(query.mock.calls.every(([sql])=>!/^\s*(UPDATE|INSERT|DELETE)/.test(sql))).toBe(true);
});
it('compares immutable binding identity, including replacement and removed selections, independently of row order',async()=>{
 const f=fixture();
 for(const [current,published,expected]of [
  [[f.current],[f.published],true],
  [[{...f.current,binding_id:'10000000-0000-4000-8000-000000000004'}],[f.published],false],
  [[],[f.published],false],
  [[],[],true],
 ] as const){const query=vi.fn().mockResolvedValueOnce({rows:current}).mockResolvedValueOnce({rows:published});expect(await publicationThumbnailsCurrent({query} as unknown as PoolClient,tenant,publication,f.candidate)).toBe(expected);}
});
it('does not treat a foreign revision or mismatched primary source as a current selection',async()=>{
 const f=fixture();for(const change of [{artwork_revision:f.current.artwork_revision+1},{source_asset_id:publication},{source_sha256:'b'.repeat(64)},{artwork_id:publication}]){
  const query=vi.fn().mockResolvedValueOnce({rows:[{...f.current,...change}]}).mockResolvedValueOnce({rows:[]});
  expect(await publicationThumbnailsCurrent({query} as unknown as PoolClient,tenant,publication,f.candidate)).toBe(true);
 }
});
