// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {AssetPeakBudget,MemoryAssetCache,DEVICE_BUDGETS,deviceBudget} from '../viewer/loading';
import {publicWorkspaceModelSource} from './public-source';
import {PublicWorkspaceCache} from './public-cache';
import {guardedXrFrame} from '../viewer/xr-frame-fence';
import {createOwnerFurnishingScene,existingSceneCost,FurnishingSceneCapacityError} from './owner-scene';
import {OwnerArtworkHold} from './owner-artwork-hold';
import {ArtworkBitmapCleanupError,decodeArtworkBitmap} from '../viewer/image-budget';
import {prepareArtworkGlb} from '../viewer/artwork-glb-preparation';
import {basisLoader} from '../basis-loader';
vi.mock('../basis-loader',()=>({basisLoader:vi.fn(async()=>undefined)}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();vi.unstubAllGlobals();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),item={id:id(2),version:1,kind:'bench',name:'Synthetic',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},placements=[{id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[1,0,1],yaw:.5,scale:1},{id:id(4),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[-1,0,1],yaw:-.5,scale:1}],candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[item],placements}}},room=new three.Group(),scene=new three.Scene(),controller=new AbortController();scene.add(room);let authorized=true;const fetcher=vi.fn(async(input:RequestInfo|URL)=>!authorized?new Response('',{status:403}):String(input).endsWith('/display-check')?Response.json(item):new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary'}}));const changed=vi.fn(),runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:id(9),signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed,fetcher});return {runtime,room,controller,changed,fetcher,deny:()=>{authorized=false;}};}
it('loads two distinct room poses through the owner adapter and tears both down',async()=>{const f=await fixture();expect(await f.runtime.start()).toEqual({loaded:2,failed:0});expect(f.room.children).toHaveLength(2);expect(f.room.children.map(o=>o.position.x)).toEqual([1,-1]);expect(f.fetcher.mock.calls.filter(([url])=>String(url).endsWith('/model'))).toHaveLength(2);f.runtime.enforce();f.runtime.dispose();expect(f.room.children).toHaveLength(0);});
it('removes mounted models when the actual owner check denies revalidation',async()=>{vi.useFakeTimers();const f=await fixture();await f.runtime.start();f.deny();await vi.advanceTimersByTimeAsync(5000);expect(f.room.children).toHaveLength(0);expect(f.changed).toHaveBeenCalled();f.runtime.dispose();});
it('counts existing scene meshes and refuses a scene over the budget',()=>{const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial({transparent:true,side:three.DoubleSide}),mesh=new three.Mesh(geometry,material);scene.add(mesh);expect(existingSceneCost(three,scene)).toEqual({draws:2,triangles:24});geometry.dispose();material.dispose();});
it('reserves measured populated-scene headroom only for the native editor', async () => {
 const room=new three.Group(),scene=new three.Scene(),geometry=new three.BufferGeometry(),material=new three.MeshBasicMaterial();
 geometry.setIndex(new three.BufferAttribute(new Uint32Array(164_595*3),1));
 room.add(new three.Mesh(geometry,material));
 for(let i=1;i<276;i++)room.add(new three.Line(new three.BufferGeometry(),material));
 scene.add(room);
 const item={id:id(2),version:1,kind:'bench',name:'Synthetic',rights:{permissions:{display:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:128,sha256:'a'.repeat(64)}};
 const placement={id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1,position:[1,0,1],yaw:0,scale:1};
 const candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[item],placements:[placement]}}};
 const options={three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:id(9),signal:new AbortController().signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:229_066_026,resident:()=>178_716_671,changed:()=>{}};
 try{
  expect(existingSceneCost(three,scene)).toEqual({draws:276,triangles:164_595});
  expect(()=>createOwnerFurnishingScene(options)).toThrow(FurnishingSceneCapacityError);
  expect(()=>createOwnerFurnishingScene({...options,nativeEditor:true,publicAuthority:{check:async()=>{},valid:()=>true}})).toThrow(FurnishingSceneCapacityError);
  const runtime=createOwnerFurnishingScene({...options,nativeEditor:true});
  try{
   const release=runtime.reservePreview(34,10_068);
   runtime.ledger.reserve('required-furnishings',6_937_736);
   expect(()=>runtime.ledger.reserve('pressure-overflow',43_411_620)).toThrow();
   runtime.ledger.release('required-furnishings');
   expect(()=>runtime.reservePreview(75,1)).toThrow('WORKSPACE_SCENE_BUDGET');
   expect(()=>runtime.reservePreview(1,25_338)).toThrow('WORKSPACE_SCENE_BUDGET');
   release();
  }finally{runtime.dispose();}
 }finally{
  room.traverse(node=>{if(node instanceof three.Line||node instanceof three.Mesh)node.geometry.dispose();});
  material.dispose();
 }
});
it('uses the same scene budget for a competing artwork preview',async()=>{const f=await fixture();expect(await f.runtime.start()).toEqual({loaded:2,failed:0});expect(()=>f.runtime.reservePreview(257,1)).toThrow('WORKSPACE_SCENE_BUDGET');const release=f.runtime.reservePreview(1,1);release();f.runtime.dispose();});
it('keeps an unresolved scene reservation across teardown and refuses a new scene until it drains',async()=>{const f=await fixture();f.runtime.ledger.reserve('pending',1);f.runtime.dispose();await expect(fixture()).rejects.toThrow('WORKSPACE_SCENE_DRAINING');f.runtime.ledger.release('pending');const next=await fixture();next.runtime.dispose();});
it('charges a double-sided artwork as two passes when turned into a ghost',()=>{const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial({side:three.DoubleSide}),mesh=new three.Mesh(geometry,material);scene.add(mesh);expect(existingSceneCost(three,scene)).toEqual({draws:1,triangles:12});expect(existingSceneCost(three,scene,true)).toEqual({draws:2,triangles:24});geometry.dispose();material.dispose();});

