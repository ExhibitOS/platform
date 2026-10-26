// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedPlacementRequest,placementFrameCompatible,type PlacementBegin} from './native-placement-protocol';
import {approvedPlacementArtwork} from './native-placement-source';
import {syntheticArtwork} from './placement/model';
const id=()=>crypto.randomUUID();
const frame=():NativeViewportFrame=>({version:1,epoch:id(),sequence:3,tenantId:id(),principalId:id(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
const begin=(f:NativeViewportFrame):PlacementBegin=>({version:1,epoch:f.epoch,sequence:f.sequence,tenantId:f.tenantId,principalId:f.principalId,requestId:id(),phase:'begin',artworkId:id(),expectedRevision:2,placementId:id(),roomId:f.draft.candidate.rooms[0]!.id,targetKind:'wall'});
afterEach(()=>vi.unstubAllGlobals());
it('admits an explicit approved source not yet in exhibition inventory without accepting a snapshot or URL',()=>{
 const f=frame(),r=begin(f),before=structuredClone(f);expect(f.draft.candidate.artworks).toHaveLength(0);expect(checkedPlacementRequest(r,f)).toEqual(r);
 for(const bad of [{...r,url:'https://example.test/file'},{...r,artwork:{}},{...r,assetId:id()},{...r,expectedRevision:id()},{...r,expectedRevision:0},{...r,expectedRevision:2147483648},{...r,roomId:id()}])expect(()=>checkedPlacementRequest(bad,f)).toThrow();
 expect(f).toEqual(before);
});
it('rejects stale account/frame, plan/disabled state, and replacement of an existing placement identity',()=>{
 const f=frame(),r=begin(f);
 for(const bad of [{...r,epoch:id()},{...r,sequence:2},{...r,tenantId:id()},{...r,principalId:id()}])expect(()=>checkedPlacementRequest(bad,f)).toThrow();
 expect(()=>checkedPlacementRequest(r,{...f,presentation:'plan'})).toThrow();expect(()=>checkedPlacementRequest(r,{...f,disabled:true})).toThrow();
 f.draft.candidate.placements.push({id:r.placementId} as never);expect(()=>checkedPlacementRequest(r,f)).toThrow();
});
it('commit/cancel use the original intent identity and a fresh bound request, with no arbitrary pose',()=>{
 const f=frame(),r=begin(f),{artworkId,expectedRevision,placementId,roomId,targetKind,...common}=r;
 const commit={...common,requestId:id(),phase:'commit',placementRequestId:r.requestId,targetToken:id()};expect(checkedPlacementRequest(commit,f)).toEqual(commit);
 expect(()=>checkedPlacementRequest({...commit,transform:{}},f)).toThrow();expect(()=>checkedPlacementRequest({...commit,targetToken:null},f)).toThrow();
 const cancel={...common,requestId:id(),phase:'cancel',placementRequestId:r.requestId};expect(checkedPlacementRequest(cancel,f)).toEqual(cancel);
 expect(()=>checkedPlacementRequest({...cancel,targetToken:id()},f)).toThrow();
});
it('sequence-only same canonical frames rebind while draft, camera, selection and scope changes invalidate',()=>{
 const f=frame();expect(placementFrameCompatible(f,{...f,sequence:4})).toBe(true);
 for(const next of [{...f,draft:structuredClone(f.draft)},{...f,cameraSequence:1},{...f,view:'top' as const},{...f,presentation:'plan' as const},{...f,mode:'rotate' as const},{...f,disabled:true},{...f,epoch:id()},{...f,sequence:2},{...f,selection:{kind:'room' as const,id:f.draft.candidate.rooms[0]!.id}}])expect(placementFrameCompatible(f,next)).toBe(false);
});
it('reads only the existing authenticated approved snapshot route and checks the CMS integer binding',async()=>{
 const f=frame(),r=begin(f),art=syntheticArtwork('image');art.id=r.artworkId;art.extensions={'org.exhibitos.studio/cms':{tenantId:r.tenantId,artworkId:r.artworkId,revision:r.expectedRevision}};
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({artwork:art}));vi.stubGlobal('fetch',fetcher);
 expect(await approvedPlacementArtwork(r,new AbortController().signal)).toEqual(art);
 expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/tenants/${r.tenantId}/studio/artworks/${r.artworkId}`);
 const denied=structuredClone(art);(denied.extensions!['org.exhibitos.studio/cms'] as {revision:number}).revision++;
 fetcher.mockImplementation(async()=>Response.json({artwork:denied}));await expect(approvedPlacementArtwork(r,new AbortController().signal)).rejects.toThrow('PLACEMENT_APPROVAL_CHANGED');
 fetcher.mockImplementation(async()=>new Response(null,{status:403}));await expect(approvedPlacementArtwork(r,new AbortController().signal)).rejects.toThrow('PLACEMENT_APPROVAL_UNAVAILABLE');
});
