// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {embeddedPNGManager} from '../embedded-glb';
import {prepareArtworkGlb} from './artwork-glb-preparation';
import {retireArtworkResources} from './artwork-ownership';
import {gpuModelCapability,gpuModelRecipeFormat} from './gpu-model-capability';
import {AssetReleaseUnconfirmedError,geometryResidentBytes,textureResidentBytes,type DeviceBudget} from './loading';

type Resource={dispose():void};
type Budget=Pick<DeviceBudget,'maxTriangles'|'maxTextureSize'|'maxCacheBytes'>;
/** A retained rejected acknowledgement must never become a later false success. */
function retirement(resource:Resource):Resource {
 let acknowledgement:Promise<void>|undefined,retired=false;
 return {dispose(){
  if(retired)return;
  return acknowledgement??=Promise.resolve().then(()=>resource.dispose()).then(()=>{retired=true;});
 }};
}

/** Only the closed GPU-model recipe. Caller owns verified inventory/rights and
 * encoded/header peak admission before this call, then shader preparation and
 * attachment after it. No cache, upload, fallback, or budget discount here. */
export async function loadGpuModel(three:typeof Three,renderer:Three.WebGLRenderer,bytes:ArrayBuffer,signal:AbortSignal,budget:Budget,maxTriangles=200000):Promise<{
 object:Three.Object3D;resources:Resource[];backing:ReturnType<typeof embeddedPNGManager>;targetFormat:'astc-4x4'|'bc7';
}>{
 const resources:Resource[]=[];
 let backing:ReturnType<typeof embeddedPNGManager>|undefined;
 let setupMayOwnAsync=false;
 let compressed:Parameters<typeof embeddedPNGManager>[2];
 try {
  signal.throwIfAborted();
  if(![budget.maxTriangles,budget.maxTextureSize,budget.maxCacheBytes,maxTriangles].every(value=>Number.isSafeInteger(value)&&value>0))throw Error('GPU_MODEL_BUDGET');
  // A deferred proxy permits the manager's complete embedded recipe/PNG-pair
  // preflight before any decoder import/init. It cannot parse before setup.
  const proxy={parse(data:ArrayBuffer,onLoad:(texture:Three.Texture)=>void,onError:(error:unknown)=>void){
   if(!compressed){onError(Error('GPU_MODEL_DECODER_UNAVAILABLE'));return;}
   compressed.parse(data,onLoad,onError);
  }};
  const manager=new three.LoadingManager();
  backing=embeddedPNGManager(manager,bytes,proxy,undefined,'gpu-model-v1');
  resources.push(backing);
  const caps=await gpuModelCapability(renderer);signal.throwIfAborted();
  if(!caps.astcSupported&&!caps.bptcSupported)throw Error('GPU_MODEL_UNSUPPORTED');
  const prepared=await prepareArtworkGlb(renderer,bytes,signal,value=>{setupMayOwnAsync=value;},undefined,true);
  // A returned decoder is known ownership; failed setup is distinct and may
  // still lack a positive retirement acknowledgement.
  setupMayOwnAsync=false;
  const worker=prepared.basis?retirement(prepared.basis):undefined;
  if(worker)resources.push(worker);
  if(!prepared.basis)throw Error('GPU_MODEL_DECODER_UNAVAILABLE');
  compressed=prepared.basis;
  signal.throwIfAborted();
  const cancel=()=>backing!.dispose();
  signal.addEventListener('abort',cancel,{once:true});
  let object:Three.Object3D;
  try {
   // Use the same protected manager for all immutable embedded handlers.
   const loader=new prepared.GLTFLoader(manager);
   if(!backing.ktx2Loader)throw Error('GPU_MODEL_DECODER_UNAVAILABLE');
   loader.setKTX2Loader(backing.ktx2Loader as never);
   object=(await loader.parseAsync(backing.bytes,'')).scene;
   object.traverse(node=>{
    if(!(node instanceof three.Mesh))return;
    resources.push(node.geometry);
    for(const material of Array.isArray(node.material)?node.material:[node.material]){
     resources.push(material);
     for(const value of Object.values(material))if(value instanceof three.Texture)resources.push(value);
    }
   });
   await backing.drain();
  } finally {signal.removeEventListener('abort',cancel);}
  backing.assertLoaded();signal.throwIfAborted();
  const attributes:Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>=[],textures=new Set<Three.Texture>(),colour=new Set<Three.Texture>();
  let triangles=0;
  object.traverse(node=>{
   if(!(node instanceof three.Mesh))return;
   triangles+=(node.geometry.index?.count??node.geometry.attributes.position?.count??0)/3;
   attributes.push(...Object.values(node.geometry.attributes) as Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>);
   if(node.geometry.index)attributes.push(node.geometry.index);
   for(const material of Array.isArray(node.material)?node.material:[node.material]){
    const pbr=material as Three.MeshStandardMaterial;
    if(!pbr.map||!pbr.normalMap||!pbr.aoMap||pbr.map.colorSpace!==three.SRGBColorSpace||pbr.normalMap.colorSpace!==three.NoColorSpace||pbr.aoMap.colorSpace!==three.NoColorSpace)throw Error('GPU_MODEL_TEXTURE_ROLE');
    colour.add(pbr.map);
    for(const value of Object.values(material))if(value instanceof three.Texture)textures.add(value);
   }
  });
  if(!Number.isSafeInteger(triangles)||triangles<1||triangles>Math.min(budget.maxTriangles,maxTriangles,200000))throw Error('MODEL_TRIANGLE_BUDGET');
  if(colour.size!==1)throw Error('GPU_MODEL_TEXTURE_FORMAT');
  const base=[...colour][0]!;
  if(!(base instanceof three.CompressedTexture)||!gpuModelRecipeFormat(base.format)||base.format===three.RGBA_ASTC_4x4_Format&&!caps.astcSupported||base.format===three.RGBA_BPTC_Format&&!caps.bptcSupported)throw Error('GPU_MODEL_TEXTURE_FORMAT');
  let textureBytes=0;
  for(const texture of textures){
   if(!backing.ownsTexture(texture)||texture!==base&&texture instanceof three.CompressedTexture)throw Error('GPU_MODEL_TEXTURE_FORMAT');
   const image=texture.image as {width?:number;height?:number}|undefined,w=image?.width,h=image?.height;
   if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w!<1||h!<1||Math.max(w!,h!)>budget.maxTextureSize)throw Error('GPU_MODEL_TEXTURE_BUDGET');
   if(texture===base){
    const levels=Math.floor(Math.log2(Math.max(w!,h!)))+1;
    if(base.mipmaps.length!==levels||base.mipmaps.some((mip,index)=>mip.width!==Math.max(1,w!>>index)||mip.height!==Math.max(1,h!>>index)))throw Error('GPU_MODEL_TEXTURE_MIPS');
   }
   // Conservative existing backing+GPU estimate, including raw PNG normals/AO.
   textureBytes+=textureResidentBytes(w!,h!);
  }
  if(backing.bytes.byteLength+geometryResidentBytes(attributes)+textureBytes>budget.maxCacheBytes)throw Error('MODEL_RESIDENT_BUDGET');
  // Child callbacks are drained before stopping their one transcoder. Return
  // only after its positive acknowledgement; wrapper remains safe in resources.
  await worker!.dispose();signal.throwIfAborted();
  return {object,resources,backing,targetFormat:base.format===three.RGBA_ASTC_4x4_Format?'astc-4x4':'bc7'};
 } catch(error){
  await retireArtworkResources(resources,backing);
  if(setupMayOwnAsync)throw new AssetReleaseUnconfirmedError({cause:error});
  throw error;
 }
}
