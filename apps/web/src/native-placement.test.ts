// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import {whiteCubeSurfaces} from './geometry/model';
import {syntheticArtwork} from './placement/model';
import {NativePlacement} from './native-placement';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {PlacementBegin} from './native-placement-protocol';
function sample(){
 let frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:3,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false};
 const room=frame.draft.candidate.rooms[0]!;frame.draft.candidate.surfaces=whiteCubeSurfaces(room);
 const artwork=syntheticArtwork('image'),surface=frame.draft.candidate.surfaces.find(s=>s.type==='wall')!;
 const request:PlacementBegin={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),phase:'begin',artworkId:artwork.id,expectedRevision:2,placementId:crypto.randomUUID(),roomId:room.id,targetKind:'wall'};
 const source=vi.fn(async()=>structuredClone(artwork)),authenticate=vi.fn(async()=>{}),notify=vi.fn(),target=vi.fn(),cancelled=vi.fn();
 const placement=new NativePlacement({frame:()=>frame,source,authenticate,notify,target,cancelled});
 const bound=(phase:'commit'|'cancel')=>({version:1 as const,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),phase,placementRequestId:request.requestId});
 return {placement,request,artwork,surface,source,authenticate,target,cancelled,bound,frame:()=>frame,rebind:(next:NativeViewportFrame)=>{frame=next;placement.rebind(next);}};
}
it('returns one checked Placement after begin and commit rights/auth refresh, without changing host inventory or history',async()=>{
 const s=sample(),before=structuredClone(s.frame());await s.placement.request(s.request);s.placement.choose(s.surface.id,[0,0]);const token=s.placement.snapshot()!.target!.token;
 const result=await s.placement.request({...s.bound('commit'),targetToken:token});
 expect(Object.keys(result).sort()).toEqual(['accepted','epoch','phase','placementRequestId','principalId','requestId','sequence','targetToken','tenantId','validatedPlacement','version'].sort());
 expect(result).toMatchObject({phase:'commit',accepted:true,targetToken:token,validatedPlacement:{id:s.request.placementId,roomId:s.request.roomId,artworkRevisionId:s.artwork.revisionId,assetId:s.artwork.primaryAssetId}});
 expect(s.source).toHaveBeenCalledTimes(2);expect(s.authenticate).toHaveBeenCalledTimes(4);expect(s.frame()).toEqual(before);expect(s.placement.active).toBe(false);
 await expect(s.placement.request({...s.bound('commit'),targetToken:token})).rejects.toThrow('PLACEMENT_TARGET_STALE');
});
it('an invalid click clears every actionable target field and invalidates the previous token',async()=>{
 const s=sample();await s.placement.request(s.request);s.placement.choose(s.surface.id,[0,0]);const token=s.placement.snapshot()!.target!.token;
 s.placement.choose(s.surface.id,[999,0]);expect(s.target.mock.calls.at(-1)?.[1]).toMatchObject({valid:false,targetToken:null,surfaceId:null,offset:null});
 expect(s.placement.snapshot()!.target).toBeNull();await expect(s.placement.request({...s.bound('commit'),targetToken:token})).rejects.toThrow('PLACEMENT_TARGET_STALE');expect(s.source).toHaveBeenCalledTimes(1);
});
it('same canonical sequence-only rebinding keeps the selected target, while a real camera change cancels it',async()=>{
 const s=sample();await s.placement.request(s.request);s.placement.choose(s.surface.id,[0,0]);const token=s.placement.snapshot()!.target!.token;
 s.rebind({...s.frame(),sequence:4});expect(s.placement.snapshot()!.target!.token).toBe(token);
 s.rebind({...s.frame(),sequence:5,cameraSequence:1});expect(s.placement.active).toBe(false);expect(s.cancelled).toHaveBeenCalledTimes(1);
});
it('cancellation during the approved-source fetch fences late completion and remains an idempotent bound cancel',async()=>{
 const s=sample();let release!:(value:typeof s.artwork)=>void;s.source.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const pending=s.placement.request(s.request),rejection=expect(pending).rejects.toThrow();await vi.waitFor(()=>expect(s.source).toHaveBeenCalledTimes(1));
 s.placement.cancel('취소');release(s.artwork);await rejection;
 expect(s.placement.active).toBe(false);expect(s.target).not.toHaveBeenCalled();expect(s.cancelled).toHaveBeenCalledTimes(1);
 await expect(s.placement.request(s.bound('cancel'))).resolves.toMatchObject({phase:'cancel',accepted:true,placementRequestId:s.request.requestId});
});
it('changed or revoked source at commit cancels the ghost and cannot return a Placement',async()=>{
 const s=sample();await s.placement.request(s.request);s.placement.choose(s.surface.id,[0,0]);const token=s.placement.snapshot()!.target!.token;
 const changed=structuredClone(s.artwork);changed.metadata.description='New approval';s.source.mockResolvedValue(changed);
 await expect(s.placement.request({...s.bound('commit'),targetToken:token})).rejects.toThrow('PLACEMENT_APPROVAL_CHANGED');expect(s.placement.active).toBe(false);expect(s.cancelled).toHaveBeenCalledTimes(1);
});
it('request replay and a stale nonce cannot consume or replace a valid target',async()=>{
 const s=sample();await s.placement.request(s.request);s.placement.choose(s.surface.id,[0,0]);const target=s.placement.snapshot()!.target!;
 await expect(s.placement.request(s.request)).rejects.toThrow('PLACEMENT_REQUEST_REPLAY');await expect(s.placement.request({...s.bound('commit'),targetToken:crypto.randomUUID()})).rejects.toThrow('PLACEMENT_TARGET_STALE');
 expect(s.placement.snapshot()!.target).toBe(target);expect(s.source).toHaveBeenCalledTimes(1);
});
