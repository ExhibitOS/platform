// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {FLOOR_TEXTURE_FILES,requiredFloorTexturePacks,floorTextureFiles,floorTexturePack,type FloorBinding,type FloorMapRole,type FloorTextureFile,type FloorTexturePackDescriptor} from '@exhibitos/studio-contract';
import {MemoryAssetCache,textureResidentBytes} from './viewer/loading';

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
 if(!FLOOR_TEXTURE_FILES.includes(file))throw Error('FLOOR_TEXTURE_DESCRIPTOR');
 const boundedSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
 const response=await fetcher('/'+file.path,{signal:boundedSignal,credentials:'omit',redirect:'error',cache:'force-cache'});
 if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!==file.mime){await response.body?.cancel().catch(()=>{});throw Error('FLOOR_TEXTURE_RESPONSE');}
 const length=response.headers.get('content-length');if(length!==null&&Number(length)!==file.bytes){await response.body.cancel().catch(()=>{});throw Error('FLOOR_TEXTURE_SIZE');}
 const bytes=new Uint8Array(file.bytes),reader=response.body.getReader();let offset=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};boundedSignal.addEventListener('abort',abort,{once:true});
 try{for(;;){boundedSignal.throwIfAborted();const {done,value}=await reader.read();if(done)break;if(offset+value.length>bytes.length)throw Error('FLOOR_TEXTURE_SIZE');bytes.set(value,offset);offset+=value.length;}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{boundedSignal.removeEventListener('abort',abort);reader.releaseLock();}
 boundedSignal.throwIfAborted();if(offset!==bytes.length)throw Error('FLOOR_TEXTURE_SIZE');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 boundedSignal.throwIfAborted();if(hash!==file.sha256)throw Error('FLOOR_TEXTURE_INTEGRITY');return bytes;
}

/** Bake meters/rotation into each geometry, so texture objects can be shared
 * without mutating repeat/rotation for another floor. Run before model fit. */
export function floorUvs(three:typeof Three,geometry:Three.PlaneGeometry,parent:Three.Object3D,binding:FloorBinding,offset:{x:number;y:number}={x:0,y:0}){
 parent.updateWorldMatrix(true,false);
 const scaleX=new three.Vector3().setFromMatrixColumn(parent.matrixWorld,0).length(),scaleY=new three.Vector3().setFromMatrixColumn(parent.matrixWorld,1).length();
 const matrix=new three.Matrix3().setUvTransform(0,0,1/binding.repeatMeters[0],1/binding.repeatMeters[1],binding.rotation,0,0);
 const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),point=new three.Vector2();
 for(let i=0;i<uv.count;i++){point.set((position.getX(i)+offset.x)*scaleX,(position.getY(i)+offset.y)*scaleY).applyMatrix3(matrix);uv.setXY(i,point.x,point.y);}uv.needsUpdate=true;
}

type TextureValue={texture:Three.Texture;bitmap:ImageBitmap};
type Target={material:Three.MeshStandardMaterial;binding:FloorBinding;pack:FloorTexturePackDescriptor};
export function createFloorTextureRenderer(three:typeof Three,plan:ReturnType<typeof floorTexturePlan>,signal:AbortSignal,unavailable:()=>boolean,floorFetcher?:typeof fetch){
 const targets:Target[]=[],cache=new MemoryAssetCache<TextureValue>(Math.max(1,plan.residentBytes),value=>{value.texture.dispose();value.bitmap.close();});
 let disposed=false;const inactive=()=>disposed||signal.aborted||unavailable();
 const add=(material:Three.MeshStandardMaterial,binding:FloorBinding)=>{const pack=floorTexturePack(binding);if(pack&&plan.packs.includes(pack))targets.push({material,binding,pack});};
 async function load(file:FloorTextureFile){
  const known=cache.get(file.sha256);if(known)return known;
  const bytes=await fetchFloorTexture(file,signal,floorFetcher);if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
  let bitmap:ImageBitmap|undefined,texture:Three.Texture|undefined;
  try{
   bitmap=await createImageBitmap(new Blob([bytes],{type:file.mime}),{imageOrientation:'flipY',colorSpaceConversion:'none',premultiplyAlpha:'none'});
   if(bitmap.width!==file.width||bitmap.height!==file.height)throw Error('FLOOR_TEXTURE_DIMENSIONS');
   if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
   if(bitmap.width>plan.maxSize||bitmap.height>plan.maxSize){const original=bitmap;bitmap=undefined;try{bitmap=await createImageBitmap(original,{imageOrientation:'none',colorSpaceConversion:'none',premultiplyAlpha:'none',resizeWidth:plan.maxSize,resizeHeight:plan.maxSize,resizeQuality:'high'});}finally{original.close();}}
   if(inactive())throw Error('FLOOR_TEXTURE_CANCELLED');
   texture=new three.Texture(bitmap);texture.flipY=false;texture.colorSpace=file.colorSpace==='srgb'?three.SRGBColorSpace:three.NoColorSpace;
   texture.wrapS=texture.wrapT=three.RepeatWrapping;texture.minFilter=three.LinearMipmapLinearFilter;texture.magFilter=three.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
   const value={texture,bitmap};texture=undefined;bitmap=undefined;
   if(!cache.set(file.sha256,value,textureResidentBytes(value.bitmap.width,value.bitmap.height)))throw Error('FLOOR_TEXTURE_BUDGET');
   cache.acquire(file.sha256);return value;
  }finally{texture?.dispose();bitmap?.close();}
 }
 return {add,async start(changed:()=>void){
  // One map at a time; all roles must be ready before any material uses a pack.
  const status:Record<string,string>=Object.fromEntries(plan.blocked.map(id=>[id,'budget-fallback']));
  for(const pack of plan.packs){
   if(inactive())break;
   const maps:Partial<Record<FloorMapRole,Three.Texture>>={};
   try{for(const [role,file]of Object.entries(pack.maps)){if(file)maps[role as FloorMapRole]=(await load(file)).texture;}
    if(inactive())break;
    for(const target of targets.filter(t=>t.pack===pack)){
     target.material.map=maps.color??null;target.material.roughnessMap=maps.roughness??null;target.material.normalMap=maps.normal??null;
     target.material.normalScale.setScalar(target.binding.normalScale??1);target.material.aoMap=maps.ao??null;target.material.aoMapIntensity=target.binding.aoStrength??1;target.material.needsUpdate=true;
    }
    status[pack.id]='ready';changed();
   }catch{status[pack.id]=inactive()?'cancelled':'fallback';for(const file of floorTextureFiles(pack)){cache.release(file.sha256);cache.delete(file.sha256);}}
  }
  return status;
 },dispose(){if(disposed)return;disposed=true;for(const {material}of targets){material.map=null;material.roughnessMap=null;material.normalMap=null;material.aoMap=null;}cache.clear();targets.length=0;}};
}
