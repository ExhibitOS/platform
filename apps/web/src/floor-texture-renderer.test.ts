// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {FLOOR_NAMESPACE,FLOOR_TEXTURE_FILES,floorPresetDefaults,type FloorBinding} from '@exhibitos/studio-contract';
import {floorUvs,floorTexturePlan,fetchFloorTexture,createRegisteredMaterialTextureRenderer,type MaterialTextureFile} from './floor-texture-renderer';
import {textureResidentBytes} from './viewer/loading';
const room='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
const binding:FloorBinding={...floorPresetDefaults('wood'),target:{kind:'surface',surfaceId:surface},repeatMeters:[2,4],rotation:0};
test('separate panels keep continuous meter UVs through room/surface scale and room rotation',()=>{
 const parent=new three.Group(),roomGroup=new three.Group();roomGroup.rotation.y=.7;roomGroup.scale.set(2,3,1);roomGroup.add(parent);parent.scale.set(2,1,1);
 const left=new three.PlaneGeometry(2,2),right=new three.PlaneGeometry(2,2);
 floorUvs(three,left,parent,binding,{x:-1,y:0});floorUvs(three,right,parent,binding,{x:1,y:0});
 const a=left.getAttribute('uv'),b=right.getAttribute('uv');
 // Top and bottom vertices at the common edge agree; width is eight meters.
 expect(a.getX(1)).toBeCloseTo(b.getX(0));expect(a.getY(1)).toBeCloseTo(b.getY(0));
 expect(a.getX(3)).toBeCloseTo(b.getX(2));expect(a.getY(3)).toBeCloseTo(b.getY(2));
 expect(a.getX(1)-a.getX(0)).toBeCloseTo(4);expect(a.getY(0)-a.getY(2)).toBeCloseTo(1.5);
 left.dispose();right.dispose();
});
test('an implicit base uses room local zero and its depth axis, with independent authored rotation',()=>{
 const roomGroup=new three.Group();roomGroup.position.set(8,3,-2);roomGroup.scale.set(2,1,3);
 const geometry=new three.PlaneGeometry(4,6),base=new three.Mesh(geometry);base.rotation.x=-Math.PI/2;roomGroup.add(base);
 floorUvs(three,geometry,base,{...binding,rotation:Math.PI/2});
 expect(base.position.toArray()).toEqual([0,0,0]);const uv=geometry.getAttribute('uv');
 expect(uv.getY(1)-uv.getY(0)).toBeCloseTo(-2);expect(uv.getX(0)-uv.getX(2)).toBeCloseTo(9);
 geometry.dispose();(base.material as three.Material).dispose();
});
function documentFor(bindings:FloorBinding[],authoredFloor=true){return {rooms:[{id:room}],surfaces:authoredFloor?[{id:surface,type:'floor',roomId:room}]:[],mediaAssets:[],extensions:{[FLOOR_NAMESPACE]:{version:1,bindings}}} as unknown as Exhibition;}
test('only active referenced packs reserve memory; all four fit by shared bounded downsampling without loading inactive bases',()=>{
 const presets=['wood','marble','tile','carpet'] as const;
 const rooms=presets.map((_,i)=>`11111111-1111-4111-8111-11111111111${i}`);
 const doc={rooms:rooms.map(id=>({id})),surfaces:[],mediaAssets:[],extensions:{[FLOOR_NAMESPACE]:{version:1,bindings:presets.map((p,i)=>({...floorPresetDefaults(p),target:{kind:'room-base',roomId:rooms[i]!}}))}}} as unknown as Exhibition;
 for(const budget of [24*1024*1024,90*1024*1024]){const plan=floorTexturePlan(doc,budget<30*1024*1024?512:2048,budget);expect(plan.packs).toHaveLength(4);expect(plan.reserveBytes).toBeLessThanOrEqual(Math.floor(budget*.65));expect(plan.maxSize).toBeGreaterThanOrEqual(128);}
 const inactive=floorTexturePlan(documentFor([{...binding,target:{kind:'room-base',roomId:room}}]),512,32*1024*1024);expect(inactive.reserveBytes).toBe(0);expect(inactive.packs).toEqual([]);
 const blocked=floorTexturePlan(documentFor([binding]),512,1);expect(blocked.packs).toEqual([]);expect(blocked.blocked).toEqual(['WoodFloor051']);
});
test('the shared reader retains registered legacy floor paths and rejects copied descriptors',async()=>{
 const file=FLOOR_TEXTURE_FILES[0]!,signal=new AbortController().signal,paths:string[]=[];
 const fetcher=(async(path:string|URL|Request)=>{paths.push(String(path));return new Response(null,{status:404});}) as typeof fetch;
 await expect(fetchFloorTexture(file,signal,fetcher)).rejects.toThrow('FLOOR_TEXTURE_RESPONSE');
 expect(paths).toEqual(['/'+file.path]);
 await expect(fetchFloorTexture({...file},signal,fetcher)).rejects.toThrow('FLOOR_TEXTURE_DESCRIPTOR');
 expect(paths).toHaveLength(1);
});
test('identical PNG bytes used for color and a scalar map retain distinct GPU color spaces',async()=>{
 const bytes=new Uint8Array([1,2,3]),sha256=createHash('sha256').update(bytes).digest('hex'),closed=vi.fn();
 const color:MaterialTextureFile={...FLOOR_TEXTURE_FILES[0]!,path:'material-test/shared.png',bytes:3,sha256,width:1,height:1,colorSpace:'srgb'},roughness:MaterialTextureFile={...color,colorSpace:'linear'};
 const pack={id:'test',maps:{color,roughness}},material=new three.MeshStandardMaterial(),binding={normalScale:1};
 vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close:closed}));
 const loader=createRegisteredMaterialTextureRenderer(three,{packs:[pack],blocked:[],residentBytes:64,sizeFor:()=>1},[color,roughness],()=>pack,new AbortController().signal,()=>false,(async()=>new Response(bytes,{headers:{'content-type':'image/png'}})) as typeof fetch);
 try{loader.add(material,binding);expect(await loader.start(()=>{})).toEqual({test:'ready'});expect(material.map).not.toBe(material.roughnessMap);expect(material.map!.colorSpace).toBe(three.SRGBColorSpace);expect(material.roughnessMap!.colorSpace).toBe(three.NoColorSpace);}
 finally{loader.dispose();material.dispose();vi.unstubAllGlobals();}
 expect(closed).toHaveBeenCalledTimes(2);expect(material.map).toBeNull();expect(material.roughnessMap).toBeNull();
});
test('a failed pack releases only its own leases on an already displayed shared texture',async()=>{
 const bytes=new Uint8Array([1,2,3]),closed=vi.fn(),shared:MaterialTextureFile={...FLOOR_TEXTURE_FILES[0]!,path:'material-test/shared.png',bytes:3,sha256:createHash('sha256').update(bytes).digest('hex'),width:1,height:1},bad:MaterialTextureFile={...shared,path:'material-test/missing.png',sha256:'0'.repeat(64)};
 const ready={id:'ready',maps:{color:shared}},failed={id:'failed',maps:{color:shared,normal:bad}},a=new three.MeshStandardMaterial(),b=new three.MeshStandardMaterial();
 vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close:closed}));
 const loader=createRegisteredMaterialTextureRenderer(three,{packs:[ready,failed],blocked:[],residentBytes:128,sizeFor:()=>1},[shared,bad],(binding:{normalScale:number;pack:typeof ready|typeof failed})=>binding.pack,new AbortController().signal,()=>false,(async(path)=>String(path).includes('missing')?new Response(null,{status:404}):new Response(bytes,{headers:{'content-type':'image/png'}})) as typeof fetch);
 try{loader.add(a,{normalScale:1,pack:ready});loader.add(b,{normalScale:1,pack:failed});expect(await loader.start(()=>{})).toEqual({ready:'ready',failed:'fallback'});expect(a.map).not.toBeNull();expect(b.map).toBeNull();expect(closed).not.toHaveBeenCalled();}
 finally{loader.dispose();a.dispose();b.dispose();vi.unstubAllGlobals();}
 expect(closed).toHaveBeenCalledTimes(1);
});
test('linear map output sizes stay distinct and notification failure keeps published textures alive',async()=>{
 const bytes=new Uint8Array([1,2,3]),closed=vi.fn(),normal:MaterialTextureFile={...FLOOR_TEXTURE_FILES[0]!,path:'material-test/shared.png',bytes:3,sha256:createHash('sha256').update(bytes).digest('hex'),width:4,height:4,colorSpace:'linear'},roughness={...normal};
 const pack={id:'test',maps:{roughness,normal}},material=new three.MeshStandardMaterial();
 vi.stubGlobal('createImageBitmap',async(_source:unknown,options?:{resizeWidth?:number;resizeHeight?:number})=>({width:options?.resizeWidth??4,height:options?.resizeHeight??4,close:closed}));
 const loader=createRegisteredMaterialTextureRenderer(three,{packs:[pack],blocked:[],residentBytes:256,sizeFor:f=>f===roughness?2:4},[normal,roughness],()=>pack,new AbortController().signal,()=>false,(async()=>new Response(bytes,{headers:{'content-type':'image/png'}})) as typeof fetch);
 try{loader.add(material,{normalScale:1});expect(await loader.start(()=>{throw Error('render failed');})).toEqual({test:'render-failed'});expect(material.normalMap).not.toBe(material.roughnessMap);expect(material.normalMap!.image).toMatchObject({width:4});expect(material.roughnessMap!.image).toMatchObject({width:2});expect(closed).toHaveBeenCalledTimes(1);}
 finally{loader.dispose();material.dispose();vi.unstubAllGlobals();}
 expect(closed).toHaveBeenCalledTimes(3);
});

