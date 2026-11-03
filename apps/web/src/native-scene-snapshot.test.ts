// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical} from '@exhibitos/studio-contract';
import {afterEach,expect,test,vi} from 'vitest';
import {newDraft} from './drafts/example';
import {syntheticArtwork,newPlacement} from './placement/model';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedSceneSnapshotRequest,checkedSavedScene,snapshotCandidateHash,snapshotEditSettled,type SceneSnapshotRequest} from './native-scene-snapshot';
afterEach(()=>vi.unstubAllGlobals());
function sample(){
 const draft=newDraft(),tenantId=crypto.randomUUID(),art=syntheticArtwork('image');art.extensions={...art.extensions,'org.exhibitos.studio/cms':{tenantId,artworkId:art.id,revision:art.revision}};draft.candidate.artworks=[art];const placement=newPlacement(art,draft.candidate.rooms[0]!.id);draft.candidate.placements=[placement];const viewpointId=crypto.randomUUID();draft.candidate.extensions={...draft.candidate.extensions,'org.exhibitos.studio/presentation':{version:1,credits:'',viewpoints:[{id:viewpointId,roomId:placement.roomId,name:'Existing view',position:[0,1.2,2],target:[0,1.2,0],fov:50}]}};
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId,principalId:crypto.randomUUID(),draft,selection:{kind:'placement',id:placement.id},mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};const etag='"studio-r9-'+ 'a'.repeat(64)+'"';
 const request:SceneSnapshotRequest={version:1,epoch:frame.epoch,sequence:1,tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),expectedETag:etag,viewpointId,placementId:placement.id,width:640,height:360};
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.includes('/studio/exhibitions/'))return Response.json({draft,revision:9,etag},{headers:{etag}});if(url.endsWith('/display'))return Response.json({id:art.id,revision:1,export:true});return Response.json({artwork:art});});vi.stubGlobal('fetch',fetcher);return {frame,request,art,fetcher,etag};
}
test('binds existing saved content and server-authorized export without changing input',async()=>{
 const s=sample(),before=structuredClone(s.frame);expect(checkedSceneSnapshotRequest(s.request,s.frame)).toEqual(s.request);expect(await checkedSavedScene(s.frame,s.request,new AbortController().signal)).toEqual({exhibitionId:s.frame.draft.exhibitionId,draftId:s.frame.draft.id,revision:9,etag:s.etag});expect(s.fetcher.mock.calls.some(([url])=>String(url).endsWith('/display'))).toBe(true);expect(await snapshotCandidateHash(s.frame)).toMatch(/^[0-9a-f]{64}$/);expect(s.frame).toEqual(before);
});
test('rejects stale frames, unsupported dimensions and unrelated authored views',()=>{
 const s=sample();for(const value of [{...s.request,sequence:2},{...s.request,width:1280,height:720},{...s.request,extra:true},{...s.request,viewpointId:crypto.randomUUID()}])expect(()=>checkedSceneSnapshotRequest(value,s.frame)).toThrow();expect(()=>checkedSceneSnapshotRequest(s.request,{...s.frame,transparent:true})).toThrow();
});
test('refuses a server export denial even when draft rights allow display and export',async()=>{
 const s=sample(),original=s.fetcher.getMockImplementation()!;s.fetcher.mockImplementation(async input=>String(input).endsWith('/display')?Response.json({id:s.art.id,revision:1,export:false}):original(input));await expect(checkedSavedScene(s.frame,s.request,new AbortController().signal)).rejects.toThrow('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
});
test('refuses changed persisted content or an ETag header mismatch',async()=>{
 const s=sample(),changed=structuredClone(s.frame.draft);changed.candidate.title='Concurrent edit';s.fetcher.mockResolvedValueOnce(Response.json({draft:changed,revision:9,etag:s.etag},{headers:{etag:s.etag}}));await expect(checkedSavedScene(s.frame,s.request,new AbortController().signal)).rejects.toThrow('SCENE_SNAPSHOT_SAVED_CHANGED');s.fetcher.mockResolvedValueOnce(Response.json({draft:s.frame.draft,revision:9,etag:s.etag},{headers:{etag:'"studio-r10-'+ 'b'.repeat(64)+'"'}}));await expect(checkedSavedScene(s.frame,s.request,new AbortController().signal)).rejects.toThrow('SCENE_SNAPSHOT_SAVED_CHANGED');
});


test('selection frames cannot clear an unacknowledged visual edit before verified rollback',()=>{
 const s=sample(),edited=structuredClone(s.frame);edited.sequence=3;edited.draft.candidate.title='Pending host edit';const pending={epoch:s.frame.epoch,sequence:s.frame.sequence,candidate:freezeCanonical(edited.draft.candidate)},selectionOnly={...s.frame,sequence:2};
 expect(snapshotEditSettled(pending,selectionOnly,false)).toBe(false);expect(snapshotEditSettled(pending,selectionOnly,true)).toBe(true);expect(snapshotEditSettled(pending,s.frame,true)).toBe(false);expect(snapshotEditSettled(pending,{...selectionOnly,epoch:crypto.randomUUID()},true)).toBe(false);expect(snapshotEditSettled(pending,edited,false)).toBe(true);
});

test('inspection can target an approved room without a saved stop while retaining saved/session/export guards',async()=>{
 const s=sample(),before=structuredClone(s.frame),{viewpointId,...base}=s.request;
 const request={...base,inspectionCamera:{roomId:s.frame.draft.candidate.placements[0]!.roomId,position:[0,1.2,2],target:[0,1.2,0],fov:50}};
 s.frame.draft.candidate.extensions!['org.exhibitos.studio/presentation']={version:1,credits:'',viewpoints:[]};
 const frozen=structuredClone(s.frame);expect(checkedSceneSnapshotRequest(request,s.frame)).toEqual(request);
 expect(()=>checkedSceneSnapshotRequest({...base,viewpointId},s.frame)).toThrow('SCENE_SNAPSHOT_TARGET_INVALID');
 expect((await checkedSavedScene(s.frame,checkedSceneSnapshotRequest(request,s.frame),new AbortController().signal)).revision).toBe(9);
 expect(s.frame).toEqual(frozen);expect(s.frame.draft.candidate.artworks).toEqual(before.draft.candidate.artworks);
 const original=s.fetcher.getMockImplementation()!;s.fetcher.mockImplementation(async input=>String(input).endsWith('/display')?Response.json({id:s.art.id,revision:1,export:false}):original(input));
 await expect(checkedSavedScene(s.frame,checkedSceneSnapshotRequest(request,s.frame),new AbortController().signal)).rejects.toThrow('SCENE_SNAPSHOT_RIGHTS_UNVERIFIED');
});

test('camera modes are closed and do not relax the saved-viewpoint same-room rule',()=>{
 const s=sample(),{viewpointId,...base}=s.request,room=s.frame.draft.candidate.rooms[0]!,other={...structuredClone(room),id:crypto.randomUUID()};s.frame.draft.candidate.rooms.push(other);
 const inspectionCamera={roomId:room.id,position:[0,1.2,2],target:[0,1.2,0],fov:50};
 for(const value of [{...base,inspectionCamera,viewpointId},{...base,inspectionCamera:{...inspectionCamera,roomId:other.id}},{...base,inspectionCamera,sequence:2},{...base,inspectionCamera,url:'https://example.org/'}])expect(()=>checkedSceneSnapshotRequest(value,s.frame)).toThrow();
 const presentation=s.frame.draft.candidate.extensions!['org.exhibitos.studio/presentation'] as unknown as {viewpoints:{roomId:string}[]};presentation.viewpoints[0]!.roomId=other.id;
 expect(()=>checkedSceneSnapshotRequest(s.request,s.frame)).toThrow('SCENE_SNAPSHOT_TARGET_INVALID');
});
