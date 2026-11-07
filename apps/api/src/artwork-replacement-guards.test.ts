// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {replaceApprovedArtwork} from './artwork-replacement.ts';
import {etag,type Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';

it('rejects stale draft and wrong owner before inspecting or mutating a job',async()=>{
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session,owner={workspaceId:randomUUID()},jobAccess=vi.fn(),client={query:vi.fn(async(sql:string)=>({rows:[],rowCount:sql.startsWith('SELECT * FROM studio_requests')?0:null}))} as unknown as PoolClient;
 const studio={access:vi.fn(async()=>({revision:1,metadata:draft,studio_owner_user_id:session.userId}))} as unknown as Studio,imports={coarseOwner:vi.fn(async()=>owner),access:jobAccess} as unknown as Imports,input={requestId:randomUUID(),artworkId:randomUUID(),importJobId:randomUUID(),artworkRevision:1};
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,etag(2,draft),studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('REMOTE_CONFLICT');expect(jobAccess).not.toHaveBeenCalled();
 vi.mocked(studio.access).mockResolvedValueOnce({revision:1,metadata:draft,studio_owner_user_id:randomUUID()} as never);
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,etag(1,draft),studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('FORBIDDEN');expect(jobAccess).not.toHaveBeenCalled();
});

it('replays an identical completed request after the draft changes, but rejects changed intent',async()=>{
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session,owner={workspaceId:randomUUID()},input={requestId:randomUUID(),artworkId:randomUUID(),importJobId:randomUUID(),artworkRevision:1},match=etag(1,draft),response={revision:2,etag:etag(2,draft),draft};
 const hash=createHash('sha256').update(JSON.stringify(['replace-approved-artwork-v1',session.tenantId,session.userId,owner.workspaceId,draft.exhibitionId,input.requestId,input.artworkId,input.artworkRevision,input.importJobId,match])).digest('hex');
 const client={query:vi.fn(async(sql:string)=>sql.startsWith('SELECT * FROM studio_requests')?{rows:[{payload_sha256:hash,exhibition_id:draft.exhibitionId,response}],rowCount:1}:{rows:[],rowCount:null})} as unknown as PoolClient,studio={access:vi.fn(async()=>({revision:2,metadata:draft,studio_owner_user_id:session.userId}))} as unknown as Studio,jobAccess=vi.fn(),imports={coarseOwner:vi.fn(async()=>owner),access:jobAccess} as unknown as Imports;
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,match,studio,{} as Cms,imports,{} as BlobStore)).resolves.toEqual(response);
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,{...input,importJobId:randomUUID()},match,studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('REQUEST_CONFLICT');expect(jobAccess).not.toHaveBeenCalled();
});
