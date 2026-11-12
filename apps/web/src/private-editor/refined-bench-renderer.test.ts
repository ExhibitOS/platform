// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {REFINED_BENCH,benchesFor,furnishingsFor} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {addCatalogBench} from './catalog-bench-edit';
import {authenticatedCatalogBenchSource,catalogBenchSource,installPrivateCatalogBench} from './catalog-bench-renderer';
import {installBenches} from '../bench-renderer';
import {loadCatalogModel} from './catalog-furnishing-loader';
vi.mock('./catalog-furnishing-loader',()=>({loadCatalogModel:vi.fn()}));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it('loads the exact refined source through inventory authority with its own pose and restores the host on disposal',async()=>{
 const original=newDraft().candidate,room=original.rooms[0]!,pose={position:[1,0,1] as [number,number,number],yaw:.3,scale:1.25};
 const document=addCatalogBench(original,room.id,pose,'sculpture-bench-refined'),hostId=benchesFor(document)[0]!.id,asset=furnishingsFor(document)!.assets[0]!;
 const publicationId=crypto.randomUUID(),url=`/api/v1/publications/${publicationId}/assets/${asset.id}`,check=vi.fn(async()=>{}),fetcher=vi.fn();
 const source={publicationId,revisionSha256:'a'.repeat(64),assets:[{assetId:asset.id,mime:'model/gltf-binary',url}],fetcher,check};
 expect(catalogBenchSource(document,{...source,assets:[]},false)).toBeUndefined();expect(catalogBenchSource(document,{...source,assets:[]},true)).toBeUndefined();expect(catalogBenchSource(document,{...source,assets:[...source.assets,...source.assets]},true)).toBeUndefined();
 const admitted=catalogBenchSource(document,source,false)!;expect(admitted.reserveBytes).toBe(8*1024*1024);
 const model=new three.Group(),parent=new three.Group(),host=new three.Group(),dispose=vi.fn(()=>model.removeFromParent()),changed=vi.fn();host.userData.benchId=hostId;parent.add(host);
 vi.mocked(loadCatalogModel).mockResolvedValue({model,dispose,resident:1,triangles:3552});
 const visual=installPrivateCatalogBench(three,document,new Map([[room.id.toLowerCase(),parent]]),[host],new AbortController().signal,check,()=>false,20000,changed,admitted);
 expect(await visual.start()).toBe('ready');expect(loadCatalogModel).toHaveBeenCalledWith(three,REFINED_BENCH,expect.objectContaining({url,fetcher,check}),expect.any(AbortSignal),expect.any(Function),20000,8*1024*1024);
 expect(model.position.toArray()).toEqual(pose.position);expect(model.rotation.y).toBeCloseTo(pose.yaw);expect(model.scale.toArray()).toEqual([1.25,1.25,1.25]);expect(host.visible).toBe(false);expect(changed).toHaveBeenCalledWith(model,hostId);
 visual.dispose();expect(host.visible).toBe(true);expect(dispose).toHaveBeenCalledOnce();expect(parent.children).toEqual([host]);
});
it('retains the functional proxy and reports fallback if the target model fails to load',async()=>{
 const original=newDraft().candidate,room=original.rooms[0]!,document=addCatalogBench(original,room.id,undefined,'sculpture-bench-refined'),parent=new three.Group(),host=new three.Group(),changed=vi.fn();host.userData.benchId=benchesFor(document)[0]!.id;parent.add(host);
 vi.mocked(loadCatalogModel).mockRejectedValue(Error('CATALOG_INTEGRITY'));
 const visual=installPrivateCatalogBench(three,document,new Map([[room.id.toLowerCase(),parent]]),[host],new AbortController().signal,async()=>{},()=>false,20000,changed);
 expect(await visual.start()).toBe('fallback');expect(host.visible).toBe(true);expect(changed).not.toHaveBeenCalled();visual.dispose();
});

it('renders the same thirteen target proxies used for collision, with the back on negative Z',()=>{
 const original=newDraft().candidate,room=original.rooms[0]!,document=addCatalogBench(original,room.id,undefined,'sculpture-bench-refined'),parent=new three.Group();
 const installed=installBenches(three,document,new Map([[room.id.toLowerCase(),parent]])),mesh=installed.groups[0]!.children[0] as three.InstancedMesh,matrix=new three.Matrix4(),position=new three.Vector3(),scale=new three.Vector3(),rotation=new three.Quaternion();
 expect(mesh.count).toBe(13);mesh.getMatrixAt(0,matrix);matrix.decompose(position,rotation,scale);expect(position.z).toBeLessThan(0);expect(position.y).toBeCloseTo(.7285);expect(scale.x).toBeCloseTo(1.36);
 installed.dispose();expect(parent.children).toEqual([]);
});

it('loads the native catalogue only through its exact authenticated route and rejects a changed or expired session',async()=>{
 const original=newDraft().candidate,document=addCatalogBench(original,original.rooms[0]!.id,undefined,'sculpture-bench-refined');
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'curator',csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+60000).toISOString()},abort=new AbortController();
 let current={...session};const network=vi.fn(async()=>new Response(JSON.stringify(current),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',network);
 const source=authenticatedCatalogBenchSource(document,session,abort.signal)!;
 expect(source.url).toBe(`/api/v1/tenants/${session.tenantId}/studio/furnishings/sculpture-bench-refined/1/model`);expect(source.reserveBytes).toBe(8*1024*1024);expect(source).not.toHaveProperty('revision');
 await source.check();await source.fetcher(source.url,{credentials:'omit'});expect(network).toHaveBeenLastCalledWith(source.url,expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'error'}));
 await expect(source.fetcher('/unrelated')).rejects.toThrow('CATALOG_SOURCE_INVALID');
 current={...session,userId:crypto.randomUUID()};await expect(source.check()).rejects.toThrow('CATALOG_SCOPE_CHANGED');
 expect(authenticatedCatalogBenchSource(document,{...session,expiresAt:'2020-01-01T00:00:00Z'},abort.signal)).toBeUndefined();expect(authenticatedCatalogBenchSource(document,{...session,role:'viewer'},abort.signal)).toBeUndefined();
 abort.abort();await expect(source.fetcher(source.url)).rejects.toThrow();
});
