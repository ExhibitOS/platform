// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {newDraft} from '../../web/src/drafts/example.ts';
import type {Session} from './auth.ts';
import {Studio,etag} from './studio.ts';

it('validates and saves one bounded placement transform without admitting other edits',async()=>{
 const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=source.exhibition;draft.exhibitionId=draft.candidate.id;
 const image=draft.candidate.artworks.find(a=>a.artworkType==='image')!;
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;(draft.candidate.artworks as typeof a[]).push(a);}
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session,workspaceId=crypto.randomUUID(),studio=new Studio({workspaceId} as never,true),row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:true};vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const query=vi.fn(async()=>({rowCount:0,rows:[]})),client={query} as unknown as PoolClient,changed=structuredClone(draft);changed.candidate.placements[0]!.transform.position[0]+=0.01;changed.editVersion++;changed.updatedAt=new Date().toISOString();
 const match=etag(2,draft),input={draft:changed,requestId:crypto.randomUUID()};
 expect(await studio.validateNativeViewport(client,session,draft.exhibitionId,input,match)).toMatchObject({valid:true,editingCapability:{workspaceId,etag:match,revision:2}});
 const result=await studio.put(client,session,draft.exhibitionId,input,match);expect(result.revision).toBe(3);expect(result.draft).toEqual(changed);expect(result.etag).not.toBe(match);
 const invalid=structuredClone(changed);invalid.candidate.title+=' other';
 await expect(studio.put(client,session,draft.exhibitionId,{draft:invalid,requestId:crypto.randomUUID()},match)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 await expect(studio.put(client,session,draft.exhibitionId,input,'"studio-r1-'+ '0'.repeat(64)+'"')).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
});
