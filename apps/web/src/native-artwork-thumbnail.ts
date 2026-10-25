// SPDX-License-Identifier: AGPL-3.0-or-later
import {basisLoader} from './basis-loader.js';
import {embeddedPNGManager} from './embedded-glb.js';
import {centerMetricModel,metricCameraFit} from './viewer/metric-model.js';
import type {ThumbnailRequest} from './native-catalog-protocol';
const maxBytes=16*1024*1024;
async function bounded(response:Response,signal:AbortSignal){
 if(!response.ok||!response.body)throw Error('THUMBNAIL_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw Error('THUMBNAIL_SIZE');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
/** One static frame, using existing guarded GLB decoding and metric fit; no scene per card. */
export async function produceArtworkThumbnail(request:ThumbnailRequest,signal:AbortSignal){
 const path=`/api/v1/tenants/${request.tenantId}/cms/artworks/${request.artworkId}`;
 const options={credentials:'same-origin' as const,redirect:'error' as const,cache:'no-store' as const,signal};
 const metadataResponse=await fetch(path,options);if(!metadataResponse.ok)throw Error('THUMBNAIL_UNAVAILABLE');
 const artwork=await metadataResponse.json() as {id:string;revision:number;approvedRevision:number|null;approvedAssetId:string|null;archived:boolean};
 if(artwork.id!==request.artworkId||artwork.archived||artwork.revision!==request.expectedRevision||artwork.approvedRevision!==request.expectedRevision||!artwork.approvedAssetId)throw Error('THUMBNAIL_REVISION');
 const response=await fetch(`${path}/preview?expectedRevision=${request.expectedRevision}`,options);
 if(response.headers.get('x-exhibitos-artwork-revision')!==String(request.expectedRevision)||response.headers.get('x-exhibitos-watermarked')!=='true')throw Error('THUMBNAIL_REVISION');
 const mime=response.headers.get('content-type')?.split(';')[0];if(mime!=='image/png'&&mime!=='model/gltf-binary')throw Error('THUMBNAIL_TYPE');
 const bytes=await bounded(response,signal);signal.throwIfAborted();
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
 if(mime==='image/png'){
  const view=new DataView(bytes.buffer);if(bytes.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)||view.getUint32(16)>4096||view.getUint32(20)>4096)throw Error('THUMBNAIL_IMAGE_LIMIT');
  const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));
  try{signal.throwIfAborted();if(!bitmap.width||!bitmap.height)throw Error('THUMBNAIL_IMAGE_LIMIT');const context=canvas.getContext('2d');if(!context)throw Error('THUMBNAIL_UNAVAILABLE');const fit=Math.min(256/bitmap.width,256/bitmap.height);context.fillStyle='#f8fbfc';context.fillRect(0,0,256,256);context.drawImage(bitmap,(256-bitmap.width*fit)/2,(256-bitmap.height*fit)/2,bitmap.width*fit,bitmap.height*fit);}finally{bitmap.close();}
 }else{
  const three=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');signal.throwIfAborted();
  const renderer=new three.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  let object:import('three').Object3D|undefined,basis:Awaited<ReturnType<typeof basisLoader>>|undefined=undefined,protectedBytes:ReturnType<typeof embeddedPNGManager>|undefined;
  try{
   renderer.setPixelRatio(1);renderer.setSize(256,256,false);renderer.outputColorSpace=three.SRGBColorSpace;
   basis=await basisLoader(renderer,bytes.buffer);signal.throwIfAborted();const manager=new three.LoadingManager();protectedBytes=embeddedPNGManager(manager,bytes.buffer,basis);
   const loader=new GLTFLoader(manager);if(protectedBytes.ktx2Loader)loader.setKTX2Loader(protectedBytes.ktx2Loader as never);
   object=(await loader.parseAsync(protectedBytes.bytes,'')).scene;protectedBytes.assertLoaded();signal.throwIfAborted();
   let triangles=0,memory=0;const seen=new Set<unknown>();object.traverse(node=>{if(!(node instanceof three.Mesh))return;
    const geometry=node.geometry;triangles+=(geometry.index?.count??geometry.getAttribute('position')?.count??0)/3;
    for(const attribute of Object.values(geometry.attributes)){if(!seen.has(attribute)){seen.add(attribute);memory+=attribute.array.byteLength;}}
    if(geometry.index&&!seen.has(geometry.index)){seen.add(geometry.index);memory+=geometry.index.array.byteLength;}
    for(const material of Array.isArray(node.material)?node.material:[node.material])for(const item of Object.values(material))if(item instanceof three.Texture&&!seen.has(item)){seen.add(item);const image=item.image as {width?:number;height?:number}|undefined;const w=image?.width??0,h=image?.height??0;if(w>1024||h>1024)throw Error('THUMBNAIL_TEXTURE_LIMIT');memory+=w*h*4*4/3;}
   });if(triangles>150000||memory>32*1024*1024)throw Error('THUMBNAIL_MODEL_LIMIT');
   const centered=centerMetricModel(three,object),scene=new three.Scene();scene.background=new three.Color('#f8fbfc');scene.add(centered.object);scene.add(new three.HemisphereLight(0xffffff,0x48503d,2));const light=new three.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
   const fit=metricCameraFit(centered.extent,1),camera=new three.PerspectiveCamera(40,1,fit.near,fit.far);camera.position.set(1,.45,1.3).normalize().multiplyScalar(fit.distance);camera.lookAt(0,0,0);renderer.render(scene,camera);
   const context=canvas.getContext('2d');if(!context)throw Error('THUMBNAIL_UNAVAILABLE');context.drawImage(renderer.domElement,0,0);
  }finally{
   object?.traverse(node=>{if(!(node instanceof three.Mesh))return;node.geometry.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material]){for(const item of Object.values(material))if(item instanceof three.Texture)item.dispose();material.dispose();}});
   protectedBytes?.dispose();basis?.dispose();renderer.dispose();renderer.forceContextLoss();
  }
 }
 const currentResponse=await fetch(`${path}/display`,options);if(!currentResponse.ok)throw Error('THUMBNAIL_UNAVAILABLE');const current=await currentResponse.json() as {id:string;revision:number};if(current.id!==request.artworkId||current.revision!==request.expectedRevision)throw Error('THUMBNAIL_REVISION');
 signal.throwIfAborted();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('THUMBNAIL_UNAVAILABLE')),'image/png'));
 if(blob.size>512*1024)throw Error('THUMBNAIL_RESULT_LIMIT');const result=new Uint8Array(await blob.arrayBuffer());let raw='';for(const byte of result)raw+=String.fromCharCode(byte);return {pngBase64:btoa(raw),width:256,height:256};
}
