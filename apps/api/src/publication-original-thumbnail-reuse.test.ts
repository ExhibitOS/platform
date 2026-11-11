// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import {NativeLocalPublicationStage} from './native-local-publication-stage.ts';
import {Publications} from './publication.ts';
import {Studio,etag} from './studio.ts';
import type {NativeOriginalPublication} from './native-original-publication.ts';
import {createHash,randomUUID} from 'node:crypto';
const issued=vi.hoisted(()=>new WeakSet<object>());
vi.mock('./native-original-publication.ts',async load=>({...await load<typeof import('./native-original-publication.ts')>(),isIssuedNativeOriginalPublication:(value:object)=>issued.has(value)}));
afterEach(()=>vi.restoreAllMocks());
function fixture(changed=false,status='published'){
 const draft=newDraft(),art=syntheticArtwork();draft.candidate.artworks=[art];const primary=art.assets[0]!;
 const s={tenantId:randomUUID(),userId:randomUUID(),role:'artist'} as Session,requestId=randomUUID(),pub=randomUUID(),binding=randomUUID(),match=etag(97,draft);
 const existing={id:pub,exhibition_id:draft.exhibitionId,draft_revision:97,status,revision_sha256:'a'.repeat(64),published_at:new Date(),snapshot:structuredClone(draft.candidate)};
 const selection={artwork_id:art.id,artwork_revision:art.revision,binding_id:binding,source_asset_id:primary.id,source_sha256:primary.sha256};
 const query=vi.fn(async(sql:string):Promise<{rows:Record<string,unknown>[]} >=>{
  if(sql.includes('FROM publication_requests'))return {rows:[]};if(sql.includes('p.draft_revision=$3'))return {rows:[existing]};
  if(sql.includes('FROM artwork_thumbnail_selections'))return {rows:[selection]};
  if(sql.includes('FROM publication_thumbnail_bindings'))return {rows:changed?[]:[selection]};return {rows:[]};
 });
 vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision:97,metadata:draft} as never);
 const detail={assertLive:vi.fn(async()=>{}),assertCurrent:vi.fn(),verifyExisting:vi.fn(async()=>{})} as unknown as NativeOriginalPublication;issued.add(detail);
 const close=vi.fn(async()=>{}),operation=Object.assign(Object.create(NativeLocalPublicationStage.prototype),{assertDetailMode:vi.fn(),claim:vi.fn(async()=>undefined),markEffectsPossible:vi.fn(),close});
 const publications=new Publications({} as Pool),prepare=vi.spyOn(publications as unknown as {prepare:()=>Promise<never>},'prepare').mockRejectedValue(new Error('FRESH_PROJECTION_REACHED'));
 return {draft,s,requestId,pub,match,existing,query,c:{query} as unknown as PoolClient,detail,operation,close,publications,prepare};
}
it('a new original request projects current selected input when the old published head lacks its binding',async()=>{
 const f=fixture(true),before=structuredClone(f.existing);
 await expect(f.publications.publish(f.c,f.s,f.draft.exhibitionId,f.requestId,f.match,f.operation,f.detail)).rejects.toThrow('FRESH_PROJECTION_REACHED');
 expect(f.prepare).toHaveBeenCalled();expect(f.detail.verifyExisting).not.toHaveBeenCalled();expect(f.close).toHaveBeenCalled();expect(f.existing).toEqual(before);
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO publication_requests'))).toBe(false);
});
it('unchanged selections reuse the exact immutable original snapshot',async()=>{
 const f=fixture();expect(await f.publications.publish(f.c,f.s,f.draft.exhibitionId,f.requestId,f.match,f.operation,f.detail)).toMatchObject({publicationId:f.pub,status:'published'});
 expect(f.detail.verifyExisting).toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
});
it('new selection never implicitly republishes a withdrawn snapshot',async()=>{
 const f=fixture(true,'unpublished');expect(await f.publications.publish(f.c,f.s,f.draft.exhibitionId,f.requestId,f.match,f.operation,f.detail)).toMatchObject({publicationId:f.pub,status:'unpublished'});
 expect(f.prepare).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM artwork_thumbnail_selections'))).toBe(false);
});
it('the exact same request replays its committed snapshot before external selection changes',async()=>{
 const f=fixture(true),payload=createHash('sha256').update(JSON.stringify({id:f.draft.exhibitionId,requestId:f.requestId,match:f.match,detailProfile:'native-original-v1'})).digest('hex');
 f.query.mockImplementation(async(sql:string)=>sql.includes('FROM publication_requests')?{rows:[{payload_sha256:payload,publication_id:f.pub}]}:sql.includes('WHERE p.tenant_id=$1 AND p.id=$2')?{rows:[f.existing]}:{rows:[]});
 expect(await f.publications.publish(f.c,f.s,f.draft.exhibitionId,f.requestId,f.match,f.operation,f.detail)).toMatchObject({publicationId:f.pub});
 expect(f.prepare).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM artwork_thumbnail_selections'))).toBe(false);
});
