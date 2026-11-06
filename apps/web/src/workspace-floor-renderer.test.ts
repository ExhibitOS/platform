// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {Session} from './cms-client';
import {createWorkspaceFloorRenderer,workspaceFloorFetcher,workspaceFloorPlan} from './workspace-floor-renderer';

const surface='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',tenant='33333333-3333-4333-8333-333333333333';
const scene=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:256,height:256,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}}) as unknown as Exhibition;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('plans a bounded registered floor texture and refuses an arbitrary URL',async()=>{
 const plan=workspaceFloorPlan(scene(),512,32*1024*1024),binding=plan.targets.get(surface)!;
 expect(binding.repeatMeters).toEqual([2,2]);expect(plan.packs).toHaveLength(1);expect(plan.registry[0]?.path).toBe(`workspace-materials/${id}/1/color-${'a'.repeat(64)}.png`);expect(plan.reserveBytes).toBeGreaterThan(plan.residentBytes);
 const request=vi.fn().mockResolvedValue(new Response('ok'));vi.stubGlobal('fetch',request);
 const session={tenantId:tenant} as Session,fetcher=workspaceFloorFetcher(plan,session),path='/'+plan.registry[0]!.path;
 await fetcher(path,{credentials:'omit'});expect(request).toHaveBeenCalledWith(`/api/v1/tenants/${tenant}/workspace/materials/${id}/versions/1/maps/color`,expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'error'}));
 await expect(fetcher('https://example.test/texture.png')).rejects.toThrow('WORKSPACE_MATERIAL_PATH');
 const blocked=workspaceFloorPlan(scene(),512,1);expect(blocked.packs).toEqual([]);expect(blocked.blocked).toEqual([id+':1']);
});
it('loads the owner-checked color bytes as sRGB and releases the texture',async()=>{
 const bytes=new Uint8Array([1,2,3]),document=scene(),extension=document.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:{color:{bytes:number;sha256:string}}}>};
 extension.materials[0]!.maps.color.bytes=bytes.length;extension.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const plan=workspaceFloorPlan(document,512,32*1024*1024),session={tenantId:tenant} as Session,material=new three.MeshStandardMaterial(),closed=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/png'}})));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(material.map?.colorSpace).toBe(three.SRGBColorSpace);expect(material.roughnessMap).toBeNull();}
 finally{renderer.dispose();material.dispose();}
 expect(closed).toHaveBeenCalledOnce();expect(material.map).toBeNull();
});
it('fetches equal bytes separately for distinct material authorities',async()=>{
 const bytes=new Uint8Array([1,2,3]),doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{id:string;maps:{color:{bytes:number;sha256:string}}}>;bindings:Array<{surfaceId:string;materialId:string;materialVersion:number;repeatMeters:number[];rotation:number}>};
 const otherId='44444444-4444-4444-8444-444444444444',otherSurface='55555555-5555-4555-8555-555555555555';
 value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');value.materials.push({...structuredClone(value.materials[0]!),id:otherId});value.bindings.push({surfaceId:otherSurface,materialId:otherId,materialVersion:1,repeatMeters:[2,2],rotation:0});(doc.surfaces as unknown as Array<{id:string;type:string}>).push({id:otherSurface,type:'floor'});
 const request=vi.fn(async(path:string)=>path.includes(otherId)?new Response(null,{status:403}):new Response(bytes,{headers:{'content-type':'image/png'}}));vi.stubGlobal('fetch',request);vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),a=new three.MeshStandardMaterial(),b=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(a,plan.targets.get(surface)!);renderer.add(b,plan.targets.get(otherSurface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready',[otherId+':1']:'fallback'});expect(request).toHaveBeenCalledTimes(2);expect(a.map).not.toBeNull();expect(b.map).toBeNull();}finally{renderer.dispose();a.dispose();b.dispose();}
});
it('drops expired textures on resume even if the timer was delayed',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const events=new EventTarget(),closed=vi.fn(),changed=vi.fn();vi.stubGlobal('document',events);vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);await renderer.start(changed);expect(material.map).not.toBeNull();vi.setSystemTime(new Date('2090-01-01T00:00:01Z'));events.dispatchEvent(new Event('visibilitychange'));expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalledTimes(2);}finally{renderer.dispose();material.dispose();}
});
it('does not publish a map whose grant expires during async decode',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const closed=vi.fn();vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));vi.stubGlobal('createImageBitmap',async()=>{vi.setSystemTime(new Date('2090-01-01T00:00:01Z'));return {width:256,height:256,close:closed};});
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'unavailable'});expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();}finally{renderer.dispose();material.dispose();}
});
it('plans rectangular and square maps together with aspect-preserving sizes',()=>{
 const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{id:string;maps:{color:{width:number;height:number}}}>;bindings:Array<{surfaceId:string;materialId:string;materialVersion:number;repeatMeters:number[];rotation:number}>},otherId='44444444-4444-4444-8444-444444444444',otherSurface='55555555-5555-4555-8555-555555555555';
 value.materials[0]!.maps.color.height=128;value.materials.push({...structuredClone(value.materials[0]!),id:otherId,maps:{color:{...value.materials[0]!.maps.color,height:256}}});value.bindings.push({surfaceId:otherSurface,materialId:otherId,materialVersion:1,repeatMeters:[2,2],rotation:0});(doc.surfaces as unknown as Array<{id:string;type:string}>).push({id:otherSurface,type:'floor'});
 const plan=workspaceFloorPlan(doc,512,32*1024*1024);expect(plan.packs).toHaveLength(2);expect(plan.blocked).toEqual([]);expect(plan.sizeFor(plan.registry[0]!)).toBe(256);
});
it('keeps rectangular aspect ratio while resizing for the texture budget',async()=>{
 const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:{color:{width:number;height:number;bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]),map=value.materials[0]!.maps.color;
 map.width=512;map.height=256;map.bytes=bytes.length;map.sha256=createHash('sha256').update(bytes).digest('hex');
 const closed=vi.fn(),decode=vi.fn(async(_source:unknown,options?:{resizeWidth?:number;resizeHeight?:number})=>({width:options?.resizeWidth??512,height:options?.resizeHeight??256,close:closed}));
 vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));vi.stubGlobal('createImageBitmap',decode);
 const plan=workspaceFloorPlan(doc,256,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(decode).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({resizeWidth:256,resizeHeight:128}));expect(material.map?.image).toMatchObject({width:256,height:128});}finally{renderer.dispose();material.dispose();}
 expect(closed).toHaveBeenCalledTimes(2);
});
it('removes and disposes a mounted map at the expiry timer',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const closed=vi.fn();vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);await renderer.start(()=>{});expect(material.map).not.toBeNull();vi.advanceTimersByTime(1000);expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();}finally{renderer.dispose();material.dispose();}
});