it('drains an actual cancelled bitmap decode and permits scene readmission after clean failure',async()=>{
 const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'image',4096),controller=new AbortController(),close=vi.fn();let deliver!:(bitmap:ImageBitmap)=>void;vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise<ImageBitmap>(resolve=>{deliver=resolve;})));hold.reserveDecode(8192);const work=(async()=>{try{return await decodeArtworkBitmap(new ArrayBuffer(33),DEVICE_BUDGETS.desktop,controller.signal,()=>{});}catch(error){if(!(error instanceof ArtworkBitmapCleanupError))hold.markCleanFailure();hold.failure();throw error;}})();controller.abort();f.runtime.dispose();await expect(fixture()).rejects.toThrow('WORKSPACE_SCENE_DRAINING');deliver({width:20,height:10,close} as unknown as ImageBitmap);await expect(work).rejects.toThrow();expect(close).toHaveBeenCalledOnce();const next=await fixture();next.runtime.dispose();vi.unstubAllGlobals();
});
it('releases a hold when the bitmap decoder rejects before allocating',async()=>{const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'image-reject',4096);hold.reserveDecode(8192);vi.stubGlobal('createImageBitmap',vi.fn(async()=>{throw Error('DECODE_FAILED');}));try{await decodeArtworkBitmap(new ArrayBuffer(33),DEVICE_BUDGETS.desktop,new AbortController().signal,()=>{});}catch(error){if(!(error instanceof ArtworkBitmapCleanupError))hold.markCleanFailure();hold.failure();}f.runtime.dispose();const next=await fixture();next.runtime.dispose();vi.unstubAllGlobals();});
it('keeps a hold quarantined if closing a cancelled image fails',async()=>{const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'image-uncertain',4096),controller=new AbortController();let deliver!:(bitmap:ImageBitmap)=>void;vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise<ImageBitmap>(resolve=>{deliver=resolve;})));hold.reserveDecode(8192);const work=(async()=>{try{return await decodeArtworkBitmap(new ArrayBuffer(33),DEVICE_BUDGETS.desktop,controller.signal,()=>{});}catch(error){if(!(error instanceof ArtworkBitmapCleanupError))hold.markCleanFailure();hold.failure();throw error;}})();controller.abort();f.runtime.dispose();deliver({width:20,height:10,close:()=>{throw Error('CLOSE_FAILED');}} as unknown as ImageBitmap);await expect(work).rejects.toBeInstanceOf(ArtworkBitmapCleanupError);await expect(fixture()).rejects.toThrow('WORKSPACE_SCENE_DRAINING');hold.release();const next=await fixture();next.runtime.dispose();});
it('returns a cancelled non-Basis GLB hold after pending loader import settles, permitting readmission',async()=>{
 const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'glb-import',4096),controller=new AbortController(),module=await import('three/addons/loaders/GLTFLoader.js');let deliver!:(value:typeof module)=>void,uncertain=false;hold.reserveDecode(8192);const work=(async()=>{try{return await prepareArtworkGlb({} as three.WebGLRenderer,new ArrayBuffer(32),controller.signal,value=>{uncertain=value;},()=>new Promise(resolve=>{deliver=resolve;}));}catch(error){if(!uncertain)hold.markCleanFailure();hold.failure();throw error;}})();controller.abort();f.runtime.dispose();await expect(fixture()).rejects.toThrow('WORKSPACE_SCENE_DRAINING');deliver(module);await expect(work).rejects.toThrow();const next=await fixture();next.runtime.dispose();
});
it('returns a pre-worker hold when the GLB loader import rejects',async()=>{const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'glb-import-error',4096);let uncertain=false;hold.reserveDecode(8192);try{await prepareArtworkGlb({} as three.WebGLRenderer,new ArrayBuffer(32),new AbortController().signal,value=>{uncertain=value;},async()=>{throw Error('IMPORT_FAILED');});}catch{if(!uncertain)hold.markCleanFailure();hold.failure();}f.runtime.dispose();const next=await fixture();next.runtime.dispose();});
it('returns a cancelled ordinary GLB hold after a pending Basis probe resolves without a worker',async()=>{const f=await fixture(),hold=new OwnerArtworkHold(f.runtime.ledger,'glb-no-basis',4096),controller=new AbortController();let finish!:()=>void,uncertain=false;vi.mocked(basisLoader).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(undefined);}));hold.reserveDecode(8192);const work=(async()=>{try{return await prepareArtworkGlb({} as three.WebGLRenderer,new ArrayBuffer(32),controller.signal,value=>{uncertain=value;});}catch(error){if(!uncertain)hold.markCleanFailure();hold.failure();throw error;}})();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));controller.abort();f.runtime.dispose();await expect(fixture()).rejects.toThrow('WORKSPACE_SCENE_DRAINING');finish();await expect(work).rejects.toThrow();const next=await fixture();next.runtime.dispose();});

