// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {applyFurnishingCommand,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import type {Session} from '../cms-client';
import {authenticatedCatalogOtherSources,installCatalogOtherVisuals} from './catalog-bench-renderer';

afterEach(()=>vi.unstubAllGlobals());
async function fixture(){
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),doc=structuredClone(original.exhibition),light=doc.lights[0]!;
 light.type='spot';light.beamAngle=Math.PI/4;
 const candidate=applyFurnishingCommand(doc,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}});
 const session:Session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'curator',csrfToken:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()};
 const room=new three.Group(),fallback=new three.Group();room.add(fallback);
 const install=(items:ReturnType<typeof authenticatedCatalogOtherSources>)=>installCatalogOtherVisuals(three,items,new Map([[light.roomId.toLowerCase(),room]]),new Map([[light.id.toLowerCase(),[fallback]]]),new Map(),new AbortController().signal,()=>false,20000,()=>{});
 return {candidate,session,room,fallback,light,install};
}
it('loads a native authenticated non-bench model with verified bytes and restores its actual fallback',async()=>{
 const f=await fixture(),controller=new AbortController(),url=`/api/v1/tenants/${f.session.tenantId}/studio/furnishings/museum-track-spot/1/model`;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.credentials).toBe('same-origin');expect(init?.cache).toBe('no-store');expect(init?.redirect).toBe('error');
  if(input==='/api/v1/auth/session')return Response.json(f.session);
  expect(input).toBe(url);return new Response(await readFile(furnishingCatalogueEntry('museum-track-spot').path));
 });vi.stubGlobal('fetch',fetcher);
 const sources=authenticatedCatalogOtherSources(f.candidate,f.session,controller.signal);expect(sources).toHaveLength(1);expect(sources[0]!.source.revision).toBeUndefined();
 await expect(sources[0]!.source.fetcher('/foreign')).rejects.toThrow('CATALOG_SOURCE_INVALID');expect(fetcher).not.toHaveBeenCalled();
 const visual=f.install(sources);expect(visual.ready('light',f.light.id)).toBe(false);
 try{
  expect(await visual.start()).toEqual([{kind:'light',id:f.light.id,status:'ready'}]);expect(f.fallback.visible).toBe(false);expect(visual.ready('light',f.light.id)).toBe(true);
  f.room.visible=false;expect(visual.ready('light',f.light.id)).toBe(false);f.room.visible=true;
  expect(fetcher.mock.calls.filter(([input])=>input===url)).toHaveLength(1);
 }finally{visual.dispose();}
 expect(visual.ready('light',f.light.id)).toBe(false);expect(f.fallback.visible).toBe(true);expect(f.room.children).toEqual([f.fallback]);
 controller.abort();await expect(sources[0]!.source.check()).rejects.toThrow();
});
it.each(['expired','viewer','changed-session','denied','bad-bytes'] as const)('keeps the native fixture fallback for %s authority or source',async failure=>{
 const f=await fixture(),session={...f.session,...(failure==='expired'?{expiresAt:'2000-01-01T00:00:00Z'}:failure==='viewer'?{role:'viewer'}:{})};
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>input==='/api/v1/auth/session'?Response.json(failure==='changed-session'?{...session,tenantId:crypto.randomUUID()}:session):failure==='denied'?new Response(null,{status:403}):new Response(new Uint8Array([1,2,3])));vi.stubGlobal('fetch',fetcher);
 const sources=authenticatedCatalogOtherSources(f.candidate,session,new AbortController().signal);
 if(failure==='expired'||failure==='viewer'){expect(sources).toEqual([]);expect(fetcher).not.toHaveBeenCalled();return;}
 const visual=f.install(sources);try{expect(await visual.start()).toEqual([{kind:'light',id:f.light.id,status:'fallback'}]);expect(visual.ready('light',f.light.id)).toBe(false);expect(f.fallback.visible).toBe(true);expect(f.room.children).toEqual([f.fallback]);}finally{visual.dispose();}
 if(failure==='changed-session')expect(fetcher.mock.calls.every(([input])=>input==='/api/v1/auth/session')).toBe(true);
});
