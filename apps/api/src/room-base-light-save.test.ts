// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {applyLightObjectCommand,ensureRoomBaseLight,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,reflowRoomBaseLight,type LightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import type {Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
it('bounded ordinary viewport/save accepts exact room reflow and historical unknown undo while retaining saved-head and unrelated-field fences',async()=>{
 const draft=newDraft(),image=syntheticArtwork('image');
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;(draft.candidate.artworks as typeof a[]).push(a);}
 const roomId=draft.candidate.rooms[0]!.id;draft.candidate=ensureRoomBaseLight(draft.candidate,roomId);const baseId=lightDetailsFor(draft.candidate)[0]!.lightId;draft.candidate.lights.find(l=>l.id===baseId)!.intensity=0;
 draft.candidate.lights.push({...structuredClone(draft.candidate.lights.find(l=>l.id===baseId)!),id:crypto.randomUUID(),transform:{position:[2,2,0],rotation:[0,0,0,1],scale:[1,1,1]}});
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session,workspaceId=crypto.randomUUID(),studio=new Studio({workspaceId} as never,true);
 const row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:true};vi.spyOn(studio,'access').mockImplementation(async()=>row as never);
 const history:{snapshot?:typeof draft}={};
 const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT snapshot FROM exhibition_revisions')?{rowCount:history.snapshot?1:0,rows:history.snapshot?[{snapshot:history.snapshot}]:[]}:{rowCount:0,rows:[]}),client={query} as unknown as PoolClient;
 const resized=structuredClone(draft);resized.candidate.rooms[0]!.dimensions.height+=1;resized.candidate=reflowRoomBaseLight(resized.candidate,roomId);resized.editVersion++;
 const match=etag(row.revision,draft),input={draft:resized,requestId:crypto.randomUUID()};
 expect(await studio.validateNativeViewport(client,session,draft.exhibitionId,input,match)).toMatchObject({valid:true});expect((await studio.put(client,session,draft.exhibitionId,input,match)).draft).toEqual(resized);expect(resized.candidate.lights.find(l=>l.id===baseId)!.intensity).toBe(0);
 const unsafe=structuredClone(draft);unsafe.candidate.rooms[0]!.dimensions.width=1;unsafe.candidate=reflowRoomBaseLight(unsafe.candidate,roomId);
 await expect(studio.put(client,session,draft.exhibitionId,{draft:unsafe,requestId:crypto.randomUUID()},match)).rejects.toMatchObject({status:422});
 const unrelated=structuredClone(resized);unrelated.candidate.title+=' changed';await expect(studio.put(client,session,draft.exhibitionId,{draft:unrelated,requestId:crypto.randomUUID()},match)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 await expect(studio.put(client,session,draft.exhibitionId,input,etag(1,draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 const unknown=structuredClone(draft);delete (unknown.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.basePlacement;unknown.candidate.lights.find(l=>l.id===baseId)!.transform.position=[1,2,0];
 const restored=structuredClone(unknown);restored.candidate=applyLightObjectCommand(restored.candidate,{type:'set-room-base-light-placement',lightId:baseId,basePlacement:'auto'},{verifiedBaseline:restored.candidate}).candidate;row.metadata=restored;row.revision=3;
 const undo={draft:unknown,requestId:crypto.randomUUID()},head=etag(row.revision,restored);
 await expect(studio.put(client,session,draft.exhibitionId,undo,head)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 history.snapshot=unknown;expect((await studio.put(client,session,draft.exhibitionId,undo,head)).draft).toEqual(unknown);
});
