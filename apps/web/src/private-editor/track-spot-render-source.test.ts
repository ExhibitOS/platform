// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as three from 'three';
import {describe,expect,it,vi} from 'vitest';
import {furnishingAsset,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {museumTrackSpotProfile} from '../../../../packages/studio-contract/src/track-spot-profile.js';
import {resolveWallwasherMountHead} from '../../../../packages/studio-contract/src/wallwasher-mount-head.js';
import {sceneResourceAssetCost} from '../viewer/scene-resource-asset-cost';
import {existingSceneCost} from '../workspace-furnishing/scene-cost';
import {furnishingCollisionMesh} from '../viewer/furnishing-collision-mesh';
import {applyWallwasherModelPose,type ResolvedWallwasher} from './wallwasher-model-pose';
import {createTrackSpotRenderSource} from './track-spot-render-source';
import {loadCatalogModel} from './catalog-furnishing-loader';
import {FURNISHING_RESERVE_BYTES,installCatalogOtherVisuals} from './catalog-bench-renderer';
import {recordCatalogDecodeRetirement,retiredCatalogDecodeBytes} from './catalog-decode-ownership';

const identity={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
describe.each(['museum-track-spot','museum-track-spot-fixed-64p1'] as const)('%s',catalogId=>{
const asset=furnishingAsset('10000000-0000-4000-8000-000000000001',catalogId),entry=furnishingCatalogueEntry(asset.catalogId),profile=museumTrackSpotProfile(asset),headPitch=profile.headPitchIntervals[0]![0];
function resolved(i=0):ResolvedWallwasher{
 const q=Math.SQRT1_2,yaw=i*Math.PI/8;
 return {headPitch,...resolveWallwasherMountHead({profile,headPitch,mountPose:{position:[i%3-1,3.965,Math.floor(i/3)-2],rotation:new three.Quaternion().setFromAxisAngle(new three.Vector3(0,1,0),yaw).toArray() as [number,number,number,number],scale:[1,1,1]},ceilingSurface:{pose:{...identity,position:[0,3.965,0],rotation:[q,0,0,q]},dimensions:{width:20,height:20}}})};
}
async function input(){
 const bytes=await readFile(entry.path),check=vi.fn(async()=>{}),revision='a'.repeat(64);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(profile.modelSha256);
 const fetcher=vi.fn(async()=>new Response(bytes,{headers:{'x-exhibitos-publication-revision':revision}}));
 return {bytes,source:{url:'/qualified-museum-source',revision,check,fetcher}};
}
function records(root:three.Object3D){
 root.updateWorldMatrix(true,true);const result:{material:string;values:number[]}[]=[];
 root.traverse(node=>{if(!(node instanceof three.Mesh))return;const material=node.material as three.MeshStandardMaterial,position=node.geometry.getAttribute('position'),normal=node.geometry.getAttribute('normal'),index=node.geometry.index,count=index?.count??position.count,normals=new three.Matrix3().getNormalMatrix(node.matrixWorld);
  const key=JSON.stringify([material.type,material.name,material.color.toArray(),material.emissive.toArray(),material.emissiveIntensity,material.roughness,material.metalness,material.side,material.transparent,material.opacity]);
  for(let i=0;i<count;i+=3){const values:number[]=[];
   for(let j=0;j<3;j++){const vertex=index?.getX(i+j)??i+j,p=new three.Vector3().fromBufferAttribute(position,vertex).applyMatrix4(node.matrixWorld),n=new three.Vector3().fromBufferAttribute(normal,vertex).applyNormalMatrix(normals);values.push(...p.toArray(),...n.toArray());}
   result.push({material:key,values});
  }
 });
 return result.sort((a,b)=>{const material=a.material.localeCompare(b.material);if(material)return material;for(let i=0;i<a.values.length;i++){const delta=a.values[i]!-b.values[i]!;if(Math.abs(delta)>1e-6)return delta;}return 0;});
}
function equivalent(a:ReturnType<typeof records>,b:ReturnType<typeof records>){expect(a).toHaveLength(b.length);for(let i=0;i<a.length;i++){expect(a[i]!.material).toBe(b[i]!.material);for(let j=0;j<a[i]!.values.length;j++)expect(Math.abs(a[i]!.values[j]!-b[i]!.values[j]!)).toBeLessThan(1e-6);}}
function collisionTriangles(mesh:NonNullable<ReturnType<typeof furnishingCollisionMesh>>){
 const rows:number[][]=[];for(let i=0;i<mesh.indices.length;i+=3){const values:number[]=[];for(let j=0;j<3;j++){const index=mesh.indices[i+j]!*3;values.push(...mesh.vertices.slice(index,index+3));}rows.push(values);}
 return rows.sort((a,b)=>{for(let i=0;i<a.length;i++){const delta=a[i]!-b[i]!;if(Math.abs(delta)>1e-6)return delta;}return 0;});
}
it('keeps actual source triangles, normals, materials, aperture, collision and ray hits while reducing14 parts to7 draws',async()=>{
 const {source,bytes}=await input(),original=await loadCatalogModel(three,entry,source,new AbortController().signal,()=>false,100000,FURNISHING_RESERVE_BYTES);
 const originalNodes=[...original.model.children],buffers=originalNodes.map(node=>{const geometry=(node as three.Mesh).geometry;return Object.values(geometry.attributes).map(attribute=>new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength).slice());});
 const owner=createTrackSpotRenderSource(three,original,asset),pose=resolved(3),reference=original.model.clone(true);applyWallwasherModelPose(three,reference,asset,pose);
 const visual=owner.instantiate(pose,FURNISHING_RESERVE_BYTES-owner.baseResident);
 try{
  expect(existingSceneCost(three,reference)).toEqual({draws:14,triangles:4260});expect(existingSceneCost(three,visual.model)).toEqual({draws:7,triangles:4260});
  const receipt=await sceneResourceAssetCost(three,visual.model,{sha256:profile.modelSha256,bytes:bytes.length,sourceProfile:'museum-track-spot-v1-batched'},bytes);
  expect(receipt).toMatchObject({accountingVersion:1,colorDraws:7,displayTriangles:4260,sha256:profile.modelSha256});expect(receipt.geometryBytes).toBeGreaterThan(0);
  await expect(sceneResourceAssetCost(three,visual.model,{...receipt,sha256:'f'.repeat(64)},bytes)).rejects.toThrow('SCENE_RESOURCE_ASSET_IDENTITY');
  equivalent(records(reference),records(visual.model));
  expect(visual.model.children).toHaveLength(2);const [fixed,head]=visual.model.children;
  expect(fixed!.position.toArray()).toEqual(pose.fixedPose.position);expect(head!.quaternion.toArray()).toEqual(pose.headPose.rotation);
  const aperture=new three.Vector3(...profile.opticalA).applyMatrix4(head!.matrixWorld);expect(aperture.distanceTo(new three.Vector3(...pose.emitter))).toBeLessThan(1e-7);
  const before=furnishingCollisionMesh(three,reference)!,after=furnishingCollisionMesh(three,visual.model)!;const a=collisionTriangles(before),b=collisionTriangles(after);expect(a).toHaveLength(b.length);
  for(let i=0;i<a.length;i++)for(let j=0;j<9;j++)expect(Math.abs(a[i]![j]!-b[i]![j]!)).toBeLessThan(1e-6);
  const referenceLens=reference.children[1]!.children.find(node=>node.userData.name==='Lens_opaque') as three.Mesh,centre=new three.Box3().setFromObject(referenceLens).getCenter(new three.Vector3()),normal=new three.Vector3().fromBufferAttribute(referenceLens.geometry.getAttribute('normal'),0).applyNormalMatrix(new three.Matrix3().getNormalMatrix(referenceLens.matrixWorld));
  const origin=centre.clone().addScaledVector(normal,.3),ray=new three.Raycaster(origin,normal.clone().negate());
  const oldHits=ray.intersectObject(reference,true),newHits=ray.intersectObject(visual.model,true);expect(oldHits.length).toBeGreaterThan(0);expect(newHits.length).toBe(oldHits.length);expect(newHits[0]!.distance).toBeCloseTo(oldHits[0]!.distance,6);
  expect(original.model.children).toEqual(originalNodes);expect(original.model.parent).toBeNull();
  for(const [i,node]of originalNodes.entries())for(const [j,attribute]of Object.values((node as three.Mesh).geometry.attributes).entries())expect(new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength)).toEqual(buffers[i]![j]);
  const lens=head!.children.find(node=>node.userData.name==='Lens_opaque') as three.Mesh,sourceLens=originalNodes.find(node=>node.userData.name==='Lens_opaque') as three.Mesh;
  expect(lens.material).not.toBe(sourceLens.material);expect(lens.geometry).toBe(sourceLens.geometry);
 }finally{visual.dispose();owner.dispose();}
});
it('shares only immutable source/merged buffers across14 independently posed fixtures within the unchanged4MiB hold',async()=>{
 const {source}=await input(),original=await loadCatalogModel(three,entry,source,new AbortController().signal,()=>false,100000,FURNISHING_RESERVE_BYTES),release=vi.spyOn(original,'dispose'),owner=createTrackSpotRenderSource(three,original,asset),scene=new three.Scene();
 let used=owner.baseResident;const visuals:ReturnType<typeof owner.instantiate>[]=[],lenses:three.Mesh[]=[];
 try{
  for(let i=0;i<14;i++){const shared=owner.sharedResident(),visual=owner.instantiate(resolved(i),FURNISHING_RESERVE_BYTES-used);used+=owner.sharedResident()-shared+visual.resident;visuals.push(visual);scene.add(visual.model);visual.model.traverse(node=>{if(node instanceof three.Mesh&&node.userData.name==='Lens_opaque')lenses.push(node);});}
  expect(existingSceneCost(three,scene)).toEqual({draws:98,triangles:59640});expect(used).toBeLessThan(FURNISHING_RESERVE_BYTES);
  const geometries=new Set<three.BufferGeometry>();scene.traverse(node=>{if(node instanceof three.Mesh)geometries.add(node.geometry);});expect(geometries.size).toBe(7);
  expect(new Set(lenses.map(lens=>lens.material)).size).toBe(14);expect(new Set(lenses).size).toBe(14);
  const first=lenses[0]!.material as three.MeshStandardMaterial,second=lenses[1]!.material as three.MeshStandardMaterial;first.emissive.setRGB(1,0,0);expect(second.emissive.r).toBe(0);
  const disposed=[...geometries].map(geometry=>vi.spyOn(geometry,'dispose'));owner.dispose();owner.dispose();expect(scene.children).toHaveLength(0);expect(release).toHaveBeenCalledOnce();for(const spy of disposed)expect(spy).toHaveBeenCalledOnce();
 }finally{owner.dispose();}
});
it('uses one verified fetch but checks every binding authority and disposes source after all clones',async()=>{
 const {source}=await input(),roomId=crypto.randomUUID(),room=new three.Group(),scene=new three.Scene();scene.add(room);
 const items=Array.from({length:14},(_,i)=>({asset,binding:{hostKind:'light' as const,hostId:crypto.randomUUID(),assetId:asset.id,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}},resolved:{source:entry,roomId,parent:identity,pose:identity,mountProfile:'museum-track-spot-fixed-head-v1' as const,wallwasher:resolved(i)},source}));
 const runtime=installCatalogOtherVisuals(three,items,new Map([[roomId,room]]),new Map(),new Map(),new AbortController().signal,()=>false,100000,()=>{}, {scene,enabled:()=>true});
 try{expect((await runtime.start()).every(row=>row.status==='ready')).toBe(true);expect(source.fetcher).toHaveBeenCalledOnce();expect(source.check.mock.calls.length).toBeGreaterThanOrEqual(14);expect(existingSceneCost(three,room)).toEqual({draws:98,triangles:59640});expect(runtime.collisions.size).toBe(14);runtime.dispose();expect(room.children).toHaveLength(0);}finally{runtime.dispose();}
});
it('retains admission and authority fences when a verified source is already shared',async()=>{
 const {source}=await input(),roomId=crypto.randomUUID(),room=new three.Group();let allowed=true;
 source.check.mockImplementation(async()=>{if(!allowed)throw Error('CATALOG_SCOPE_EXPIRED');});
 const items=Array.from({length:2},(_,i)=>({asset,binding:{hostKind:'light' as const,hostId:crypto.randomUUID(),assetId:asset.id,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}},resolved:{source:entry,roomId,parent:identity,pose:identity,mountProfile:'museum-track-spot-fixed-head-v1' as const,wallwasher:resolved(i)},source}));
 const runtime=installCatalogOtherVisuals(three,items,new Map([[roomId,room]]),new Map(),new Map(),new AbortController().signal,()=>false,100000,()=>{allowed=false;});
 try{expect((await runtime.start()).map(row=>row.status)).toEqual(['ready','fallback']);expect(source.fetcher).toHaveBeenCalledOnce();expect(existingSceneCost(three,room)).toEqual({draws:7,triangles:4260});}finally{runtime.dispose();}
 const next=await input(),original=await loadCatalogModel(three,entry,next.source,new AbortController().signal,()=>false,100000,FURNISHING_RESERVE_BYTES),owner=createTrackSpotRenderSource(three,original,asset);
 try{expect(()=>owner.instantiate(resolved(),0)).toThrow('CATALOG_BUDGET');expect(owner.sharedResident()).toBe(0);expect(original.model.children).toHaveLength(14);expect(original.model.parent).toBeNull();}finally{owner.dispose();}
});
it('keeps the full predecode admission requirement before any source allowance can retire',async()=>{
 const {source,bytes}=await input();
 await expect(loadCatalogModel(three,entry,source,new AbortController().signal,()=>false,100000,bytes.length*4-1)).rejects.toThrow('CATALOG_BUDGET');
 expect(source.fetcher).not.toHaveBeenCalled();expect(source.check).not.toHaveBeenCalled();
});
});

