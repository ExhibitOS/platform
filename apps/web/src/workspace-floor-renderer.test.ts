// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {Session} from './cms-client';
import {createWorkspaceFloorRenderer,createPublicWorkspaceFloorRenderer,workspaceFloorFetcher,workspaceFloorPlan} from './workspace-floor-renderer';

const surface='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',tenant='33333333-3333-4333-8333-333333333333';
const scene=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:256,height:256,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}}) as unknown as Exhibition;
const ownerFetch=(doc:Exhibition,bytes:Uint8Array,denied?:string)=>vi.fn(async(path:string)=>{if(denied&&path.includes(denied))return new Response(null,{status:403});if(path.endsWith('/maps/color'))return new Response(new Uint8Array(bytes),{headers:{'content-type':'image/png'}});const materials=(doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{id:string}>}).materials,material=materials.find(m=>path.includes(m.id));return new Response(JSON.stringify(material),{headers:{'content-type':'application/json'}});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('plans a bounded registered floor texture and refuses an arbitrary URL',async()=>{
 const doc=scene(),plan=workspaceFloorPlan(doc,512,32*1024*1024),binding=plan.targets.get(surface)!;
 expect(binding.repeatMeters).toEqual([2,2]);expect(plan.packs).toHaveLength(1);expect(plan.registry[0]?.path).toBe(`workspace-materials/${id}/1/color-${'a'.repeat(64)}.png`);expect(plan.reserveBytes).toBeGreaterThan(plan.residentBytes);
 const request=ownerFetch(doc,new Uint8Array([1]));vi.stubGlobal('fetch',request);
 const session={tenantId:tenant} as Session,fetcher=workspaceFloorFetcher(plan,session),path='/'+plan.registry[0]!.path;
 await fetcher(path,{credentials:'omit'});expect(request).toHaveBeenCalledWith(`/api/v1/tenants/${tenant}/workspace/materials/${id}/versions/1/maps/color`,expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'error'}));
 await expect(fetcher('https://example.test/texture.png')).rejects.toThrow('WORKSPACE_MATERIAL_PATH');
 const blocked=workspaceFloorPlan(scene(),512,1);expect(blocked.packs).toEqual([]);expect(blocked.blocked).toEqual([id+':1']);
});
it('loads the owner-checked color bytes as sRGB and releases the texture',async()=>{
 const bytes=new Uint8Array([1,2,3]),document=scene(),extension=document.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:{color:{bytes:number;sha256:string}}}>};
 extension.materials[0]!.maps.color.bytes=bytes.length;extension.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const plan=workspaceFloorPlan(document,512,32*1024*1024),session={tenantId:tenant} as Session,material=new three.MeshStandardMaterial(),closed=vi.fn();
 vi.stubGlobal('fetch',ownerFetch(document,bytes));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(material.map?.colorSpace).toBe(three.SRGBColorSpace);expect(material.roughnessMap).toBeNull();}
 finally{renderer.dispose();material.dispose();}
 expect(closed).toHaveBeenCalledOnce();expect(material.map).toBeNull();
});
it('fetches equal bytes separately for distinct material authorities',async()=>{
 const bytes=new Uint8Array([1,2,3]),doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{id:string;maps:{color:{bytes:number;sha256:string}}}>;bindings:Array<{surfaceId:string;materialId:string;materialVersion:number;repeatMeters:number[];rotation:number}>};
 const otherId='44444444-4444-4444-8444-444444444444',otherSurface='55555555-5555-4555-8555-555555555555';
 value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');value.materials.push({...structuredClone(value.materials[0]!),id:otherId});value.bindings.push({surfaceId:otherSurface,materialId:otherId,materialVersion:1,repeatMeters:[2,2],rotation:0});(doc.surfaces as unknown as Array<{id:string;type:string}>).push({id:otherSurface,type:'floor'});
 const request=ownerFetch(doc,bytes,otherId);vi.stubGlobal('fetch',request);vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),a=new three.MeshStandardMaterial(),b=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(a,plan.targets.get(surface)!);renderer.add(b,plan.targets.get(otherSurface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready',[otherId+':1']:'fallback'});expect(request).toHaveBeenCalledTimes(3);expect(a.map).not.toBeNull();expect(b.map).toBeNull();}finally{renderer.dispose();a.dispose();b.dispose();}
});
it.each(['omitted','extended'])('refuses a candidate with an %s registered expiry',async change=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),server=structuredClone(doc),bytes=new Uint8Array([1,2,3]);
 const candidate=(doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>}).materials[0]!,registered=(server.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<typeof candidate>}).materials[0]!;
 for(const m of [candidate,registered]){m.maps.color.bytes=bytes.length;m.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');}registered.rights.expiresAt='2090-01-01T00:00:00Z';if(change==='extended')candidate.rights.expiresAt='2091-01-01T00:00:00Z';
 const request=ownerFetch(server,bytes);vi.stubGlobal('fetch',request);vi.stubGlobal('createImageBitmap',vi.fn());const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'fallback'});expect(request).toHaveBeenCalledOnce();expect(material.map).toBeNull();}finally{renderer.dispose();material.dispose();}
});
it('drops expired textures on resume even if the timer was delayed',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const events=new EventTarget(),closed=vi.fn(),changed=vi.fn();vi.stubGlobal('document',events);vi.stubGlobal('fetch',ownerFetch(doc,bytes));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);await renderer.start(changed);expect(material.map).not.toBeNull();vi.setSystemTime(new Date('2090-01-01T00:00:01Z'));events.dispatchEvent(new Event('visibilitychange'));expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalledTimes(2);}finally{renderer.dispose();material.dispose();}
});
it('does not publish a map whose grant expires during async decode',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const closed=vi.fn();vi.stubGlobal('fetch',ownerFetch(doc,bytes));vi.stubGlobal('createImageBitmap',async()=>{vi.setSystemTime(new Date('2090-01-01T00:00:01Z'));return {width:256,height:256,close:closed};});
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
 vi.stubGlobal('fetch',ownerFetch(doc,bytes));vi.stubGlobal('createImageBitmap',decode);
 const plan=workspaceFloorPlan(doc,256,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(decode).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({resizeWidth:256,resizeHeight:128}));expect(material.map?.image).toMatchObject({width:256,height:128});}finally{renderer.dispose();material.dispose();}
 expect(closed).toHaveBeenCalledTimes(2);
});
it('removes and disposes a mounted map at the expiry timer',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const closed=vi.fn();vi.stubGlobal('fetch',ownerFetch(doc,bytes));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);await renderer.start(()=>{});expect(material.map).not.toBeNull();vi.advanceTimersByTime(1000);expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();}finally{renderer.dispose();material.dispose();}
});

