// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {REFINED_BENCH} from '@exhibitos/studio-contract';
import {geometryResidentBytes,modelGeometryResidentBytes} from '../viewer/loading';

/** Only the immutable refined bench admits one bounded, embedded oak PNG.
 * Twelve bytes/pixel reserve decoded CPU pixels plus GPU mip levels and margin. */
export function catalogTextureBytes(asset:{sha256:string},doc:{images?:unknown[];buffers?:Array<{uri?:string}>;bufferViews?:Array<{buffer?:number;byteOffset?:number;byteLength:number}>;textures?:unknown[]},bytes:Uint8Array,binStart:number){
 if(!doc.images?.length)return 0;
 if(asset.sha256!==REFINED_BENCH.sha256||doc.images.length!==1||doc.textures?.length!==1||doc.buffers?.length!==1||doc.buffers[0]!.uri!==undefined)throw Error('CATALOG_PROFILE');
 const image=doc.images[0] as {bufferView?:number;mimeType?:string;uri?:string};
 const view=Number.isInteger(image?.bufferView)?doc.bufferViews?.[image.bufferView!]:undefined;
 if(image?.uri!==undefined||image.mimeType!=='image/png'||!view||(view.buffer??0)!==0)throw Error('CATALOG_PROFILE');
 const offset=binStart+(view.byteOffset??0),length=view.byteLength;
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||length<24||offset<binStart||offset+length>bytes.length)throw Error('CATALOG_PROFILE');
 const png=new DataView(bytes.buffer,bytes.byteOffset+offset,length);
 if(png.getUint32(0)!==0x89504e47||png.getUint32(4)!==0x0d0a1a0a||png.getUint32(12)!==0x49484452||png.getUint32(16)!==1024||png.getUint32(20)!==512)throw Error('CATALOG_PROFILE');
 return 1024*512*12;
}

/** Shared bounded immutable GLB loader. Callers retain fallback geometry until success. */
export async function loadCatalogModel(three:typeof Three,asset:{bytes:number;sha256:string;triangles:number},source:{url:string;fetcher:typeof fetch;check:()=>Promise<void>;revision?:string;maxTextureSize?:number},signal:AbortSignal,unavailable:()=>boolean,maxTriangles:number,maxBytes:number){
 let model:Three.Object3D|undefined;const resources=new Set<{dispose():void}>();const images=new Set<{close():void}>();let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;model?.removeFromParent();for(const r of resources)r.dispose();resources.clear();for(const image of images)image.close();images.clear();};
 const active=()=>{signal.throwIfAborted();if(disposed||unavailable())throw Error('CATALOG_INACTIVE');};
 try{
  if(asset.bytes*4>maxBytes||asset.triangles>maxTriangles)throw Error('CATALOG_BUDGET');
  await source.check();active();const r=await source.fetcher(source.url,{credentials:'omit',redirect:'error',cache:'force-cache',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  try{active();}catch(e){await r.body?.cancel().catch(()=>{});throw e;}if(!r.ok||!r.body||source.revision&&r.headers.get('x-exhibitos-publication-revision')!==source.revision){await r.body?.cancel().catch(()=>{});throw Error('CATALOG_FETCH');}
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let n=0;try{for(;;){const {done,value}=await reader.read();active();if(done)break;n+=value.length;if(n>asset.bytes){await reader.cancel();throw Error('CATALOG_SIZE');}chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(n);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  active();if(n!==asset.bytes||digest!==asset.sha256)throw Error('CATALOG_INTEGRITY');
  const header=new DataView(bytes.buffer);if(n<28||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==n||header.getUint32(16,true)!==0x4e4f534a)throw Error('CATALOG_PROFILE');
  const jsonLength=header.getUint32(12,true),binBytes=n-28-jsonLength;if(binBytes<0||header.getUint32(20+jsonLength,true)!==binBytes||header.getUint32(24+jsonLength,true)!==0x004e4942)throw Error('CATALOG_PROFILE');
  const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+jsonLength))) as Parameters<typeof modelGeometryResidentBytes>[0]&{images?:unknown[];buffers?:Array<{uri?:string}>;bufferViews?:Array<{buffer?:number;byteOffset?:number;byteLength:number}>;textures?:unknown[]};
  const textureBytes=catalogTextureBytes(asset,doc,bytes,28+jsonLength);
  if(textureBytes&&(source.maxTextureSize??2048)<1024||n*4+modelGeometryResidentBytes(doc,binBytes)+textureBytes>maxBytes)throw Error('CATALOG_BUDGET');await source.check();active();
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');active();const manager=new three.LoadingManager();manager.setURLModifier(url=>{if(textureBytes&&url.startsWith('blob:'))return url;throw Error('CATALOG_EXTERNAL');});
  const gltf=await new GLTFLoader(manager).parseAsync(bytes.buffer,'');model=gltf.scene;let triangles=0;const textures=new Set<Three.Texture>();const attributes:Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>=[];
  model.traverse(node=>{if(node instanceof three.Mesh){resources.add(node.geometry);attributes.push(...Object.values(node.geometry.attributes) as Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>);if(node.geometry.index)attributes.push(node.geometry.index);triangles+=(node.geometry.index?.count??node.geometry.attributes.position?.count??0)/3;for(const material of Array.isArray(node.material)?node.material:[node.material]){resources.add(material);for(const v of Object.values(material))if(v instanceof three.Texture){textures.add(v);resources.add(v);if(v.image&&typeof v.image.close==='function')images.add(v.image);}}}});
  const resident=geometryResidentBytes(attributes)+n*4+textureBytes;active();if((textureBytes?textures.size!==1||[...textures].some(texture=>{const image=texture.image as {width?:number;height?:number}|undefined;return image?.width!==1024||image?.height!==512;}):textures.size>0)||triangles>asset.triangles||triangles>maxTriangles||resident>maxBytes)throw Error('CATALOG_BUDGET');await source.check();active();
  return {model,triangles,resident,dispose};
 }catch(error){dispose();throw error;}
}
