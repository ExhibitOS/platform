// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {WorkspaceFurnishingDescriptor,WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {publicWorkspaceModelSource} from './public-source';
const id='10000000-0000-4000-8000-000000000001',publicationId='20000000-0000-4000-8000-000000000002';
const descriptor:WorkspaceFurnishingDescriptor={id,version:1,kind:'pedestal',name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)}};
it('opens only the publication-bound model after current rights and publication checks',async()=>{
 const extension={version:1,furnishings:[descriptor],placements:[]} as WorkspaceFurnishings,asset={assetId:id,mime:'model/gltf-binary',url:`/api/v1/publications/${publicationId}/assets/${id}`},fetcher=vi.fn(async()=>new Response('ok',{headers:{'x-exhibitos-publication-revision':'f'.repeat(64)}})),check=vi.fn(async()=>{}),source=publicWorkspaceModelSource(publicationId,'f'.repeat(64),[asset],extension,descriptor,fetcher,check);
 await source.check();expect(check).toHaveBeenCalledOnce();await source.open(new AbortController().signal);expect(fetcher).toHaveBeenCalledWith(asset.url,expect.objectContaining({credentials:'omit',redirect:'error',cache:'no-store'}));
 expect(()=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),[{...asset,url:'https://untrusted.invalid/model'}],extension,descriptor,fetcher,check)).toThrow('WORKSPACE_MODEL_AUTHORITY');
 const denied={...extension,furnishings:[{...descriptor,rights:{permissions:{display:true,export:false}}}]};await expect(publicWorkspaceModelSource(publicationId,'f'.repeat(64),[asset],denied,denied.furnishings[0]!,fetcher,check).check()).rejects.toThrow('WORKSPACE_MODEL_AUTHORITY');
});

it('keeps pinned encoded bytes accounted until the decoder releases them after teardown',async()=>{
 const {MemoryAssetCache}=await import('../viewer/loading'),{PublicWorkspaceCache}=await import('./public-cache'),cache=new MemoryAssetCache<ArrayBuffer>(1024),scope=new PublicWorkspaceCache(cache),data=new ArrayBuffer(100);scope.put('publication-scoped',data);const held=scope.get('publication-scoped');expect(held?.bytes).toBe(data);scope.dispose();expect(cache.stats().bytes).toBe(100);held!.release();expect(cache.stats().bytes).toBe(0);
});