it('loads a registered wall color texture through the same private owner checks',async()=>{
 const bytes=new Uint8Array([1,2,3]),doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{kind:string;maps:{color:{bytes:number;sha256:string}}}>};(doc.surfaces[0] as {type:string}).type='wall';value.materials[0]!.kind='wall';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 vi.stubGlobal('fetch',ownerFetch(doc,bytes));vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(material.map?.colorSpace).toBe(three.SRGBColorSpace);}finally{renderer.dispose();material.dispose();}
});

it('public material uses the declared asset and removes its texture at expiry',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2089-12-31T23:59:59Z'));const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{expiresAt?:string};maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);
 value.materials[0]!.rights.expiresAt='2090-01-01T00:00:00Z';value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const revision='b'.repeat(64),publication='44444444-4444-4444-8444-444444444444',url=`/api/v1/publications/${publication}/assets/${id}`,fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/png','x-exhibitos-publication-revision':revision}})),check=vi.fn(async()=>{}),closed=vi.fn();
 vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:closed}));const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{publicationId:publication,revisionSha256:revision,assets:[{assetId:id,mime:'image/png',url}],fetcher,check});
 try{renderer.add(material,plan.targets.get(surface)!);await renderer.start(()=>{});expect(material.map).not.toBeNull();expect(fetcher).toHaveBeenCalledWith(url,expect.objectContaining({credentials:'omit'}));vi.setSystemTime(new Date('2090-01-01T00:00:00Z'));renderer.enforce();expect(material.map).toBeNull();expect(closed).toHaveBeenCalledOnce();}finally{renderer.dispose();material.dispose();}
});