test('artwork pressure reserves before resize and atomically retains every material role until uploaded',async()=>{
 const bytes=new Uint8Array([1,2,3]),hash=createHash('sha256').update(bytes).digest('hex');
 const color:MaterialTextureFile={...FLOOR_TEXTURE_FILES[0]!,path:'material-test/shared.png',bytes:3,sha256:hash,width:1024,height:1024,colorSpace:'srgb'},normal={...color,colorSpace:'linear' as const},roughness={...normal};
 const pack={id:'pressure',maps:{color,normal,roughness}},material=new three.MeshStandardMaterial(),abort=new AbortController(),bitmaps:{width:number;height:number;close:ReturnType<typeof vi.fn>}[]=[],fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));
 vi.stubGlobal('createImageBitmap',async(_source:unknown,options?:{resizeWidth?:number;resizeHeight?:number})=>{const value={width:options?.resizeWidth??1024,height:options?.resizeHeight??1024,close:vi.fn()};bitmaps.push(value);return value;});
 const loader=createRegisteredMaterialTextureRenderer(three,{packs:[pack],blocked:[],residentBytes:32*1024*1024,sizeFor:f=>f===roughness?512:1024},[color,normal,roughness],()=>pack,abort.signal,()=>false,fetcher as typeof fetch);
 try{
  loader.add(material,{normalScale:.7});await loader.start(()=>{});
  const old=[material.map!,material.normalMap!,material.roughnessMap!],disposed=old.map(t=>vi.spyOn(t,'dispose')),oldImages=old.map(t=>t.image as typeof bitmaps[number]);
  const release=vi.fn(),newResident=2*textureResidentBytes(512,512)+textureResidentBytes(256,256),reserve=vi.fn((size:number)=>{expect(size).toBe(newResident+1024*1024*4);expect(bitmaps).toHaveLength(4);return release;}),prepare=vi.fn(()=>{expect(material.map).toBe(old[0]);expect(material.normalMap).toBe(old[1]);expect(material.roughnessMap).toBe(old[2]);for(const image of oldImages)expect(image.close).not.toHaveBeenCalled();});
  expect(await loader.reduceForArtwork(reserve,prepare)).toBe(newResident);
  expect(prepare).toHaveBeenCalledTimes(3);expect(release).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(3);
  expect((material.map!.image as {width:number}).width).toBe(512);expect((material.normalMap!.image as {width:number}).width).toBe(512);expect((material.roughnessMap!.image as {width:number}).width).toBe(256);expect(material.map!.colorSpace).toBe(three.SRGBColorSpace);expect(material.normalMap!.colorSpace).toBe(three.NoColorSpace);expect(material.normalScale.x).toBe(.7);
  for(const image of oldImages)expect(image.close).toHaveBeenCalledTimes(1);for(const dispose of disposed)expect(dispose).toHaveBeenCalledTimes(1);
  expect(await loader.reduceForArtwork(reserve,prepare)).toBeUndefined();expect(reserve).toHaveBeenCalledTimes(1);
 }finally{loader.dispose();material.dispose();vi.unstubAllGlobals();}
 for(const bitmap of bitmaps)expect(bitmap.close).toHaveBeenCalledTimes(1);
});

