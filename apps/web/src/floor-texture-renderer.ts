// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {FLOOR_TEXTURE_FILES,requiredFloorTexturePacks,floorTextureFiles,floorTexturePack,type FloorBinding,type FloorMapRole,type FloorTextureFile,type FloorTexturePackDescriptor} from '@exhibitos/studio-contract';
import {MemoryAssetCache,textureResidentBytes} from './viewer/loading';
import {materialResizeDimensions} from './material-texture-plan';

export type MaterialTextureFetcher=(input:Parameters<typeof fetch>[0],init?:RequestInit,progress?:(receivedBytes:number)=>void)=>Promise<Response>;
export interface MaterialTextureFile extends Pick<FloorTextureFile,'path'|'mime'|'bytes'|'sha256'|'colorSpace'> {readonly width:number;readonly height:number}
export interface MaterialTexturePack {readonly id:string;readonly maps:Readonly<Partial<Record<FloorMapRole,MaterialTextureFile>>>}
interface TextureBinding {normalScale?:number;aoStrength?:number}

/** Same scene budget as artwork. Encoded, full decode, resized bitmap and GPU
 * residency are separate; only referenced packs are considered. */
export function floorTexturePlan(document:Exhibition,maxTextureSize:number,availableBytes:number){
 const packs=requiredFloorTexturePacks(document),files=packs.flatMap(floorTextureFiles);
 if(!files.length)return {packs,maxSize:0,reserveBytes:0,residentBytes:0,blocked:[] as string[]};
 const limit=Math.max(0,Math.floor(availableBytes*.65));
 for(let maxSize=Math.min(1024,maxTextureSize);maxSize>=128;maxSize=Math.floor(maxSize/2)){
  const residentBytes=files.reduce((n,f)=>n+textureResidentBytes(Math.min(maxSize,f.width),Math.min(maxSize,f.height)),0);
  const peak=Math.max(...files.map(f=>3*f.bytes+f.width*f.height*4+(maxSize<f.width?maxSize*maxSize*4:0)));
  if(residentBytes+peak<=limit)return {packs,maxSize,reserveBytes:residentBytes+peak,residentBytes,blocked:[] as string[]};
 }
 return {packs:[] as FloorTexturePackDescriptor[],maxSize:0,reserveBytes:0,residentBytes:0,blocked:packs.map(p=>p.id)};
}

/** Registry identity, same-origin root path and exact bytes only. These are
 * built-in assets, not artwork UUIDs or provider network resources. */
export async function fetchFloorTexture(file:FloorTextureFile,signal:AbortSignal,fetcher:typeof fetch=fetch){
 return fetchRegisteredMaterialTexture(file,FLOOR_TEXTURE_FILES,signal,fetcher);
}

/** The registry is compiled product data, never an exhibition-provided path.
 * Floor and wall materials share the same bounded, verified byte reader. */
export async function fetchRegisteredMaterialTexture(file:MaterialTextureFile,registry:readonly MaterialTextureFile[],signal:AbortSignal,fetcher:MaterialTextureFetcher=fetch){
 if(!registry.includes(file)||!/^(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.png$/.test(file.path))throw Error('FLOOR_TEXTURE_DESCRIPTOR');
 const deadline=AbortSignal.timeout(300000),idle=new AbortController();
 let idleTimer:ReturnType<typeof setTimeout>|undefined;
 const resetIdle=()=>{
  clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>idle.abort(new DOMException('Material transfer stalled','TimeoutError')),30000);
 };
 resetIdle();
 const boundedSignal=AbortSignal.any([signal,deadline,idle.signal]);
 try{
 let receivedBytes=0;
 const response=await fetcher('/'+file.path,{signal:boundedSignal,credentials:'omit',redirect:'error',cache:'force-cache'},received=>{
  if(Number.isSafeInteger(received)&&received>receivedBytes&&received<=file.bytes){receivedBytes=received;resetIdle();}
 });
 if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!==file.mime){await response.body?.cancel().catch(()=>{});throw Error('FLOOR_TEXTURE_RESPONSE');}
 const length=response.headers.get('content-length');if(length!==null&&Number(length)!==file.bytes){await response.body.cancel().catch(()=>{});throw Error('FLOOR_TEXTURE_SIZE');}
 const bytes=new Uint8Array(file.bytes),reader=response.body.getReader();let offset=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};boundedSignal.addEventListener('abort',abort,{once:true});
 try{for(;;){boundedSignal.throwIfAborted();const {done,value}=await reader.read();if(done)break;if(offset+value.length>bytes.length)throw Error('FLOOR_TEXTURE_SIZE');bytes.set(value,offset);offset+=value.length;if(value.byteLength)resetIdle();}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{boundedSignal.removeEventListener('abort',abort);reader.releaseLock();}
 boundedSignal.throwIfAborted();if(offset!==bytes.length)throw Error('FLOOR_TEXTURE_SIZE');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 boundedSignal.throwIfAborted();if(hash!==file.sha256)throw Error('FLOOR_TEXTURE_INTEGRITY');return bytes;
 }finally{clearTimeout(idleTimer);}
}