it('does not show a decoded public map when the publication is withdrawn during decode',async()=>{
 const doc=scene(),value=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:{color:{bytes:number;sha256:string}}}>},bytes=new Uint8Array([1,2,3]);value.materials[0]!.maps.color.bytes=bytes.length;value.materials[0]!.maps.color.sha256=createHash('sha256').update(bytes).digest('hex');
 const revision='b'.repeat(64),publication='44444444-4444-4444-8444-444444444444',url=`/api/v1/publications/${publication}/assets/${id}`;let withdrawn=false;const changed=vi.fn(),closed=vi.fn(),check=vi.fn(async()=>{if(withdrawn)throw Error('withdrawn');}),fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/png','x-exhibitos-publication-revision':revision}}));
 vi.stubGlobal('createImageBitmap',async()=>{withdrawn=true;return {width:256,height:256,close:closed};});const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{publicationId:publication,revisionSha256:revision,assets:[{assetId:id,mime:'image/png',url}],fetcher,check});
 try{renderer.add(material,plan.targets.get(surface)!);await expect(renderer.start(changed)).rejects.toThrow('withdrawn');expect(material.map).toBeNull();expect(changed).not.toHaveBeenCalled();expect(closed).toHaveBeenCalledOnce();}finally{renderer.dispose();material.dispose();}
});
it('loads all registered owner maps with role-specific paths and color spaces',async()=>{
 const doc=scene(),extension=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:Record<string,unknown>}>};
 const payloads={color:new Uint8Array([1,2,3]),normal:new Uint8Array([4,5,6]),roughness:new Uint8Array([7,8,9])};
 const map=(role:keyof typeof payloads)=>({mime:'image/png',bytes:payloads[role].length,sha256:createHash('sha256').update(payloads[role]).digest('hex'),width:256,height:256,colorSpace:role==='color'?'srgb':'linear',...(role==='normal'?{normalY:'up'}:{})});
 extension.materials[0]!.maps={color:map('color'),normal:map('normal'),roughness:map('roughness')};
 const fetcher=vi.fn(async(path:string)=>{const role=path.match(/\/maps\/(color|normal|roughness)$/)?.[1] as keyof typeof payloads|undefined;return role?new Response(payloads[role],{headers:{'content-type':'image/png'}}):new Response(JSON.stringify(extension.materials[0]),{headers:{'content-type':'application/json'}});});
 vi.stubGlobal('fetch',fetcher);vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{tenantId:tenant} as Session);
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(plan.registry).toHaveLength(3);expect(material.map?.colorSpace).toBe(three.SRGBColorSpace);expect(material.normalMap?.colorSpace).toBe(three.NoColorSpace);expect(material.roughnessMap?.colorSpace).toBe(three.NoColorSpace);for(const role of ['color','normal','roughness'])expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/maps/'+role),expect.anything());}finally{renderer.dispose();material.dispose();}
});
it('loads public normal and roughness only from exact scoped resource declarations',async()=>{
 const doc=scene(),extension=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:Record<string,unknown>}>},payloads={color:new Uint8Array([1,2,3]),normal:new Uint8Array([4,5,6]),roughness:new Uint8Array([7,8,9])};
 const map=(role:keyof typeof payloads)=>({mime:'image/png',bytes:payloads[role].length,sha256:createHash('sha256').update(payloads[role]).digest('hex'),width:256,height:256,colorSpace:role==='color'?'srgb':'linear',...(role==='normal'?{normalY:'up'}:{})});
 const maps={color:map('color'),normal:map('normal'),roughness:map('roughness')};extension.materials[0]!.maps=maps;const publication='44444444-4444-4444-8444-444444444444',revision='b'.repeat(64),assetUrl=`/api/v1/publications/${publication}/assets/${id}`;
 const resources=[maps.normal,maps.roughness].map(m=>({sha256:m.sha256,bytes:m.bytes,mime:m.mime,url:`/api/v1/publications/${publication}/resources/${m.sha256}`}));
 const fetcher=vi.fn(async(url:string)=>{const role=url===assetUrl?'color':url.endsWith(maps.normal.sha256)?'normal':'roughness';return new Response(new Uint8Array(payloads[role]),{headers:{'content-type':'image/png','x-exhibitos-publication-revision':revision}});});vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),check=vi.fn(async()=>{}),source={publicationId:publication,revisionSha256:revision,assets:[{assetId:id,mime:'image/png',url:assetUrl}],resources,fetcher:fetcher as unknown as typeof fetch,check};
 const renderer=createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,source);try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(material.normalMap).not.toBeNull();expect(material.roughnessMap).not.toBeNull();for(const r of resources)expect(fetcher).toHaveBeenCalledWith(r.url,expect.anything());}finally{renderer.dispose();material.dispose();}
 expect(()=>createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{...source,resources:resources.slice(0,1)})).toThrow('WORKSPACE_MATERIAL_AUTHORITY');
});

