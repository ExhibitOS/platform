// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {produceArtworkThumbnail,produceFurnishingThumbnail} from './native-artwork-thumbnail';
import {FURNISHING_THUMBNAIL_RECIPE,FURNISHING_THUMBNAIL_TOOL,type FurnishingThumbnailRequest} from './native-catalog-protocol';

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

it('refuses unapproved furnishing display or substituted model bytes before rendering',async()=>{
 const id='10000000-0000-4000-8000-000000000001',mime='model/gltf-binary',modelSha256='a'.repeat(64),modelBytes=28;
 const request={version:1 as const,epoch:id,sequence:1,tenantId:id,principalId:id,requestId:id,furnishingId:id,
  furnishingVersion:1 as const,modelSha256,modelBytes,recipeId:FURNISHING_THUMBNAIL_RECIPE,toolId:FURNISHING_THUMBNAIL_TOOL} satisfies FurnishingThumbnailRequest;
 const createElement=vi.fn();
 vi.stubGlobal('document',{createElement});
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:403}));
 vi.stubGlobal('fetch',fetcher);
 await expect(produceFurnishingThumbnail(request,new AbortController().signal)).rejects.toThrow('THUMBNAIL_UNAVAILABLE');
 expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockResolvedValueOnce(Response.json({id,version:1,model:{mime,sha256:modelSha256,bytes:modelBytes}}))
  .mockResolvedValueOnce(new Response(new Uint8Array(modelBytes),{headers:{'content-type':mime,'content-length':String(modelBytes),'x-exhibitos-sha256':modelSha256}}));
 await expect(produceFurnishingThumbnail(request,new AbortController().signal)).rejects.toThrow('THUMBNAIL_REVISION');
 expect(createElement).not.toHaveBeenCalled();
});
