// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {Publications} from './publication.ts';
import {Studio,etag,type Draft} from './studio.ts';
import {createHash} from 'node:crypto';

const tenant='10000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000002',exhibition='10000000-0000-4000-8000-000000000003',publication='10000000-0000-4000-8000-000000000004',requestId='10000000-0000-4000-8000-000000000005';
const session={tenantId:tenant,userId:user,role:'artist'} as Session;
const published={id:publication,exhibition_id:exhibition,draft_revision:2,status:'unpublished',revision_sha256:'a'.repeat(64),published_at:new Date('2026-10-30T12:00:00Z')};
afterEach(()=>vi.restoreAllMocks());

it('opens the existing server authoring identity without creating a draft or changing publication state',async()=>{
 const draft={id:'10000000-0000-4000-8000-000000000006',exhibitionId:exhibition} as Draft,saved={draft,revision:3,etag:'"saved"'};
 const get=vi.spyOn(Studio.prototype,'get').mockResolvedValue(saved);
 const query=vi.fn().mockResolvedValueOnce({rows:[{exhibition_id:exhibition}]}).mockResolvedValueOnce({rows:[published,{...published,id:requestId,status:'published'}]});
 const c={query} as unknown as PoolClient,result=await new Publications({} as Pool).editingDraft(c,session,publication);
 expect(get).toHaveBeenCalledWith(c,session,exhibition);
 expect(result).toMatchObject({...saved,capability:'reusable-published-draft-v1',authoringExhibitionId:exhibition,sourcePublicationId:publication,reused:true,currentPublication:{publicationId:publication,status:'unpublished'},previousPublication:{publicationId:requestId,status:'published'}});
 expect(query.mock.calls.every(([sql])=>!/^\s*(INSERT|UPDATE|DELETE)/.test(sql))).toBe(true);
 expect(query.mock.calls[0]![1]).toEqual([tenant,publication]);
});

it('does not expose a private draft for a missing or foreign source',async()=>{
 const get=vi.spyOn(Studio.prototype,'get'),query=vi.fn().mockResolvedValue({rows:[]});
 await expect(new Publications({} as Pool).editingDraft({query} as unknown as PoolClient,session,publication)).rejects.toMatchObject({status:403,code:'FORBIDDEN'});
 expect(get).not.toHaveBeenCalled();
});

it('records a new request for an already published saved revision without reactivating it',async()=>{
 const metadata={id:exhibition} as Draft,row={revision:2,metadata};
 vi.spyOn(Studio.prototype,'access').mockResolvedValue(row as never);
 const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[published]}).mockResolvedValueOnce({rows:[]});
 const result=await new Publications({} as Pool).publish({query} as unknown as PoolClient,session,exhibition,requestId,etag(2,metadata));
 expect(result).toMatchObject({publicationId:publication,status:'unpublished'});
 expect(query.mock.calls[1]![1]).toEqual([tenant,exhibition,2]);
 expect(query.mock.calls[2]![0]).toContain('INSERT INTO publication_requests');
 expect(query.mock.calls.some(([sql])=>/UPDATE publication_states|INSERT INTO studio_publications/.test(sql))).toBe(false);
});

it('rejects stale saved ETags before same-revision publication reuse',async()=>{
 vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision:3,metadata:{}} as never);
 const query=vi.fn().mockResolvedValue({rows:[]});
 await expect(new Publications({} as Pool).publish({query} as unknown as PoolClient,session,exhibition,requestId,'"old"')).rejects.toMatchObject({status:412,code:'REMOTE_CONFLICT'});
 expect(query).toHaveBeenCalledTimes(1);
});

it('recovers the same publication receipt before a newer private draft ETag',async()=>{
 const match='"prior-saved"',payload=createHash('sha256').update(JSON.stringify({id:exhibition,requestId,match})).digest('hex');
 vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision:9,metadata:{}} as never);
 const query=vi.fn().mockResolvedValueOnce({rows:[{payload_sha256:payload,publication_id:publication}]}).mockResolvedValueOnce({rows:[published]});
 const result=await new Publications({} as Pool).publish({query} as unknown as PoolClient,session,exhibition,requestId,match);
 expect(result).toMatchObject({publicationId:publication,status:'unpublished'});
 expect(query).toHaveBeenCalledTimes(2);
});
