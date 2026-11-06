// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import type {Session} from './cms-client';
import {createWorkspaceFloorRenderer,workspaceFloorFetcher,workspaceFloorPlan} from './workspace-floor-renderer';

const surface='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',tenant='33333333-3333-4333-8333-333333333333';
const scene=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:256,height:256,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}}) as unknown as Exhibition;
afterEach(()=>vi.unstubAllGlobals());
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