it('loads a public furnishing through the shared artwork ledger and removes it on revoked publication',async()=>{
 vi.useFakeTimers();const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),publicationId=id(9),item={id:id(2),version:1 as const,kind:'bench' as const,name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},extension={version:1 as const,furnishings:[item],placements:[{id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[1,0,1] as [number,number,number],yaw:0,scale:1},{id:id(4),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[-1,0,1] as [number,number,number],yaw:0,scale:1}]},candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}},room=new three.Group(),scene=new three.Scene(),controller=new AbortController(),ledger=new AssetPeakBudget(64*1024*1024,()=>0),url=`/api/v1/publications/${publicationId}/assets/${item.id}`,fetcher=vi.fn(async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary','x-exhibitos-publication-revision':'f'.repeat(64)}}));scene.add(room);let allowed=true;const check=vi.fn(async()=>{if(!allowed)throw Error('PUBLICATION_UNAVAILABLE');});
 const cache=new MemoryAssetCache<ArrayBuffer>(64*1024*1024),workspaceCache=new PublicWorkspaceCache(cache);const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:publicationId,signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},ledger,modelSource:descriptor=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),[{assetId:item.id,mime:item.model.mime,url}],extension,descriptor,fetcher,check,workspaceCache),publicAuthority:{check,valid:()=>true},disposeSource:()=>workspaceCache.dispose()});
 expect(await runtime.start()).toEqual({loaded:2,failed:0});expect(room.children).toHaveLength(2);expect(ledger.reservedBytes()).toBeGreaterThan(0);expect(fetcher).toHaveBeenCalledTimes(1);expect(cache.stats().bytes).toBe(bytes.length);expect(check).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(5000);expect(check).toHaveBeenCalledTimes(3);allowed=false;await vi.advanceTimersByTimeAsync(5000);expect(check).toHaveBeenCalledTimes(4);expect(room.children).toHaveLength(0);expect(runtime.stats()).toEqual({loaded:0,failed:2});expect(cache.stats().bytes).toBe(0);runtime.dispose();
});

