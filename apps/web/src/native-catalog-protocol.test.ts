// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {artworkThumbnailFailure,artworkThumbnailFailureV2,checkedCatalogRequest,SerialThumbnailQueue} from './native-catalog-protocol';
const id=()=>crypto.randomUUID();
const frame=():NativeViewportFrame=>({version:1,epoch:id(),sequence:3,tenantId:id(),principalId:id(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
const binding=(f:NativeViewportFrame)=>({version:1 as const,epoch:f.epoch,sequence:f.sequence,tenantId:f.tenantId,principalId:f.principalId,requestId:id()});
it('binds thumbnail identity/revision to the exact enabled account frame and denies URL or future envelopes',()=>{
 const f=frame(),request={...binding(f),artworkId:id(),expectedRevision:2},before=structuredClone(f);
 expect(checkedCatalogRequest(request,f,'thumbnail')).toEqual(request);
 for(const value of [{...request,url:'https://example.test/private'},{...request,expectedRevision:0},{...request,expectedRevision:2.5},{...request,expectedRevision:2147483648},{...request,epoch:id()},{...request,principalId:id()},{...request,tenantId:id()},{...request,sequence:2},{...request,version:2}])expect(()=>checkedCatalogRequest(value,f,'thumbnail')).toThrow();
 expect(()=>checkedCatalogRequest(request,{...f,disabled:true},'thumbnail')).toThrow();expect(f).toEqual(before);
});
it('Find accepts only the exact selected existing placement in 3D and never changes the draft or camera frame',()=>{
 const f=frame(),placementId=id();f.draft.candidate.placements.push({id:placementId} as never);f.selection={kind:'placement',id:placementId};const request={...binding(f),selection:{kind:'placement' as const,id:placementId}},before=structuredClone(f);
 expect(checkedCatalogRequest(request,f,'find')).toEqual(request);
 for(const state of [{...f,selection:null},{...f,presentation:'plan' as const},{...f,draft:{...f.draft,candidate:{...f.draft.candidate,placements:[]}} as typeof f.draft}])expect(()=>checkedCatalogRequest(request,state,'find')).toThrow();
 expect(()=>checkedCatalogRequest({...request,selection:{kind:'artwork',id:placementId}},f,'find')).toThrow();expect(()=>checkedCatalogRequest({...request,selection:{kind:'placement',id:id()}},f,'find')).toThrow();expect(f).toEqual(before);
});
it('serializes thumbnail resource ownership and rejects excess work without starting another renderer',async()=>{
 const queue=new SerialThumbnailQueue();let release!:()=>void,running=0,max=0;const order:number[]=[];const gate=new Promise<void>(r=>release=r);
 const tasks=[0,1,2,3].map(n=>queue.run(async()=>{running++;max=Math.max(max,running);order.push(n);if(n===0)await gate;running--;return n;}));
 await expect(queue.run(async()=>99)).rejects.toThrow('THUMBNAIL_BUSY');release();expect(await Promise.all(tasks)).toEqual([0,1,2,3]);expect(order).toEqual([0,1,2,3]);expect(max).toBe(1);
});

it('reports only a bounded outcome and distinguishes the winning deadline from owner cancellation',()=>{
 const owner=new AbortController(),deadline=new AbortController();
 const signal=AbortSignal.any([owner.signal,deadline.signal]);
 owner.abort(Error('private owner information'));deadline.abort(new DOMException('private deadline information','TimeoutError'));
 expect(artworkThumbnailFailure('decode',signal.reason,signal,deadline.signal)).toEqual({
  thumbnailFailure:{version:1,phase:'decode',outcome:'cancelled'},
 });
 const timed=AbortSignal.any([new AbortController().signal,deadline.signal]);
 expect(artworkThumbnailFailure('render',timed.reason,timed,deadline.signal)).toEqual({
  thumbnailFailure:{version:1,phase:'render',outcome:'timeout'},
 });
 expect(artworkThumbnailFailure('encode',Error('private unclassified failure'),timed,deadline.signal)).toEqual({
  thumbnailFailure:{version:1,phase:'encode',outcome:'failed'},
 });
 expect(artworkThumbnailFailure('verification',Error('THUMBNAIL_REVISION')).thumbnailFailure.outcome).toBe('rejected');
 expect(artworkThumbnailFailure('queue',Error('THUMBNAIL_BUSY')).thumbnailFailure.outcome).toBe('busy');
 expect(artworkThumbnailFailureV2(artworkThumbnailFailure('queue',Error('THUMBNAIL_BUSY')),'metadata')).toEqual({
  thumbnailFailure:{version:2,phase:'queue',outcome:'busy'},
 });
});
