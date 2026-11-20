// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {applyLightObjectCommand,ensureOrdinaryRoomBaseLight,ensureRoomBaseLight,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,reflowRoomBaseLight,ROOM_CEILING_FILL_DEFAULT_PROFILE,ROOM_CEILING_FILL_PROFILE,ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE,spaceLightingFor,type LightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import type {Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
it.each([
 [ROOM_CEILING_FILL_PROFILE,89.30480858594046],
 [ROOM_CEILING_FILL_DEFAULT_PROFILE,446.5240429297023],
 [ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE,446.5240429297023],
])('first ordinary Save validates the %s profile before inserting a new exhibition',async(profile,intensity)=>{
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 draft.candidate=ensureOrdinaryRoomBaseLight(draft.candidate,room.id,undefined,profile);
 expect(draft.candidate.lights[0]).toMatchObject({type:'area',unit:'lumen',intensity,dimensions:{width:12*.8,height:8*.8},transform:{position:[0,3.98,0]}});
 const studio=new Studio(),session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session;
 const query=vi.fn(async()=>({rowCount:0,rows:[]})),client={query} as unknown as PoolClient;
 const stale=structuredClone(draft);stale.candidate.lights[0]!.intensity+=.01;
 await expect(studio.create(client,session,{draft:stale,requestId:crypto.randomUUID()})).rejects.toMatchObject({code:'DRAFT_INVALID'});
 expect(query).not.toHaveBeenCalled();
 expect(await studio.create(client,session,{draft,requestId:crypto.randomUUID()})).toMatchObject({revision:1,draft});
 expect(query.mock.calls.length).toBeGreaterThan(0);
});
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

it('persists one bounded room-local opt-in under the ordinary ETag and retains it when the last fill is Off',async()=>{
 const before=newDraft(),roomId=before.candidate.rooms[0]!.id;
 before.candidate=ensureOrdinaryRoomBaseLight(before.candidate,roomId,undefined,ROOM_CEILING_FILL_DEFAULT_PROFILE);
 const lightId=before.candidate.lights[0]!.id;
 const image=syntheticArtwork('image');
 for(let i=0;i<10;i++){
  const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();
  a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;
  a.assets[0]!.path=`room-local-${i}.png`;a.assets[0]!.bytes=32*1024*1024;
  (before.candidate.artworks as typeof a[]).push(a);
 }
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session;
 const studio=new Studio({workspaceId:crypto.randomUUID()} as never,true);
 const row={revision:2,metadata:before,nativeBounded:true};
 vi.spyOn(studio,'access').mockImplementation(async()=>row as never);
 const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql.startsWith('UPDATE exhibitions')){row.metadata=args![2] as typeof before;row.revision=args![3] as number;}
  return {rowCount:0,rows:[]};
 });
 const client={query} as unknown as PoolClient,match=etag(row.revision,before);
 const draft=structuredClone(before);draft.editVersion++;
 draft.candidate=applyLightObjectCommand(draft.candidate,{type:'set-room-ceiling-fill-brightness',
  lightId,brightness:.5,mode:'default',spaceLightingMode:'room-local'}).candidate;
 const optIn={draft,requestId:crypto.randomUUID()};
 const altered=structuredClone(optIn);altered.draft.candidate.title+=' changed';
 await expect(studio.put(client,session,before.exhibitionId,altered,match)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 await expect(studio.put(client,session,before.exhibitionId,optIn,etag(1,before))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 const accepted=await studio.put(client,session,before.exhibitionId,optIn,match);
 expect(accepted.draft).toEqual(draft);
 expect(await studio.get(client,session,before.exhibitionId)).toEqual(accepted);
 const off=structuredClone(accepted.draft);off.editVersion++;
 off.candidate=applyLightObjectCommand(off.candidate,{type:'set-room-ceiling-fill-brightness',lightId,brightness:0}).candidate;
 const saved=await studio.put(client,session,before.exhibitionId,{draft:off,requestId:crypto.randomUUID()},accepted.etag);
 expect(spaceLightingFor(saved.draft.candidate)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0,mode:'room-local'});
 expect(saved.draft.candidate.lights[0]!.intensity).toBe(0);
 expect(await studio.get(client,session,before.exhibitionId)).toEqual(saved);
});