it('keeps approved furnishings beside valid desktop artworks within the separate scene limit',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),publicationId=id(9);
 const item={id:id(2),version:1 as const,kind:'bench' as const,name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
 const extension={version:1 as const,furnishings:[item],placements:[{id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[1,0,1] as [number,number,number],yaw:0,scale:1}]};
 const candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}};
 const room=new three.Group(),scene=new three.Scene(),controller=new AbortController();
 const budget=deviceBudget({deviceMemory:8,coarsePointer:false,finePointer:true});
 expect(budget).toMatchObject({maxTriangles:150000,maxSceneTriangles:200000});
 expect(deviceBudget({coarsePointer:true}).maxSceneTriangles).toBeUndefined();
 expect(deviceBudget({deviceMemory:4,coarsePointer:false,finePointer:true}).maxSceneTriangles).toBeUndefined();
 const fetcher=vi.fn(async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary','x-exhibitos-publication-revision':'f'.repeat(64)}})),check=async()=>{};
 const geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),artwork=new three.Mesh(geometry,material);
 geometry.setIndex(new three.BufferAttribute(new Uint16Array(160000*3),1));
 scene.add(room,artwork);
 const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:publicationId,signal:controller.signal,unavailable:()=>false,budget,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},modelSource:descriptor=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),[{assetId:item.id,mime:item.model.mime,url:`/api/v1/publications/${publicationId}/assets/${item.id}`}],extension,descriptor,fetcher,check),publicAuthority:{check,valid:()=>true}});
 try{
  expect(await runtime.start()).toEqual({loaded:1,failed:0});
  geometry.setIndex(new three.BufferAttribute(new Uint16Array(165101*3),1));
  runtime.enforce();
  expect(room.children).toHaveLength(1);
  expect(runtime.stats()).toEqual({loaded:1,failed:0});
  geometry.setIndex(new three.BufferAttribute(new Uint16Array(200001*3),1));
  runtime.enforce();
  expect(room.children).toHaveLength(0);
  expect(runtime.stats()).toEqual({loaded:0,failed:1});
 }finally{runtime.dispose();geometry.dispose();material.dispose();}
});

it('does not quarantine an unrelated artwork reservation when a public furnishing scene is disposed',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),publicationId=id(9),item={id:id(2),version:1 as const,kind:'bench' as const,name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},extension={version:1 as const,furnishings:[item],placements:[{id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[1,0,1] as [number,number,number],yaw:0,scale:1}]},candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}},room=new three.Group(),scene=new three.Scene(),controller=new AbortController(),ledger=new AssetPeakBudget(64*1024*1024,()=>0),url=`/api/v1/publications/${publicationId}/assets/${item.id}`,fetcher=vi.fn(async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary','x-exhibitos-publication-revision':'f'.repeat(64)}})),check=vi.fn(async()=>{});scene.add(room);
 ledger.reserve('artwork',1024);const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:publicationId,signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},ledger,modelSource:descriptor=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),[{assetId:item.id,mime:item.model.mime,url}],extension,descriptor,fetcher,check),publicAuthority:{check,valid:()=>true}});expect(await runtime.start()).toEqual({loaded:1,failed:0});const extra=new three.InstancedMesh(new three.BoxGeometry(),new three.MeshBasicMaterial(),257);scene.add(extra);let visibleAtFrame=-1;guardedXrFrame(runtime.enforce,()=>{},()=>{},()=>{visibleAtFrame=room.children.length;})(0);expect(visibleAtFrame).toBe(0);expect(runtime.stats()).toEqual({loaded:0,failed:1});runtime.dispose();scene.remove(extra);extra.geometry.dispose();extra.material.dispose();expect(ledger.reservedBytes()).toBe(1024);const next=await fixture();next.runtime.dispose();ledger.release('artwork');
});

