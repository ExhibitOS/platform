// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {produceArtworkThumbnail} from './native-artwork-thumbnail';

afterEach(()=>vi.unstubAllGlobals());
it('centers small approved images without enlargement and shrinks large images',async()=>{
 const id='10000000-0000-4000-8000-000000000001',draw=vi.fn(),close=vi.fn();let width=40,height=20;
 const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);new DataView(bytes.buffer).setUint32(16,40);new DataView(bytes.buffer).setUint32(20,20);
 const canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect:vi.fn(),drawImage:draw}),toBlob:(callback:(value:Blob)=>void)=>callback(new Blob([bytes],{type:'image/png'}))};
 vi.stubGlobal('document',{createElement:()=>canvas});vi.stubGlobal('createImageBitmap',async()=>({width,height,close}));
 vi.stubGlobal('fetch',async(input:string)=>input.includes('/preview?')?new Response(bytes,{headers:{'content-type':'image/png','x-exhibitos-artwork-revision':'1','x-exhibitos-display-copy':'true','x-exhibitos-watermark-mode':'none','x-exhibitos-watermarked':'false'}}):Response.json(input.endsWith('/display')?{id,revision:1}:{id,revision:1,approvedRevision:1,approvedAssetId:id,archived:false}));
 const request={version:1 as const,epoch:id,sequence:1,tenantId:id,principalId:id,requestId:id,artworkId:id,expectedRevision:1};
 await produceArtworkThumbnail(request,new AbortController().signal);expect(draw).toHaveBeenLastCalledWith(expect.anything(),108,118,40,20);expect(close).toHaveBeenCalledTimes(1);
 width=1024;height=512;await produceArtworkThumbnail(request,new AbortController().signal);expect(draw).toHaveBeenLastCalledWith(expect.anything(),0,64,256,128);expect(close).toHaveBeenCalledTimes(2);
});
