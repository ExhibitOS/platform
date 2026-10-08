import type { LoadingManager, Texture } from 'three';
/** Each GLB image is served from a predeclared immutable embedded buffer, never a URL supplied by the model. */
export function embeddedPNGManager(manager: LoadingManager, input: ArrayBuffer) {
  const bytes = new Uint8Array(input), view = new DataView(input);
  const reject = (): never => { throw Error('EXTERNAL_RESOURCE_REJECTED'); };
  if (bytes.length < 20 || bytes.length > 33554432 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length) reject();
  const size = view.getUint32(12,true), start = 28 + size;
  if (size > 1048576 || size % 4 || 20+size > bytes.length || view.getUint32(16,true) !== 0x4e4f534a) reject();
  const doc = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+size)));
  const scan = (v: unknown, depth = 0) => {
    if (depth > 64) reject();
    if (!v || typeof v !== 'object') return;
    for (const [key,value] of Object.entries(v)) {if (key === 'uri' || key === 'extensions' || (key === 'extensionsUsed' || key === 'extensionsRequired') && Array.isArray(value) && value.length) reject();scan(value,depth+1);}
  };scan(doc);
  const owned = new Set<string>(), textures=new Set<Texture>(), bitmaps=new Set<ImageBitmap>();let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const t of textures)t.dispose();textures.clear();for(const b of bitmaps)b.close();bitmaps.clear();};
  const assertLoaded=()=>{if(disposed||textures.size!==owned.size)reject();};
  if (doc.images === undefined) {manager.setURLModifier(()=>reject());return {bytes:input,dispose,assertLoaded};}
  if (doc.images !== undefined) {
    if (!Array.isArray(doc.images) || doc.images.length > 8 || !doc.images.length || view.getUint32(24+size,true) !== 0x004e4942 || view.getUint32(20+size,true) + start !== bytes.length || doc.buffers?.length !== 1 || Object.keys(doc.buffers[0]).some(k=>k!=='byteLength') || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength<1 || doc.buffers[0].byteLength>bytes.length-start || bytes.length-start-doc.buffers[0].byteLength>3) reject();
    let pixels = 0, totalBytes = 0;
    for (const image of doc.images) {
      if (Object.keys(image).some(k=>!['bufferView','mimeType','name'].includes(k)) || image.mimeType !== 'image/png' || !Number.isSafeInteger(image.bufferView)) reject();
      const buffer = doc.bufferViews?.[image.bufferView], offset = buffer?.byteOffset ?? 0, length = buffer?.byteLength;
      if (!buffer || buffer.buffer !== 0 || buffer.byteStride !== undefined || buffer.target !== undefined || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 33 || length > 8388608 || totalBytes+length > 8388608 || offset+length > doc.buffers[0].byteLength) reject();
      const png = bytes.slice(start+offset,start+offset+length), p = new DataView(png.buffer);
      if (![137,80,78,71,13,10,26,10].every((b,i)=>png[i]===b) || p.getUint32(8)!==13 || new TextDecoder().decode(png.subarray(12,16))!=='IHDR') reject();
      const w=p.getUint32(16),h=p.getUint32(20);pixels+=w*h;totalBytes+=length;
      if (!w||!h||w>2048||h>2048||pixels>2097152||totalBytes>8388608) reject();
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
  manager.setURLModifier(url=>{if(owned.has(url))return url;return reject();});
  const json=new TextEncoder().encode(JSON.stringify(doc)), padded=Math.ceil(json.length/4)*4, bin=bytes.subarray(start);if(padded>1048576||28+padded+bin.length>33554432)reject();const result=new ArrayBuffer(28+padded+bin.length), out=new Uint8Array(result), header=new DataView(result);header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,out.length,true);header.setUint32(12,padded,true);header.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+padded);out.set(json,20);header.setUint32(20+padded,bin.length,true);header.setUint32(24+padded,0x004e4942,true);out.set(bin,28+padded);return {bytes:result,dispose,assertLoaded};
}