it('hides the entire public scene at the earliest furnishing expiry',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),publicationId=id(9),first={id:id(2),version:1 as const,kind:'bench' as const,name:'First',rights:{permissions:{display:true,export:true},expiresAt:'2030-01-01T00:00:01Z'},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},second={...first,id:id(5),name:'Second',rights:{permissions:{display:true,export:true},expiresAt:'2030-01-01T00:00:10Z'}},extension={version:1 as const,furnishings:[first,second],placements:[first,second].map((item,i)=>({id:id(3+i),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[i,0,1] as [number,number,number],yaw:0,scale:1}))},candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}},room=new three.Group(),scene=new three.Scene(),controller=new AbortController(),ledger=new AssetPeakBudget(64*1024*1024,()=>0),fetcher=vi.fn(async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary','x-exhibitos-publication-revision':'f'.repeat(64)}})),check=vi.fn(async()=>{});scene.add(room);
 const assets=extension.furnishings.map(item=>({assetId:item.id,mime:item.model.mime,url:`/api/v1/publications/${publicationId}/assets/${item.id}`}));const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:publicationId,signal:controller.signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},ledger,modelSource:descriptor=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),assets,extension,descriptor,fetcher,check),publicAuthority:{check,valid:()=>Date.now()<Date.parse(first.rights.expiresAt)}});
 expect(await runtime.start()).toEqual({loaded:2,failed:0});vi.setSystemTime(new Date('2030-01-01T00:00:01Z'));let visibleAtFrame=-1;guardedXrFrame(runtime.enforce,()=>{},()=>{},()=>{visibleAtFrame=room.children.length;})(0);expect(visibleAtFrame).toBe(0);runtime.dispose();
});

it('receiver shading leaves the admitted scene capacity unchanged and keeps loaded furnishings',async()=>{
 const {installSupportContactShadows}=await import('../viewer/shadows');
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),publicationId=id(9);
 const item={id:id(2),version:1 as const,kind:'bench' as const,name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
 const extension={version:1 as const,furnishings:[item],placements:[{id:id(3),roomId:id(1),furnishingId:item.id,furnishingVersion:1 as const,position:[1,0,1] as [number,number,number],yaw:0,scale:1}]};
 const candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}};
 const room=new three.Group(),scene=new three.Scene();scene.add(room);
 const fetcher=async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary','x-exhibitos-publication-revision':'f'.repeat(64)}}),check=async()=>{};
 const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:publicationId,signal:new AbortController().signal,unavailable:()=>false,budget:DEVICE_BUDGETS.desktop,transitionBytes:64*1024*1024,resident:()=>0,changed:()=>{},
  modelSource:descriptor=>publicWorkspaceModelSource(publicationId,'f'.repeat(64),[{assetId:item.id,mime:item.model.mime,url:`/api/v1/publications/${publicationId}/assets/${item.id}`}],extension,descriptor,fetcher,check),publicAuthority:{check,valid:()=>true},
 });
 expect(await runtime.start()).toEqual({loaded:1,failed:0});
 const geometry=new three.BoxGeometry(),material=new three.MeshStandardMaterial(),receiver=new three.Mesh(geometry,material);room.add(receiver);
 const filler=new three.InstancedMesh(geometry,material,256-existingSceneCost(three,scene).draws);scene.add(filler);
 const before=existingSceneCost(three,scene);expect(before.draws).toBe(256);
 const contacts=installSupportContactShadows(three,[{room,receiver,position:[0,.002,0],rotation:[0,0,0,1],width:.1,height:.1}],true,()=>{});contacts.setRoom(room);
 expect(existingSceneCost(three,scene)).toEqual(before);
 runtime.enforce();expect(runtime.stats()).toEqual({loaded:1,failed:0});
 contacts.dispose();expect(existingSceneCost(three,scene)).toEqual(before);
 runtime.dispose();scene.remove(filler);filler.dispose();geometry.dispose();material.dispose();
});
