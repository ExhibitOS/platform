import {embeddedBasisPairs,ordinaryPngRoleSet} from '@exhibitos/studio-contract';
import type { LoadingManager, Texture } from 'three';
/** Each GLB image is served from a predeclared immutable embedded buffer, never a URL supplied by the model. */
export function embeddedPNGManager(manager: LoadingManager, input: ArrayBuffer, compressed?: {parse(bytes:ArrayBuffer,onLoad:(texture:Texture)=>void,onError:(error:unknown)=>void):void}) {
  const bytes = new Uint8Array(input), view = new DataView(input);
  const reject = (): never => { throw Error('EXTERNAL_RESOURCE_REJECTED'); };
  if (bytes.length < 20 || bytes.length > 33554432 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length) reject();
  const size = view.getUint32(12,true), start = 28 + size;
  if (size > 1048576 || size % 4 || 20+size > bytes.length || view.getUint32(16,true) !== 0x4e4f534a) reject();
  const pairs=(doc:ReturnType<typeof JSON.parse>,read:(index:number)=>Uint8Array)=>{try{return embeddedBasisPairs(doc,read);}catch{return reject();}};
  const doc = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+size)));
  const compressedImages=new Map<string,Uint8Array>();
  const owned = new Set<string>(), textures=new Set<Texture>(), bitmaps=new Set<ImageBitmap>();let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const t of textures)t.dispose();textures.clear();for(const b of bitmaps)b.close();bitmaps.clear();};
  let expectedTextures=0;const assertLoaded=()=>{if(disposed||textures.size!==expectedTextures)reject();};
  if (doc.images === undefined) {pairs(doc,()=>reject());manager.setURLModifier(()=>reject());return {bytes:input,dispose,assertLoaded,ktx2Loader:undefined};}
  if (doc.images !== undefined) {
    if (!Array.isArray(doc.images) || doc.images.length > 16 || !doc.images.length || view.getUint32(24+size,true) !== 0x004e4942 || view.getUint32(20+size,true) + start !== bytes.length || doc.buffers?.length !== 1 || Object.keys(doc.buffers[0]).some(k=>k!=='byteLength') || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength<1 || doc.buffers[0].byteLength>bytes.length-start || bytes.length-start-doc.buffers[0].byteLength>3) reject();
    const basis=pairs(doc,(i)=>{const im=doc.images[i],bv=doc.bufferViews?.[im?.bufferView],o=bv?.byteOffset??0,n=bv?.byteLength;if(!bv||bv.buffer!==0||!Number.isSafeInteger(o)||o<0||!Number.isSafeInteger(n)||n<1||o+n>doc.buffers[0].byteLength)reject();return bytes.subarray(start+o,start+o+n);});
    expectedTextures=doc.textures===undefined?doc.images.length:new Set(doc.textures.map((t: {source:number;extensions?:{KHR_texture_basisu?:{source:number}}})=>compressed&&t.extensions?.KHR_texture_basisu?t.extensions.KHR_texture_basisu.source:t.source)).size;
    const ordinary=ordinaryPngRoleSet(doc),pixelLimit=(ordinary?12:2)*1024*1024,byteLimit=(ordinary?24:8)*1024*1024;
    let pixels = 0, totalBytes = 0;
    for (const image of doc.images) {
      if (Object.keys(image).some(k=>!['bufferView','mimeType','name'].includes(k)) || !['image/png','image/ktx2'].includes(image.mimeType) || !Number.isSafeInteger(image.bufferView)) reject();
      const buffer = doc.bufferViews?.[image.bufferView], offset = buffer?.byteOffset ?? 0, length = buffer?.byteLength;
      if (!buffer || buffer.buffer !== 0 || buffer.byteStride !== undefined || buffer.target !== undefined || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 33 || length > 8388608 || totalBytes+length > byteLimit || offset+length > doc.buffers[0].byteLength) reject();
      const png = bytes.slice(start+offset,start+offset+length), p = new DataView(png.buffer);
      if(image.mimeType==='image/ktx2'){if(!basis.has(doc.images.indexOf(image)))reject();totalBytes+=length;if(totalBytes>8388608)reject();const key='exhibitos-embedded-ktx2-'+doc.images.indexOf(image);owned.add(key);image.uri=key;delete image.bufferView;compressedImages.set(key,png);continue;}
      if (![137,80,78,71,13,10,26,10].every((b,i)=>png[i]===b) || p.getUint32(8)!==13 || new TextDecoder().decode(png.subarray(12,16))!=='IHDR') reject();
      const w=p.getUint32(16),h=p.getUint32(20);pixels+=w*h;totalBytes+=length;
      if (!w||!h||w>2048||h>2048||pixels>pixelLimit||totalBytes>byteLimit||ordinary&&(png[24]!==8||png[25]!==2)) reject();
      // Loader handler matches an opaque model-local key; no general blob/data/http resource is allowed.
      const key = 'exhibitos-embedded-png-'+owned.size;
      owned.add(key);
      image.uri = key; delete image.bufferView;
      const loader = {
        load(_url: string,onLoad: (texture: unknown)=>void,_progress: unknown,onError: (error: unknown)=>void) {
          import('three').then(async three=>{
            const bitmap=await createImageBitmap(new Blob([png],{type:'image/png'}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
            if(disposed){bitmap.close();throw Error('EMBEDDED_IMAGE_DISPOSED');}
            bitmaps.add(bitmap);const texture=new three.Texture(bitmap);texture.needsUpdate=true;textures.add(texture);onLoad(texture);
          }).catch(onError);
        }
      };
      manager.addHandler(new RegExp('^'+key+'$'),loader as never);
    }
  }
  const ktx2Loader=compressed?{load(url:string,onLoad:(texture:Texture)=>void,_progress:unknown,onError:(error:unknown)=>void){const data=compressedImages.get(url);if(!data||disposed){onError(Error('EXTERNAL_RESOURCE_REJECTED'));return;}compressed.parse(data.slice().buffer,texture=>{if(disposed){texture.dispose();onError(Error('EMBEDDED_IMAGE_DISPOSED'));return;}textures.add(texture);onLoad(texture);},onError);}}:undefined;
  manager.setURLModifier(url=>{if(owned.has(url))return url;return reject();});
  const json=new TextEncoder().encode(JSON.stringify(doc)), padded=Math.ceil(json.length/4)*4, bin=bytes.subarray(start);if(padded>1048576||28+padded+bin.length>33554432)reject();const result=new ArrayBuffer(28+padded+bin.length), out=new Uint8Array(result), header=new DataView(result);header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,out.length,true);header.setUint32(12,padded,true);header.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+padded);out.set(json,20);header.setUint32(20+padded,bin.length,true);header.setUint32(24+padded,0x004e4942,true);out.set(bin,28+padded);return {bytes:result,dispose,assertLoaded,ktx2Loader};
}