it('loads all public material roles from one checked batch',async()=>{
 const doc=scene(),extension=doc.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{maps:Record<string,unknown>}>},payloads={color:new Uint8Array([1,2,3]),normal:new Uint8Array([4,5,6]),roughness:new Uint8Array([7,8,9])};
 const map=(role:keyof typeof payloads)=>({mime:'image/png',bytes:payloads[role].length,sha256:createHash('sha256').update(payloads[role]).digest('hex'),width:256,height:256,colorSpace:role==='color'?'srgb':'linear',...(role==='normal'?{normalY:'up'}:{})});
 const maps={color:map('color'),normal:map('normal'),roughness:map('roughness')};extension.materials[0]!.maps=maps;const publication='44444444-4444-4444-8444-444444444444',revision='b'.repeat(64),assetUrl=`/api/v1/publications/${publication}/assets/${id}`,batchUrl=`/api/v1/publications/${publication}/material-maps`;
 const resources=[maps.normal,maps.roughness].map(m=>({sha256:m.sha256,bytes:m.bytes,mime:m.mime,url:`/api/v1/publications/${publication}/resources/${m.sha256}`}));
 const records=(['color','normal','roughness'] as const).map(role=>({materialId:id,version:1,role,sha256:maps[role].sha256,bytes:maps[role].bytes})),header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);const body=Buffer.concat([prefix,header,...Object.values(payloads)]);
 let denied=false;const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fetcher=vi.fn(async(url:string,init?:RequestInit)=>init?.method==='DELETE'?new Response(null,{status:204}):url.endsWith('/fence')?denied?new Response(null,{status:404}):new Response(JSON.stringify({revisionSha256:revision}),{headers:{'content-type':'application/json'}}):new Response(body,{headers:{'content-type':'application/vnd.exhibitos.material-maps-v1','x-exhibitos-publication-revision':revision,'x-exhibitos-material-batch':token}})),check=vi.fn(async()=>{});vi.stubGlobal('createImageBitmap',async()=>({width:256,height:256,close:vi.fn()}));
 const plan=workspaceFloorPlan(doc,512,32*1024*1024),material=new three.MeshStandardMaterial(),renderer=createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{publicationId:publication,revisionSha256:revision,assets:[{assetId:id,mime:'image/png',url:assetUrl}],resources,materialMapBatch:{url:batchUrl},fetcher:fetcher as unknown as typeof fetch,check});
 try{renderer.add(material,plan.targets.get(surface)!);expect(await renderer.start(()=>{})).toEqual({[id+':1']:'ready'});expect(material.map).not.toBeNull();expect(material.normalMap).not.toBeNull();expect(material.roughnessMap).not.toBeNull();expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher).toHaveBeenCalledWith(batchUrl,expect.anything());expect(fetcher).toHaveBeenCalledWith(`${batchUrl}/${token}/fence`,expect.anything());expect(check).toHaveBeenCalled();}finally{renderer.dispose();material.dispose();}
 denied=true;const refusedMaterial=new three.MeshStandardMaterial(),refused=createPublicWorkspaceFloorRenderer(three,plan,new AbortController().signal,()=>false,{publicationId:publication,revisionSha256:revision,assets:[{assetId:id,mime:'image/png',url:assetUrl}],resources,materialMapBatch:{url:batchUrl},fetcher:fetcher as unknown as typeof fetch,check});try{refused.add(refusedMaterial,plan.targets.get(surface)!);await expect(refused.start(()=>{})).rejects.toThrow('PUBLICATION_UNAVAILABLE');expect(refusedMaterial.map).toBeNull();expect(refusedMaterial.normalMap).toBeNull();expect(refusedMaterial.roughnessMap).toBeNull();}finally{refused.dispose();refusedMaterial.dispose();}
});