/** Bake meters/rotation into each geometry, so texture objects can be shared
 * without mutating repeat/rotation for another floor. Run before model fit. */
export function floorUvs(three:typeof Three,geometry:Three.PlaneGeometry,parent:Three.Object3D,binding:Pick<FloorBinding,'repeatMeters'|'rotation'>,offset:{x:number;y:number}={x:0,y:0}){
 parent.updateWorldMatrix(true,false);
 const scaleX=new three.Vector3().setFromMatrixColumn(parent.matrixWorld,0).length(),scaleY=new three.Vector3().setFromMatrixColumn(parent.matrixWorld,1).length();
 const matrix=new three.Matrix3().setUvTransform(0,0,1/binding.repeatMeters[0],1/binding.repeatMeters[1],binding.rotation,0,0);
 const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),point=new three.Vector2();
 for(let i=0;i<uv.count;i++){point.set((position.getX(i)+offset.x)*scaleX,(position.getY(i)+offset.y)*scaleY).applyMatrix3(matrix);uv.setXY(i,point.x,point.y);}uv.needsUpdate=true;
}

type TextureValue={texture:Three.Texture;bitmap:ImageBitmap};
export function createFloorTextureRenderer(three:typeof Three,plan:ReturnType<typeof floorTexturePlan>,signal:AbortSignal,unavailable:()=>boolean,floorFetcher?:typeof fetch){
 return createRegisteredMaterialTextureRenderer(three,{packs:plan.packs,blocked:plan.blocked,residentBytes:plan.residentBytes,sizeFor:()=>plan.maxSize},FLOOR_TEXTURE_FILES,floorTexturePack,signal,unavailable,floorFetcher);
}