test('failed or revoked material reduction preserves old roles and releases only new allocations',async()=>{
 for(const outcome of ['upload-failed','revoked','reserve-failed'] as const){
  const bytes=new Uint8Array([1,2,3]),file:MaterialTextureFile={...FLOOR_TEXTURE_FILES[0]!,path:'material-test/shared.png',bytes:3,sha256:createHash('sha256').update(bytes).digest('hex'),width:512,height:512},pack={id:'pressure',maps:{color:file,normal:file}},material=new three.MeshStandardMaterial(),abort=new AbortController(),bitmaps:{width:number;height:number;close:ReturnType<typeof vi.fn>}[]=[];
  vi.stubGlobal('createImageBitmap',async(_source:unknown,options?:{resizeWidth?:number;resizeHeight?:number})=>{const value={width:options?.resizeWidth??512,height:options?.resizeHeight??512,close:vi.fn()};bitmaps.push(value);if(options?.resizeWidth&&outcome==='revoked')abort.abort();return value;});
  const loader=createRegisteredMaterialTextureRenderer(three,{packs:[pack],blocked:[],residentBytes:8*1024*1024,sizeFor:()=>512},[file],()=>pack,abort.signal,()=>false,(async()=>new Response(bytes,{headers:{'content-type':'image/png'}})) as typeof fetch);
  try{
   loader.add(material,{normalScale:1});await loader.start(()=>{});const old=material.map!,image=old.image as typeof bitmaps[number],release=vi.fn();
   await expect(loader.reduceForArtwork(()=>{if(outcome==='reserve-failed')throw Error('NO_TRANSITION_ROOM');return release;},()=>{throw Error('UPLOAD_FAILED');})).rejects.toThrow();
   expect(material.map).toBe(old);expect(material.normalMap).toBe(old);expect(image.close).not.toHaveBeenCalled();expect(release).toHaveBeenCalledTimes(outcome==='reserve-failed'?0:1);expect(bitmaps).toHaveLength(outcome==='reserve-failed'?1:2);if(bitmaps[1])expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
  }finally{loader.dispose();material.dispose();vi.unstubAllGlobals();}
  for(const bitmap of bitmaps)expect(bitmap.close).toHaveBeenCalledTimes(1);
 }
});
