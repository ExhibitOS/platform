// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createNativeThumbnailHost} from './native-thumbnail-host';
const id='10000000-0000-4000-8000-000000000001',origin='http://127.0.0.1:13200';
const request={version:1,origin,requestId:id,epoch:id,tenantId:id,principalId:id,artworkId:id,expectedRevision:1};
const session={tenantId:id,userId:id,role:'artist',csrfToken:'private-token',expiresAt:'2099-01-01T00:00:00Z'};
const png=(()=>{const bytes=new Uint8Array(33),v=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,16);v.setUint32(20,8);return btoa(String.fromCharCode(...bytes));})();
const location=()=>({origin,pathname:'/native-thumbnail.html',search:'',hash:''});
const image={pngBase64:png,width:16,height:8};
it('binds the response to one request and does not expose the session token',async()=>{
 const fetcher=vi.fn(async()=>Response.json(session)),produce=vi.fn(async()=>image),host=createNativeThumbnailHost({location,fetcher:fetcher as typeof fetch,produce});
 const result=await host.produce(request);expect(result).toEqual({...request,...image});expect(JSON.stringify(result)).not.toContain(session.csrfToken);expect(fetcher).toHaveBeenCalledTimes(2);expect(produce).toHaveBeenCalledTimes(1);
 await expect(host.produce(request)).rejects.toThrow('THUMBNAIL_REQUEST');
 const mixed={...request,requestId:'abcdef00-0000-4000-8000-000000000001'};await host.produce(mixed);await expect(host.produce({...mixed,requestId:mixed.requestId.toUpperCase()})).rejects.toThrow('THUMBNAIL_REQUEST');
});
it('rejects an invalid origin, changed session and invalid result',async()=>{
 const changed=vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json({...session,csrfToken:'changed'}));
 const host=createNativeThumbnailHost({location,fetcher:changed as typeof fetch,produce:async()=>image});
 await expect(host.produce({...request,origin:'http://example.invalid'})).rejects.toThrow('THUMBNAIL_ORIGIN');
 await expect(host.produce(request)).rejects.toThrow('THUMBNAIL_SESSION');
 const bad=createNativeThumbnailHost({location,fetcher:(async()=>Response.json(session)) as typeof fetch,produce:async()=>({...image,width:17})});await expect(bad.produce(request)).rejects.toThrow('THUMBNAIL_RESULT');
});
it('refuses concurrent work and holds cleanup until the active producer settles',async()=>{
 let finish:(value:typeof image)=>void=()=>{};const producer=new Promise<typeof image>(resolve=>{finish=resolve;}),host=createNativeThumbnailHost({location,fetcher:(async()=>Response.json(session)) as typeof fetch,produce:()=>producer});
 const first=host.produce(request);await new Promise(resolve=>setTimeout(resolve,0));await expect(host.produce({...request,requestId:'20000000-0000-4000-8000-000000000002'})).rejects.toThrow('THUMBNAIL_BUSY');
 let disposed=false;const drain=host.dispose().then(()=>{disposed=true;});let settled=false;void first.catch(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);expect(disposed).toBe(false);finish(image);await expect(first).rejects.toThrow();await drain;expect(disposed).toBe(true);await expect(host.produce(request)).rejects.toThrow('THUMBNAIL_DISPOSED');
});
