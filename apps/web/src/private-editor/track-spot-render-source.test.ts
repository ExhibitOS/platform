// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as three from 'three';
import {describe,expect,it,vi} from 'vitest';
import {furnishingAsset,furnishingCatalogueEntry,resolveTrackSpotAiming} from '@exhibitos/studio-contract';
import {articulatedTrackSpotCandidate,lightId as articulatedLightId} from '../../../../packages/studio-contract/test-fixtures/articulated-track-spot.js';
import {ARTICULATED_TRACK_SPOT_PROFILE as articulatedProfile} from '../../../../packages/studio-contract/src/track-spot-articulated-profile.js';
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
import {geometryResidentBytes} from '../viewer/loading';

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
it('couples only the mounted fixed64 lens to its own live spot',async()=>{
 const {source}=await input(),roomId=crypto.randomUUID(),room=new three.Group(),scene=new three.Scene();scene.add(room);
 const items=[0,1].map(i=>({asset,binding:{hostKind:'light' as const,hostId:crypto.randomUUID(),assetId:asset.id,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}},resolved:{source:entry,roomId,parent:identity,pose:identity,mountProfile:'museum-track-spot-fixed-head-v1' as const,wallwasher:resolved(i)},source}));
 const warm=new three.SpotLight(0xffbb88,14),other=new three.SpotLight(0xffffff,7);
 const lights=new Map([[items[0]!.binding.hostId,{light:warm}],[items[1]!.binding.hostId,{light:other}]]);
 const runtime=installCatalogOtherVisuals(three,items,new Map([[roomId,room]]),new Map(),new Map(),new AbortController().signal,()=>false,100000,()=>{},undefined,lights);
 try{
  expect((await runtime.start()).map(row=>row.status)).toEqual(['ready','ready']);
  const lenses:three.Mesh<three.BufferGeometry,three.MeshStandardMaterial>[]=[];
  room.traverse(node=>{if(node instanceof three.Mesh&&node.userData.name==='Lens_opaque')lenses.push(node);});
  expect(lenses).toHaveLength(2);
  const [lens,otherLens]=[lenses[0]!,lenses[1]!],material=lens.material;
  const initialOther=otherLens.material.toJSON(),draw=()=>lens.onBeforeRender({} as three.WebGLRenderer,scene,new three.Camera(),lens.geometry,material,null as unknown as three.Group);
  const enabled=catalogId==='museum-track-spot-fixed-64p1';
  expect(material.emissive.toArray()).toEqual(enabled?warm.color.toArray():[0,0,0]);
  if(enabled)expect(material.emissiveIntensity).toBe(14/15);
  warm.intensity=3;warm.color.setRGB(.2,.4,.8);
  const live=warm.toJSON();draw();
  expect(warm.toJSON()).toEqual(live);
  expect(material.emissive.toArray()).toEqual(enabled?[.2,.4,.8]:[0,0,0]);
  if(enabled)expect(material.emissiveIntensity).toBe(.75);
  expect(otherLens.material.toJSON()).toEqual(initialOther);
  warm.intensity=0;draw();expect(material.emissive.toArray()).toEqual([0,0,0]);
  warm.intensity=14;draw();expect(material.emissive.toArray()).toEqual(enabled?[.2,.4,.8]:[0,0,0]);
  warm.visible=false;draw();expect(material.emissive.toArray()).toEqual([0,0,0]);
  const disposed=vi.spyOn(material,'dispose');runtime.dispose();runtime.dispose();
  expect(disposed).toHaveBeenCalledOnce();expect(lens.material).not.toBe(material);
  expect(room.children).toHaveLength(0);
 }finally{runtime.dispose();}
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

describe('museum-track-spot-articulated real source',()=>{
 const asset=furnishingAsset('10000000-0000-4000-8000-000000000001','museum-track-spot-articulated'),entry=furnishingCatalogueEntry(asset.catalogId);
 function resolved(i=0){
  const {candidate,trackAim}=articulatedTrackSpotCandidate();
  trackAim.aim={kind:'manual',yaw:(i%7-3)*.3,pitch:-.2-i*.07};
  // The command stores a detached intent; edit the actual saved detail.
  const details=candidate.extensions!['org.exhibitos.studio/light-details'] as unknown as {lights:{trackAim:typeof trackAim}[]};details.lights[0]!.trackAim.aim=trackAim.aim;
  const pose=resolveTrackSpotAiming(candidate,articulatedLightId);if(!pose.reachable)throw Error(pose.reason);return pose;
 }
 async function input(){
  const bytes=await readFile(entry.path),source={url:'/qualified-articulated',check:vi.fn(async()=>{}),fetcher:vi.fn(async()=>new Response(bytes))};
  expect(bytes.length).toBe(225328);expect(createHash('sha256').update(bytes).digest('hex')).toBe(articulatedProfile.modelSha256);
  const original=await loadCatalogModel(three,entry,source,new AbortController().signal,()=>false,100000,FURNISHING_RESERVE_BYTES);
  return {bytes,source,original};
 }
 function triangles(root:three.Object3D){
  root.updateWorldMatrix(true,true);const rows:{material:string;values:number[]}[]=[];
  root.traverse(node=>{if(!(node instanceof three.Mesh))return;const m=node.material as three.MeshStandardMaterial,g=node.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),index=g.index,count=index?.count??p.count,normals=new three.Matrix3().getNormalMatrix(node.matrixWorld);
   const material=JSON.stringify([m.name,m.color.toArray(),m.emissive.toArray(),m.roughness,m.metalness,m.side,m.opacity]);
   for(let i=0;i<count;i+=3){const values:number[]=[];for(let j=0;j<3;j++){const k=index?.getX(i+j)??i+j;values.push(...new three.Vector3().fromBufferAttribute(p,k).applyMatrix4(node.matrixWorld).toArray(),...new three.Vector3().fromBufferAttribute(n,k).applyNormalMatrix(normals).toArray());}rows.push({material,values});}
  });
  return rows.sort((a,b)=>{const material=a.material.localeCompare(b.material);if(material)return material;for(let i=0;i<a.values.length;i++){const d=a.values[i]!-b.values[i]!;if(Math.abs(d)>1e-6)return d;}return 0;});
 }
 it('batches the actual fourteen parts per frame into eight draws without changing triangles, normals, rays or buffers',async()=>{
  const {original}=await input(),sourceNodes=[...original.model.children] as three.Mesh[],backings=sourceNodes.map(n=>Object.values(n.geometry.attributes).map(a=>a.array.slice())),owner=createTrackSpotRenderSource(three,original,asset),pose=resolved(3),reference=original.model.clone(true);
  applyWallwasherModelPose(three,reference,asset,pose);const visual=owner.instantiate(pose,FURNISHING_RESERVE_BYTES-owner.baseResident);
  try{
   expect(existingSceneCost(three,reference)).toEqual({draws:14,triangles:5544});expect(existingSceneCost(three,visual.model)).toEqual({draws:8,triangles:5544});
   const a=triangles(reference),b=triangles(visual.model);expect(b).toHaveLength(a.length);
   for(let i=0;i<a.length;i++){expect(b[i]!.material).toBe(a[i]!.material);for(let j=0;j<a[i]!.values.length;j++)expect(Math.abs(a[i]!.values[j]!-b[i]!.values[j]!)).toBeLessThan(1e-6);}
   const [fixed,yoke,head]=visual.model.children;expect(fixed!.position.toArray()).toEqual(pose.fixedPose.position);expect(yoke!.quaternion.toArray()).toEqual(pose.yokePose.rotation);expect(head!.quaternion.toArray()).toEqual(pose.headPose.rotation);
   const aperture=new three.Vector3(...articulatedProfile.geometry.opticalA).applyMatrix4(head!.matrixWorld);expect(aperture.distanceTo(new three.Vector3(...pose.emitter))).toBeLessThan(1e-7);
   const lens=head!.children.find(n=>n.userData.name==='Lens_opaque') as three.Mesh,centre=new three.Box3().setFromObject(lens).getCenter(new three.Vector3()),normal=new three.Vector3().fromBufferAttribute(lens.geometry.getAttribute('normal'),0).applyNormalMatrix(new three.Matrix3().getNormalMatrix(lens.matrixWorld)),ray=new three.Raycaster(centre.clone().addScaledVector(normal,.3),normal.clone().negate());
   const oldHits=ray.intersectObject(reference,true),newHits=ray.intersectObject(visual.model,true);expect(oldHits.length).toBeGreaterThan(0);expect(newHits.length).toBe(oldHits.length);expect(newHits[0]!.distance).toBeCloseTo(oldHits[0]!.distance,6);
   const before=furnishingCollisionMesh(three,reference)!,after=furnishingCollisionMesh(three,visual.model)!;expect(after.indices.length).toBe(before.indices.length);expect(after.vertices.length).toBe(before.vertices.length);
   expect(original.model.children).toEqual(sourceNodes);expect(original.model.parent).toBeNull();
   for(const [i,node]of sourceNodes.entries())for(const [j,a]of Object.values(node.geometry.attributes).entries())expect(a.array).toEqual(backings[i]![j]);
   expect(lens.geometry).toBe(sourceNodes.find(n=>n.userData.name==='Lens_opaque')!.geometry);expect(lens.material).not.toBe(sourceNodes.find(n=>n.userData.name==='Lens_opaque')!.material);
  }finally{visual.dispose();owner.dispose();}
 });
 it('accounts for three frame nodes, exact merged buffers and one independent lens per instance, retaining source ownership until disposal',async()=>{
  const {original}=await input(),release=vi.spyOn(original,'dispose'),owner=createTrackSpotRenderSource(three,original,asset),scene=new three.Scene(),visuals:ReturnType<typeof owner.instantiate>[]=[],lenses:three.Mesh[]=[];
  try{
   expect(owner.baseResident).toBe(original.resident-retiredCatalogDecodeBytes(three,original.model,asset.bytes)+15*4096);
   let used=owner.baseResident,firstGrowth=0;
   for(let i=0;i<14;i++){
    const shared=owner.sharedResident(),visual=owner.instantiate(resolved(i),FURNISHING_RESERVE_BYTES-used),growth=owner.sharedResident()-shared;used+=growth+visual.resident;visuals.push(visual);scene.add(visual.model);
    expect(visual.resident).toBe((15+3+4+2)*4096);
    if(i===0){firstGrowth=growth;let mergedBytes=0;visual.model.traverse(n=>{if(n instanceof three.Mesh&&!n.userData.name)mergedBytes+=geometryResidentBytes([...Object.values(n.geometry.attributes),n.geometry.index!]);});expect(growth).toBe(mergedBytes);expect(growth).toBeGreaterThan(0);}else expect(growth).toBe(0);
    visual.model.traverse(n=>{if(n instanceof three.Mesh&&n.userData.name==='Lens_opaque')lenses.push(n);});
   }
   expect(owner.sharedResident()).toBe(firstGrowth);expect(existingSceneCost(three,scene)).toEqual({draws:112,triangles:77616});expect(used).toBeLessThan(FURNISHING_RESERVE_BYTES);
   expect(new Set(lenses.map(n=>n.material)).size).toBe(14);const first=lenses[0]!.material as three.MeshStandardMaterial,second=lenses[1]!.material as three.MeshStandardMaterial;first.emissive.setRGB(1,0,0);expect(second.emissive.r).toBe(0);
   const lensDisposal=lenses.map(n=>vi.spyOn(n.material as three.Material,'dispose'));
   const geometries=new Set<three.BufferGeometry>();scene.traverse(n=>{if(n instanceof three.Mesh)geometries.add(n.geometry);});expect(geometries.size).toBe(8);const disposed=[...geometries].map(g=>vi.spyOn(g,'dispose'));
   visuals[0]!.dispose();visuals[0]!.dispose();expect(release).not.toHaveBeenCalled();expect(scene.children).toHaveLength(13);expect(lensDisposal[0]).toHaveBeenCalledOnce();expect(lensDisposal[1]).not.toHaveBeenCalled();
   owner.dispose();owner.dispose();expect(scene.children).toHaveLength(0);expect(release).toHaveBeenCalledOnce();for(const spy of [...disposed,...lensDisposal])expect(spy).toHaveBeenCalledOnce();
  }finally{owner.dispose();}
 });
 it('rolls back capacity and invalid-solution failures without source mutations or merged growth and keeps unproved decode allowances',async()=>{
  const {original}=await input(),nodes=[...original.model.children],owner=createTrackSpotRenderSource(three,original,asset),noProof=createTrackSpotRenderSource(three,{...original,model:original.model.clone(true),dispose:()=>{}},asset);
  try{
   expect(noProof.baseResident).toBe(original.resident+15*4096);
   expect(()=>owner.instantiate(resolved(),0)).toThrow('CATALOG_BUDGET');expect(()=>owner.instantiate(resolved(),(15+3+4+2)*4096)).toThrow('CATALOG_BUDGET');
   const wrong=structuredClone(resolved());wrong.emitter=[0,0,0];expect(()=>owner.instantiate(wrong,FURNISHING_RESERVE_BYTES)).toThrow('WALLWASHER_MODEL_PROFILE_INVALID');
   expect(owner.sharedResident()).toBe(0);expect(original.model.children).toEqual(nodes);
   expect(()=>createTrackSpotRenderSource(three,original,{...asset,sha256:'0'.repeat(64)})).toThrow('TRACK_SPOT_AIM_SOURCE_MISMATCH');
   const visual=owner.instantiate(resolved(),FURNISHING_RESERVE_BYTES-owner.baseResident);expect(existingSceneCost(three,visual.model)).toEqual({draws:8,triangles:5544});
   const retained=owner.sharedResident();expect(()=>owner.instantiate(resolved(1),visual.resident-1)).toThrow('CATALOG_BUDGET');expect(owner.sharedResident()).toBe(retained);expect(existingSceneCost(three,visual.model)).toEqual({draws:8,triangles:5544});visual.dispose();
  }finally{noProof.dispose();owner.dispose();}
 });
});
