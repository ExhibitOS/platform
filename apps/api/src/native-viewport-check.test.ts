// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';

it('requires existing bounded provenance and matching draft identities without writing',async()=>{
 const draft=newDraft(),studio=new Studio(),session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'artist'} as Session;
 const query=vi.fn(),c={query} as unknown as PoolClient,input={draft,requestId:crypto.randomUUID()};
 const access=vi.spyOn(studio,'access').mockResolvedValue({metadata:draft,nativeBounded:false} as never);
 await expect(studio.validateNativeViewport(c,session,draft.exhibitionId,input)).rejects.toMatchObject({code:'FORBIDDEN'});
 access.mockResolvedValue({metadata:draft,nativeBounded:true} as never);
 expect(await studio.validateNativeViewport(c,session,draft.exhibitionId,input)).toEqual({valid:true});
 await expect(studio.validateNativeViewport(c,session,draft.exhibitionId,{...input,draft:{...draft,id:crypto.randomUUID()}})).rejects.toMatchObject({code:'DRAFT_ID_MISMATCH'});
 await expect(studio.validateNativeViewport(c,session,draft.exhibitionId,{...input,draft:{...draft,candidate:{...draft.candidate,units:'invalid'}}} as never)).rejects.toMatchObject({code:'DRAFT_INVALID'});
 expect(query).not.toHaveBeenCalled();expect(access).toHaveBeenCalledWith(c,session,draft.exhibitionId);
});
it('reports a read-only policy only for a proven bounded aggregate-only saved draft',async()=>{
 const draft=newDraft(),studio=new Studio({} as never),session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'artist'} as Session,c={} as PoolClient;
 const row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:false};const access=vi.spyOn(studio,'access').mockResolvedValue(row as never);
 expect(await studio.nativeViewportPolicy(c,session,draft.exhibitionId)).toEqual({exhibitionId:draft.exhibitionId,revision:2,etag:etag(2,draft),boundedReadOnly:false,boundedProfile:false,boundedEditRequired:false});
 const small=structuredClone(draft);
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),image=original.exhibition.artworks.find(a=>a.artworkType==='image')!;
 draft.candidate.artworks=Array.from({length:10},(_,i)=>{const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`test-${i}.png`;a.assets[0]!.bytes=32*1024*1024;return a;});
 row.nativeBounded=true;expect(await studio.nativeViewportPolicy(c,session,draft.exhibitionId)).toEqual({exhibitionId:draft.exhibitionId,revision:2,etag:etag(2,draft),boundedReadOnly:true,boundedProfile:true,boundedEditRequired:true});
 const workspaceId=crypto.randomUUID(),editable=new Studio({workspaceId} as never,true);vi.spyOn(editable,'access').mockResolvedValue(row as never);
 const expected={version:1,kind:'native-bounded-edit-v1',tenantId:session.tenantId,principalId:session.userId,workspaceId,exhibitionId:draft.exhibitionId,revision:2,etag:etag(2,draft)};
 expect(await editable.nativeViewportPolicy(c,session,draft.exhibitionId)).toEqual({exhibitionId:draft.exhibitionId,revision:2,etag:expected.etag,boundedReadOnly:false,boundedProfile:true,boundedEditRequired:true,editingCapability:expected});
 expect(await editable.validateNativeViewport(c,session,draft.exhibitionId,{draft,requestId:crypto.randomUUID()},expected.etag)).toEqual({valid:true,editingCapability:expected});
 const otherChange=structuredClone(draft);otherChange.candidate.title='Changed elsewhere';
 await expect(editable.validateNativeViewport(c,session,draft.exhibitionId,{draft:otherChange,requestId:crypto.randomUUID()},expected.etag)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 const writeClient={query:vi.fn(async()=>({rowCount:0,rows:[]}))} as unknown as PoolClient;
 await expect(editable.put(writeClient,session,draft.exhibitionId,{draft:otherChange,requestId:crypto.randomUUID()},expected.etag)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 row.metadata=small;
 expect(await editable.nativeViewportPolicy(c,session,small.exhibitionId)).toMatchObject({boundedProfile:true,boundedEditRequired:false,boundedReadOnly:false});
 await expect(editable.put(writeClient,session,small.exhibitionId,{draft,requestId:crypto.randomUUID()},etag(2,small))).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 row.metadata=draft;
 await expect(editable.validateNativeViewport(c,session,draft.exhibitionId,{draft,requestId:crypto.randomUUID()},'"studio-r1-'+ '0'.repeat(64)+'"')).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 expect(await editable.validateNativeViewport(c,session,draft.exhibitionId,{draft,requestId:crypto.randomUUID()})).toEqual({valid:true});
 row.nativeBounded=false;await expect(studio.nativeViewportPolicy(c,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 row.nativeBounded=true;draft.candidate.title='';await expect(studio.nativeViewportPolicy(c,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 access.mockRejectedValueOnce(Object.assign(Error('denied'),{code:'FORBIDDEN'}));await expect(studio.nativeViewportPolicy(c,session,draft.exhibitionId)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(new Studio().nativeViewportPolicy(c,session,draft.exhibitionId)).rejects.toMatchObject({code:'NOT_FOUND'});
});
