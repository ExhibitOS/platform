// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';
const tenant='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000003';
const descriptor:WorkspaceFurnishingDescriptor={id,version:1,kind:'bench',name:'Synthetic',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)}};
it('pins owner catalog data and opens only the same-origin versioned model',async()=>{
 const fetcher=vi.fn(async(path:RequestInfo|URL,_init?:RequestInit)=>String(path).endsWith('/display-check')?Response.json(descriptor):new Response('model',{headers:{'content-type':'model/gltf-binary'}})),controller=new AbortController(),source=ownerWorkspaceModelSource(new OwnerPreviewBudget(tenant,fetcher,256,1000000),descriptor,controller.signal);await source.check();await source.open(controller.signal);expect(fetcher.mock.calls.map(([path])=>path)).toEqual([`/api/v1/tenants/${tenant}/workspace/furnishings/${id}/versions/1/display-check`,`/api/v1/tenants/${tenant}/workspace/furnishings/${id}/versions/1/model`]);for(const call of fetcher.mock.calls)expect(call[1]).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'});
});
it('rejects changed, unavailable or oversized authority and never accepts a draft URL',async()=>{
 for(const result of [Response.json({...descriptor,name:'Changed'}),new Response('',{status:403}),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}})]){const fetcher=vi.fn(async()=>result),source=ownerWorkspaceModelSource(new OwnerPreviewBudget(tenant,fetcher,256,1000000),descriptor,new AbortController().signal);await expect(source.check()).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();}
 expect(()=>ownerWorkspaceModelSource(new OwnerPreviewBudget('../other',fetch,256,1000000),descriptor,new AbortController().signal)).toThrow('WORKSPACE_MODEL_AUTHORITY');
});
it('cancels a pending authority response on owner preview teardown',async()=>{
 const cancel=vi.fn(),controller=new AbortController(),source=ownerWorkspaceModelSource(new OwnerPreviewBudget(tenant,vi.fn(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}})),256,1000000),descriptor,controller.signal);const pending=source.check();await vi.waitFor(()=>expect(controller.signal.aborted).toBe(false));controller.abort();await expect(pending).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
});
