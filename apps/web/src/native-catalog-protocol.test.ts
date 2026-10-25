// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedCatalogRequest,SerialThumbnailQueue} from './native-catalog-protocol';
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
 for(const state of [{...f,selection:null},{...f,presentation:'plan' as const},{...f,draft:{...f.draft,candidate:{...f.draft.candidate,placements:[]}}}])expect(()=>checkedCatalogRequest(request,state,'find')).toThrow();
 expect(()=>checkedCatalogRequest({...request,selection:{kind:'artwork',id:placementId}},f,'find')).toThrow();expect(()=>checkedCatalogRequest({...request,selection:{kind:'placement',id:id()}},f,'find')).toThrow();expect(f).toEqual(before);
});
it('serializes thumbnail resource ownership and rejects excess work without starting another renderer',async()=>{
 const queue=new SerialThumbnailQueue();let release!:()=>void,running=0,max=0;const order:number[]=[];const gate=new Promise<void>(r=>release=r);
 const tasks=[0,1,2,3].map(n=>queue.run(async()=>{running++;max=Math.max(max,running);order.push(n);if(n===0)await gate;running--;return n;}));
 await expect(queue.run(async()=>99)).rejects.toThrow('THUMBNAIL_BUSY');release();expect(await Promise.all(tasks)).toEqual([0,1,2,3]);expect(order).toEqual([0,1,2,3]);expect(max).toBe(1);
});
