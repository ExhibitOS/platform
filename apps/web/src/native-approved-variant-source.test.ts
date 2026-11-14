// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {BUDGET_GEOMETRY_PAIR_PROFILE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {expect,it,vi} from 'vitest';
import {readNativeApprovedVariant} from './native-approved-variant-source';

async function fixture(){
 const doc=(await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')))).exhibition,art=structuredClone(doc.artworks.find(a=>a.artworkType==='sculpture')!),full=art.assets.find(a=>a.id===art.primaryAssetId)!,coarse={...full,id:crypto.randomUUID(),bytes:1874704,sha256:'b'.repeat(64)},session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'curator',csrfToken:'synthetic',expiresAt:'2030-01-01T00:00:00Z'};
 full.bytes=16036864;coarse.path=`assets/${coarse.id}/model.glb`;art.assets=[full,coarse];art.extensions={...art.extensions,'org.exhibitos.studio/cms':{tenantId:session.tenantId,artworkId:art.id,revision:art.revision},[LOD_NAMESPACE]:{version:1,profile:BUDGET_GEOMETRY_PAIR_PROFILE,variants:[{assetId:full.id,detail:'full',triangles:100000,textureSize:2048},{assetId:coarse.id,detail:'coarse',triangles:20000,textureSize:512}]}};
 const body=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),url=`/api/v1/tenants/${session.tenantId}/cms/artworks/${art.id}/preview?expectedRevision=${art.revision}&assetId=${coarse.id}`,headers:Record<string,string>={'content-type':'model/gltf-binary','x-exhibitos-display-copy':'true','x-exhibitos-artwork-revision':String(art.revision),'x-exhibitos-artwork-asset-id':coarse.id};
 return {art,full,coarse,session,body,url,headers};
}
it('reads only the selected approved display source through the closed revision/asset URL',async()=>{
 const f=await fixture(),fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.credentials).toBe('same-origin');expect(init?.cache).toBe('no-store');expect(init?.redirect).toBe('error');
  if(String(input).endsWith(`/studio/artworks/${f.art.id}`))return Response.json({artwork:f.art});
  expect(input).toBe(f.url);return new Response(new Uint8Array(f.body),{headers:f.headers});
 });
 const result=await readNativeApprovedVariant(f.art,f.coarse,f.session,new AbortController().signal,fetcher);expect(new Uint8Array(result)).toEqual(new Uint8Array(f.body));expect(fetcher).toHaveBeenCalledTimes(2);
 // Logical source identity is bound by approval+headers; display bytes need
 // not hash as the private source inventory.
 expect(f.coarse.sha256).toBe('b'.repeat(64));
});
it.each(['asset','revision','mime','display-copy','denied'] as const)('rejects %s before accepting a display body',async failure=>{
 const f=await fixture(),headers={...f.headers};if(failure==='asset')headers['x-exhibitos-artwork-asset-id']=f.full.id;if(failure==='revision')headers['x-exhibitos-artwork-revision']=String(f.art.revision+1);if(failure==='mime')headers['content-type']='application/octet-stream';if(failure==='display-copy')headers['x-exhibitos-display-copy']='false';
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/studio/artworks/')?Response.json({artwork:f.art}):new Response(new Uint8Array(f.body),{headers,status:failure==='denied'?403:200}));
 await expect(readNativeApprovedVariant(f.art,f.coarse,f.session,new AbortController().signal,fetcher)).rejects.toThrow('DERIVATIVE_UNAVAILABLE');
});
it('rejects a changed approved inventory instead of labeling primary or stale bytes as the selected tier',async()=>{
 const f=await fixture(),changed=structuredClone(f.art);changed.assets[1]!.sha256='c'.repeat(64);const fetcher=vi.fn(async()=>Response.json({artwork:changed}));
 await expect(readNativeApprovedVariant(f.art,f.coarse,f.session,new AbortController().signal,fetcher)).rejects.toThrow('DERIVATIVE_REVISION_CHANGED');expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses primary, foreign and undeclared model reads through the selected branch',async()=>{
 const f=await fixture(),fetcher=vi.fn<typeof fetch>();
 await expect(readNativeApprovedVariant(f.art,f.full,f.session,new AbortController().signal,fetcher)).rejects.toThrow('DERIVATIVE_UNAVAILABLE');
 await expect(readNativeApprovedVariant(f.art,{...f.coarse,id:crypto.randomUUID()},f.session,new AbortController().signal,fetcher)).rejects.toThrow('DERIVATIVE_UNAVAILABLE');
 await expect(readNativeApprovedVariant(f.art,f.coarse,{...f.session,tenantId:crypto.randomUUID()},new AbortController().signal,fetcher)).rejects.toThrow('DERIVATIVE_UNAVAILABLE');expect(fetcher).not.toHaveBeenCalled();
});
it('cancels an in-flight selected body and cannot publish its stale result',async()=>{
 const f=await fixture(),controller=new AbortController();let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/studio/artworks/')?Response.json({artwork:f.art}):new Response(stream,{headers:f.headers}));
 const result=readNativeApprovedVariant(f.art,f.coarse,f.session,controller.signal,fetcher);const rejected=expect(result).rejects.toThrow();await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));controller.abort();await rejected;expect(cancelled).toBe(true);
});