it('requires a positive unchanged non-alias receipt to retire the transient decode allowance',()=>{
 const encoded=new Uint8Array(48),model=new three.Group(),geometry=new three.BufferGeometry(),material=new three.MeshStandardMaterial();
 geometry.setAttribute('position',new three.BufferAttribute(new Float32Array(9),3));model.add(new three.Mesh(geometry,material));
 try{
  expect(retiredCatalogDecodeBytes(three,model,48)).toBe(0);
  recordCatalogDecodeRetirement(three,model,encoded);expect(retiredCatalogDecodeBytes(three,model,48)).toBe(192);
  expect(retiredCatalogDecodeBytes(three,model,47)).toBe(0);
  recordCatalogDecodeRetirement(three,model,new Uint8Array(geometry.getAttribute('position').array.buffer));
  expect(retiredCatalogDecodeBytes(three,model,48)).toBe(0);
  recordCatalogDecodeRetirement(three,model,encoded);expect(retiredCatalogDecodeBytes(three,model,48)).toBe(192);
  geometry.setAttribute('position',new three.BufferAttribute(new Float32Array(encoded.buffer,0,9),3));
  expect(retiredCatalogDecodeBytes(three,model,48)).toBe(0);
  recordCatalogDecodeRetirement(three,model,encoded);expect(retiredCatalogDecodeBytes(three,model,48)).toBe(0);
  geometry.setAttribute('position',new three.BufferAttribute(new Float32Array(9),3));model.userData.parser={encoded};
  recordCatalogDecodeRetirement(three,model,encoded);expect(retiredCatalogDecodeBytes(three,model,48)).toBe(0);
 }finally{geometry.dispose();material.dispose();}
});

