// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createPublicThumbnailCache,decodePublicThumbnail,publicThumbnailReserve} from './public-thumbnail';
function header(w:number,h:number){const b=new ArrayBuffer(33),v=new DataView(b);[137,80,78,71,13,10,26,10].forEach((x,i)=>v.setUint8(i,x));v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,w);v.setUint32(20,h);return b;}
it('makes an upright bounded preview and releases temporary allocations',async()=>{
 const close=vi.fn(),draw=vi.fn(),bitmap={width:256,height:128,close} as unknown as ImageBitmap,canvas={width:0,height:0,getContext:()=>({drawImage:draw}),toDataURL:()=> 'data:image/png;base64,cGl4ZWxz'} as unknown as HTMLCanvasElement;
 const value=await decodePublicThumbnail(header(256,128),new AbortController().signal,{bitmap:async()=>bitmap,canvas:()=>canvas});
 expect(value).toBe('data:image/png;base64,cGl4ZWxz');expect(draw).toHaveBeenCalledWith(bitmap,0,0,32,16);expect(close).toHaveBeenCalledOnce();expect([canvas.width,canvas.height]).toEqual([0,0]);
 expect(publicThumbnailReserve(64)).toBe(6*1024*1024);
});
it('rejects mismatched decode and closes late decoded data after cancellation',async()=>{
 const close=vi.fn(),controller=new AbortController();let resolve!:(value:ImageBitmap)=>void;
 const pending=decodePublicThumbnail(header(1,1),controller.signal,{bitmap:()=>new Promise(r=>{resolve=r;}),canvas:()=>({} as HTMLCanvasElement)});
 controller.abort();resolve({width:1,height:1,close} as unknown as ImageBitmap);await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(close).toHaveBeenCalledOnce();
 await expect(decodePublicThumbnail(header(257,1),new AbortController().signal)).rejects.toThrow('THUMBNAIL_INVALID');
});
it('shares one verified small source by artwork revision and clears on rights loss',async()=>{
 const publicationId='a0000000-0000-4000-8000-000000000001',assetId='b0000000-0000-4000-8000-000000000002',revision='c0000000-0000-4000-8000-000000000003',digest='d'.repeat(64),bytes=new Uint8Array([1,2,3]);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const artwork={revisionId:revision,primaryAssetId:'e0000000-0000-4000-8000-000000000004',assets:[{id:assetId,path:'preview.png',role:'preview',mime:'image/png',bytes:3,sha256:sha}],extensions:{'org.exhibitos.viewer/thumbnail':{version:1,assetId}}} as unknown as import('@exhibitos/spec').Artwork;
 let allowed=true;const changed=vi.fn(),fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/png','x-exhibitos-publication-revision':digest}}));
 const cache=createPublicThumbnailCache({publicationId,revisionSha256:digest,assets:[{assetId,url:`/api/v1/publications/${publicationId}/assets/${assetId}`,mime:'image/png'}],check:async()=>{if(!allowed)throw Error('rights');},fetcher:fetcher as typeof fetch,changed,decode:async()=> 'data:image/png;base64,cGl4ZWxz'});
 expect(await cache.loadOne(artwork)).toBe(true);expect(changed).toHaveBeenLastCalledWith({[revision]:'data:image/png;base64,cGl4ZWxz'});
 expect(await cache.loadOne(artwork)).toBe(false);expect(fetcher).toHaveBeenCalledOnce();allowed=false;expect(await cache.recheck()).toBe(false);expect(changed).toHaveBeenLastCalledWith({});expect(cache.canLoad(artwork)).toBe(false);cache.dispose();expect(await cache.recheck()).toBe(false);
});
it('backs off failed fetches and allows retry without keeping cancelled work',async()=>{
 const publicationId='a0000000-0000-4000-8000-000000000001',assetId='b0000000-0000-4000-8000-000000000002',revision='c0000000-0000-4000-8000-000000000003';
 const artwork={revisionId:revision,primaryAssetId:'e0000000-0000-4000-8000-000000000004',assets:[{id:assetId,path:'preview.png',role:'preview',mime:'image/png',bytes:3,sha256:'a'.repeat(64)}],extensions:{'org.exhibitos.viewer/thumbnail':{version:1,assetId}}} as unknown as import('@exhibitos/spec').Artwork;
 let now=0;const fetcher=vi.fn(async()=>new Response('',{status:503})),cache=createPublicThumbnailCache({publicationId,revisionSha256:'d'.repeat(64),assets:[{assetId,url:`/api/v1/publications/${publicationId}/assets/${assetId}`,mime:'image/png'}],check:async()=>{},fetcher:fetcher as typeof fetch,changed:()=>{},now:()=>now});
 expect(await cache.loadOne(artwork)).toBe(false);expect(cache.canLoad(artwork)).toBe(false);now=5000;expect(cache.canLoad(artwork)).toBe(true);
 const cancelled=new AbortController();cancelled.abort();expect(await cache.loadOne(artwork,cancelled.signal)).toBe(false);expect(cache.canLoad(artwork)).toBe(true);cache.dispose();
});
it('evicts only a revoked preview when the publication remains available',async()=>{
 const publicationId='a0000000-0000-4000-8000-000000000001',assetId='b0000000-0000-4000-8000-000000000002',revision='c0000000-0000-4000-8000-000000000003',bytes=new Uint8Array([1,2,3]);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const artwork={revisionId:revision,primaryAssetId:'e0000000-0000-4000-8000-000000000004',assets:[{id:assetId,path:'preview.png',role:'preview',mime:'image/png',bytes:3,sha256:sha}],extensions:{'org.exhibitos.viewer/thumbnail':{version:1,assetId}}} as unknown as import('@exhibitos/spec').Artwork;
 let ids=[assetId];const changed=vi.fn(),digest='d'.repeat(64),cache=createPublicThumbnailCache({publicationId,revisionSha256:digest,assets:[{assetId,url:`/api/v1/publications/${publicationId}/assets/${assetId}`,mime:'image/png'}],check:async()=>ids,fetcher:(async()=>new Response(bytes,{headers:{'content-type':'image/png','x-exhibitos-publication-revision':digest}})) as typeof fetch,changed,decode:async()=> 'data:image/png;base64,cGl4ZWxz'});
 expect(await cache.loadOne(artwork)).toBe(true);ids=[];expect(await cache.recheck()).toBe(true);expect(changed).toHaveBeenLastCalledWith({});expect(cache.canLoad(artwork)).toBe(false);cache.dispose();
});