export function createRegisteredMaterialTextureRenderer<B extends TextureBinding>(three:typeof Three,plan:{packs:readonly MaterialTexturePack[];blocked:readonly string[];residentBytes:number;sizeFor:(file:MaterialTextureFile)=>number},registry:readonly MaterialTextureFile[],packFor:(binding:B)=>MaterialTexturePack|undefined,signal:AbortSignal,unavailable:()=>boolean,fetcher?:MaterialTextureFetcher,allowed:(binding:B)=>boolean=()=>true,beforePublish?:()=>Promise<void>){
 type Target={material:Three.MeshStandardMaterial;binding:B;pack:MaterialTexturePack};
 const targets:Target[]=[],cache=new MemoryAssetCache<TextureValue>(Math.max(1,plan.residentBytes),value=>{value.texture.dispose();value.bitmap.close();});
 let readyMaps=new Map<MaterialTexturePack,Partial<Record<FloorMapRole,TextureValue>>>(),settled=false,reductionAttempted=false;
 const reducedOwned=new Set<TextureValue>();
 const key=(file:MaterialTextureFile)=>file.path+':'+file.sha256+':'+file.colorSpace+':'+plan.sizeFor(file);
 let disposed=false;const inactive=()=>disposed||signal.aborted||unavailable();
 const add=(material:Three.MeshStandardMaterial,binding:B)=>{const pack=packFor(binding);if(pack&&plan.packs.includes(pack))targets.push({material,binding,pack});};
 const revoke=(predicate:(binding:B)=>boolean)=>{let changed=false;const affected=new Set<MaterialTexturePack>();
  for(let i=targets.length-1;i>=0;i--){const target=targets[i]!;if(!predicate(target.binding))continue;target.material.map=null;target.material.roughnessMap=null;target.material.normalMap=null;target.material.aoMap=null;target.material.needsUpdate=true;affected.add(target.pack);targets.splice(i,1);changed=true;}
  for(const pack of affected)if(!targets.some(target=>target.pack===pack)&&readyMaps.has(pack)){readyMaps.delete(pack);for(const file of Object.values(pack.maps))if(file){cache.release(key(file));cache.delete(key(file));}}
  return changed;
 };
 async function load(file:MaterialTextureFile){
  const maxSize=plan.sizeFor(file);if(!Number.isSafeInteger(maxSize)||maxSize<1||maxSize>Math.max(file.width,file.height))throw Error('FLOOR_TEXTURE_BUDGET');
  const known=cache.acquire(key(file));if(known)return known;
  const bytes=await fetchRegisteredMaterialTexture(file,registry,signal,fetcher);if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
  let bitmap:ImageBitmap|undefined,texture:Three.Texture|undefined;
  try{
   bitmap=await createImageBitmap(new Blob([bytes],{type:file.mime}),{imageOrientation:'flipY',colorSpaceConversion:'none',premultiplyAlpha:'none'});
   if(bitmap.width!==file.width||bitmap.height!==file.height)throw Error('FLOOR_TEXTURE_DIMENSIONS');
   if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
   if(bitmap.width>maxSize||bitmap.height>maxSize){const original=bitmap,size=materialResizeDimensions(bitmap.width,bitmap.height,maxSize);bitmap=undefined;try{bitmap=await createImageBitmap(original,{imageOrientation:'none',colorSpaceConversion:'none',premultiplyAlpha:'none',resizeWidth:size.width,resizeHeight:size.height,resizeQuality:'high'});}finally{original.close();}}
   if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
   texture=new three.Texture(bitmap);texture.flipY=false;texture.colorSpace=file.colorSpace==='srgb'?three.SRGBColorSpace:three.NoColorSpace;
   texture.wrapS=texture.wrapT=three.RepeatWrapping;texture.minFilter=three.LinearMipmapLinearFilter;texture.magFilter=three.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
   const value={texture,bitmap};texture=undefined;bitmap=undefined;
   if(!cache.set(key(file),value,textureResidentBytes(value.bitmap.width,value.bitmap.height)))throw Error('FLOOR_TEXTURE_BUDGET');
   cache.acquire(key(file));return value;
  }finally{texture?.dispose();bitmap?.close();}
 }
 const publish=(target:Target,maps:Partial<Record<FloorMapRole,TextureValue>>)=>{
  target.material.map=maps.color?.texture??null;target.material.roughnessMap=maps.roughness?.texture??null;target.material.normalMap=maps.normal?.texture??null;
  target.material.normalScale.setScalar(target.binding.normalScale??1);target.material.aoMap=maps.ao?.texture??null;target.material.aoMapIntensity=target.binding.aoStrength??1;target.material.needsUpdate=true;
 };
 return {add,revoke,async start(changed:()=>void){
  // One map at a time; all roles must be ready before any material uses a pack.
  const status:Record<string,string>=Object.fromEntries(plan.blocked.map(id=>[id,'budget-fallback']));
  for(const pack of plan.packs){
   if(inactive())break;
   revoke(binding=>!allowed(binding));
   if(!targets.some(target=>target.pack===pack)){status[pack.id]='unavailable';continue;}
   const maps:Partial<Record<FloorMapRole,TextureValue>>={},loadedFiles:MaterialTextureFile[]=[];
   try{for(const [role,file]of Object.entries(pack.maps)){if(file){maps[role as FloorMapRole]=await load(file);loadedFiles.push(file);}}
    if(inactive())break;
    if(beforePublish)await beforePublish();
    if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
    revoke(binding=>!allowed(binding));
    if(!targets.some(target=>target.pack===pack)){for(const file of loadedFiles){cache.release(key(file));cache.delete(key(file));}status[pack.id]='unavailable';continue;}
    for(const target of targets.filter(t=>t.pack===pack))publish(target,maps);
    readyMaps.set(pack,maps);
    status[pack.id]='ready';
   }catch{status[pack.id]=inactive()?'cancelled':'fallback';for(const file of loadedFiles){cache.release(key(file));cache.delete(key(file));}}
   // Rendering notification is separate from byte/decode admission. A callback
   // failure must not dispose textures that were already published to a mesh.
   if(status[pack.id]==='ready')try{changed();}catch{status[pack.id]='render-failed';}
  }
  settled=true;return status;
 },async reduceForArtwork(reserve:(bytes:number)=>()=>void,prepare:(texture:Three.Texture)=>void):Promise<number|undefined>{
  // One pressure-driven rollback of optional material resolution per lifetime.
  // Reuse retained bitmaps: no refetch, source decode, role loss or new cache.
  if(!settled||inactive()||reductionAttempted||!readyMaps.size)return;
  reductionAttempted=true;
  const old=[...new Set([...readyMaps.values()].flatMap(m=>Object.values(m)))],sizes=old.map(v=>materialResizeDimensions(v.bitmap.width,v.bitmap.height,Math.max(128,Math.floor(Math.max(v.bitmap.width,v.bitmap.height)/2))));
  if(!old.some((v,i)=>sizes[i]!.width<v.bitmap.width||sizes[i]!.height<v.bitmap.height))return;
  const residentBytes=sizes.reduce((n,size)=>n+textureResidentBytes(size.width,size.height),0);
  // Old CPU/GPU images stay charged; reserve new CPU/GPU plus one serial
  // resize source copy before the first allocation or upload.
  const release=reserve(residentBytes+Math.max(...old.map(v=>v.bitmap.width*v.bitmap.height*4)));
  const replacements=new Map<TextureValue,TextureValue>();
  let committed=false;
  try{
   for(const [i,value]of old.entries()){
    if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
    const bitmap=await createImageBitmap(value.bitmap,{imageOrientation:'none',colorSpaceConversion:'none',premultiplyAlpha:'none',resizeWidth:sizes[i]!.width,resizeHeight:sizes[i]!.height,resizeQuality:'high'});
    if(inactive()){bitmap.close();throw Error('FLOOR_TEXTURE_CANCELLED');}
    let texture:Three.Texture|undefined;
    try{texture=new three.Texture(bitmap);texture.flipY=value.texture.flipY;texture.colorSpace=value.texture.colorSpace;texture.wrapS=value.texture.wrapS;texture.wrapT=value.texture.wrapT;texture.minFilter=value.texture.minFilter;texture.magFilter=value.texture.magFilter;texture.generateMipmaps=value.texture.generateMipmaps;texture.needsUpdate=true;prepare(texture);replacements.set(value,{texture,bitmap});}
    catch(error){texture?.dispose();bitmap.close();throw error;}
   }
   if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
   const next=new Map<MaterialTexturePack,Partial<Record<FloorMapRole,TextureValue>>>();
   for(const [pack,maps]of readyMaps)next.set(pack,Object.fromEntries(Object.entries(maps).map(([role,value])=>[role,replacements.get(value)!])));
   for(const target of targets){const maps=next.get(target.pack);if(maps)publish(target,maps);}
   readyMaps=next;for(const value of replacements.values())reducedOwned.add(value);
   committed=true;cache.clear();return residentBytes;
  }finally{
   if(!committed)for(const value of replacements.values()){value.texture.dispose();value.bitmap.close();}
   release();
  }
 },dispose(){if(disposed)return;disposed=true;for(const {material}of targets){material.map=null;material.roughnessMap=null;material.normalMap=null;material.aoMap=null;}cache.clear();for(const value of reducedOwned){value.texture.dispose();value.bitmap.close();}reducedOwned.clear();readyMaps.clear();targets.length=0;}};
}