it('admits nine corrected fixtures and five preserved originals together within the existing scene hold',async()=>{
 const roomId=crypto.randomUUID(),room=new three.Group(),q=Math.SQRT1_2;
 const loader=await import('./catalog-furnishing-loader'),load=loader.loadCatalogModel,loads:{sha256:string;limit:number;resident?:number;error?:string}[]=[];
 const loading=vi.spyOn(loader,'loadCatalogModel').mockImplementation(async(...args)=>{const record={sha256:args[1].sha256,limit:args[6]} as (typeof loads)[number];loads.push(record);try{const value=await load(...args);record.resident=value.resident;return value;}catch(error){record.error=error instanceof Error?error.message:String(error);throw error;}});
 const sources=await Promise.all((['museum-track-spot-fixed-64p1','museum-track-spot'] as const).map(async catalogId=>{
  const asset=furnishingAsset(crypto.randomUUID(),catalogId),entry=furnishingCatalogueEntry(catalogId),profile=museumTrackSpotProfile(asset),bytes=await readFile(entry.path),revision='b'.repeat(64);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  return {asset,entry,profile,source:{url:'/mixed/'+catalogId,revision,check:vi.fn(async()=>{}),fetcher:vi.fn(async()=>new Response(bytes,{headers:{'x-exhibitos-publication-revision':revision}}))}};
 }));
 const items=Array.from({length:14},(_,i)=>{
  const {asset,entry,profile,source}=sources[i<9?0:1]!,headPitch=profile.headPitchIntervals[0]![0],yaw=i*Math.PI/8;
  const wallwasher={headPitch,...resolveWallwasherMountHead({profile,headPitch,mountPose:{position:[i%3-1,3.965,Math.floor(i/3)-2],rotation:new three.Quaternion().setFromAxisAngle(new three.Vector3(0,1,0),yaw).toArray() as [number,number,number,number],scale:[1,1,1]},ceilingSurface:{pose:{...identity,position:[0,3.965,0],rotation:[q,0,0,q]},dimensions:{width:20,height:20}}})};
  return {asset,binding:{hostKind:'light' as const,hostId:crypto.randomUUID(),assetId:asset.id,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}},resolved:{source:entry,roomId,parent:identity,pose:identity,mountProfile:'museum-track-spot-fixed-head-v1' as const,wallwasher},source};
 });
 const runtime=installCatalogOtherVisuals(three,items,new Map([[roomId,room]]),new Map(),new Map(),new AbortController().signal,()=>false,100000,()=>{});
 try{
  expect((await runtime.start()).map(row=>row.status),JSON.stringify(loads)).toEqual(Array(14).fill('ready'));
  expect(existingSceneCost(three,room)).toEqual({draws:98,triangles:59640});
  for(const {source}of sources){expect(source.fetcher).toHaveBeenCalledOnce();expect(source.check).toHaveBeenCalled();}
 }finally{runtime.dispose();loading.mockRestore();}
 expect(room.children).toHaveLength(0);
});
