import {embeddedBasisPairs,embeddedMippedBasisPairs,ordinaryPngRoleSet,type DetailTextureFeatures} from '@exhibitos/studio-contract';
import type { LoadingManager, Texture } from 'three';
import {embeddedJpegSize,acquiredModelTextureEdge} from './viewer/detail-model-admission';
/** Kept separate so legacy scopes do not newly capture the manager/handlers. */
function parsedPngBacking(manager:LoadingManager,handlers:RegExp[],owned:Set<string>,assertLoaded:()=>void,bytes:ArrayBuffer){
  let backing:ArrayBuffer|undefined=bytes;
  const reject=():never=>{throw Error('EXTERNAL_RESOURCE_REJECTED');};
  return {get bytes():ArrayBuffer{return backing??reject();},retireBacking(){backing=undefined;},releaseEncoded(){
    // Geometry keeps its own backing. Do not detach it or close scene images.
    assertLoaded();backing=undefined;
    for(const pattern of handlers)manager.removeHandler(pattern);handlers.length=0;
    owned.clear();manager.setURLModifier(()=>reject());return true;
  }};
}
/** Optional DEBUG host observation only; never part of decode authority or drain. */
function observeGPUCall(png:Uint8Array,blob:Blob,imageIndex:number,callId:number,isDisposed:()=>boolean){
  try{
    if(callId>31||imageIndex>31)return;
    const host=(globalThis as typeof globalThis & {webkit?:{messageHandlers?:{exhibitosGPUDecodeObservation?:{postMessage(value:unknown):void}}}}).webkit?.messageHandlers?.exhibitosGPUDecodeObservation;
    if(typeof host?.postMessage!=='function')return;
    const visibility=document.visibilityState;
    if(!['hidden','visible','prerender'].includes(visibility))return;
    const base={version:1,callId,imageIndex};
    const send=(value:Record<string,unknown>)=>{try{host.postMessage({...base,...value});}catch{/* Dropped observations are unknown. */}};
    send({phase:'call',bytes:png.byteLength,byteOffset:png.byteOffset,bufferBytes:png.buffer.byteLength,blobBytes:blob.size,blobType:'image/png',disposed:isDisposed(),visibility,hasFocus:document.hasFocus(),secureContext:globalThis.isSecureContext,nativeViewportPath:location.pathname==='/native-viewport.html'});
    let hashing=false;
    return {
      settled(outcome:'success'|'decoder-error',error?:unknown){
        try{
          if(outcome==='success')send({phase:'settled',outcome,disposed:isDisposed()});
          else{
            const name=error instanceof Error?error.name:'';
            const errorName=['Error','TypeError','RangeError','EncodingError','InvalidStateError','NotSupportedError','SecurityError','AbortError'].includes(name)?name:'UnknownError';
            send({phase:'settled',outcome:'decoder-error',errorName,disposed:isDisposed()});
          }
        }catch{/* Observation must not replace the original decoder result. */}
      },
      hash(){
        if(hashing)return;hashing=true;
        // Called only after the decoder invocation, even if it threw synchronously.
        // This independent task retains the actual Blob argument, never delays drain.
        void Promise.resolve().then(()=>blob.arrayBuffer()).then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(digest=>{
          const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
          if(!/^[a-f0-9]{64}$/.test(sha256))throw Error('OBSERVATION_HASH');
          send({phase:'hash',outcome:'success',sha256});
        }).catch(()=>send({phase:'hash',outcome:'observation-failed'}));
      }
    };
  }catch{return;}
}
/** Each GLB image is served from a predeclared immutable embedded buffer, never a URL supplied by the model. */
export function embeddedPNGManager(manager: LoadingManager, input: ArrayBuffer, compressed?: {parse(bytes:ArrayBuffer,onLoad:(texture:Texture)=>void,onError:(error:unknown)=>void):void}, acquiredTextures?:readonly Readonly<DetailTextureFeatures>[], mode:'legacy-single'|'gpu-model-v1'='legacy-single') {
  const bytes = new Uint8Array(input), view = new DataView(input);
  const reject = (): never => { throw Error('EXTERNAL_RESOURCE_REJECTED'); };
  if (bytes.length < 20 || bytes.length > 33554432 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length) reject();
  const size = view.getUint32(12,true), start = 28 + size;
  if (size > 1048576 || size % 4 || 20+size > bytes.length || view.getUint32(16,true) !== 0x4e4f534a) reject();
  const gpuModel=mode==='gpu-model-v1';
  if(gpuModel&&(!compressed||acquiredTextures))reject();
  const pairs=(doc:ReturnType<typeof JSON.parse>,read:(index:number)=>Uint8Array)=>{try{return (gpuModel?embeddedMippedBasisPairs:embeddedBasisPairs)(doc,read);}catch{return reject();}};
  const doc = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+size)));
  const compressedImages=new Map<string,Uint8Array>();
  const owned = new Set<string>(), textures=new Set<Texture>(),ownedTextures=new WeakSet<Texture>(), bitmaps=new Set<ImageBitmap>(),handlers:RegExp[]=[],pending=new Set<Promise<void>>();let disposed=false,phasedPng=false,cleanupFailed=false,observationCallId=0;
  const attempt=(fn:()=>void)=>{try{fn();}catch{cleanupFailed=true;}};
  const dispose=()=>{if(disposed)return;disposed=true;for(const t of textures)attempt(()=>t.dispose());textures.clear();for(const b of bitmaps)attempt(()=>b.close());bitmaps.clear();};
  const track=()=>{let done!:()=>void;const task=new Promise<void>(resolve=>{done=resolve;});pending.add(task);return ()=>{pending.delete(task);done();};};
  const drain=async()=>{while(pending.size)await Promise.all([...pending]);};
  const retire=()=>{for(const pattern of handlers)manager.removeHandler(pattern);handlers.length=0;owned.clear();compressedImages.clear();manager.setURLModifier(()=>reject());};
  const cleanupOK=()=>!cleanupFailed;
  // GLTFLoader converts image-load rejection to a null texture. Retain only a
  // closed diagnostic code for the first child failure, never its message/URL.
  let firstLoadFailure:string|undefined;
  const childFailure=(kind:'PNG'|'KTX2',index:number,error:unknown)=>{
    if(!gpuModel||disposed||firstLoadFailure)return;
    const name=error instanceof Error?error.name:'';
    const code=({Error:'ERROR',TypeError:'TYPE_ERROR',RangeError:'RANGE_ERROR',EncodingError:'ENCODING_ERROR',InvalidStateError:'INVALID_STATE_ERROR',NotSupportedError:'NOT_SUPPORTED_ERROR',SecurityError:'SECURITY_ERROR',AbortError:'ABORT_ERROR'} as Record<string,string>);
    firstLoadFailure=`GPU_MODEL_EMBEDDED_${kind}_${index}_${Object.hasOwn(code,name)?code[name]:'UNKNOWN_ERROR'}`;
  };
  let expectedTextures=0;const assertLoaded=()=>{if(disposed)reject();if(textures.size!==expectedTextures){if(firstLoadFailure)throw Error(firstLoadFailure);reject();}},ownsTexture=(texture:Texture)=>ownedTextures.has(texture);
  const legacyBacking=(value:ArrayBuffer)=>{let backing:ArrayBuffer|undefined=value;return {get bytes(){return backing??reject();},retire(){backing=undefined;retire();}};};
  if (doc.images === undefined) {if(gpuModel)reject();pairs(doc,()=>reject());manager.setURLModifier(()=>reject());return Object.assign(legacyBacking(input),{dispose,assertLoaded,ownsTexture,drain,cleanupOK,releaseEncoded:()=>false,ktx2Loader:undefined});}
  if (doc.images !== undefined) {
    if (!Array.isArray(doc.images) || doc.images.length > 16 || !doc.images.length || view.getUint32(24+size,true) !== 0x004e4942 || view.getUint32(20+size,true) + start !== bytes.length || doc.buffers?.length !== 1 || Object.keys(doc.buffers[0]).some(k=>k!=='byteLength') || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength<1 || doc.buffers[0].byteLength>bytes.length-start || bytes.length-start-doc.buffers[0].byteLength>3) reject();
    const basis=pairs(doc,(i)=>{const im=doc.images[i],bv=doc.bufferViews?.[im?.bufferView],o=bv?.byteOffset??0,n=bv?.byteLength;if(!bv||bv.buffer!==0||!Number.isSafeInteger(o)||o<0||!Number.isSafeInteger(n)||n<1||o+n>doc.buffers[0].byteLength)reject();return bytes.subarray(start+o,start+o+n);});
    if(gpuModel){
      // The new recipe permits one compressed colour map only. Reuse the
      // ordinary three-role boundary on its PNG fallbacks, without widening
      // legacy Basis admission or allowing compressed normal/AO maps.
      if(basis.size!==1||doc.images.length!==4||doc.textures?.length!==3)reject();
      const colour=doc.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index;
      const encoded=doc.textures[colour]?.extensions?.KHR_texture_basisu?.source;
      if(!basis.has(encoded)||doc.animations!==undefined||doc.skins!==undefined||
        doc.samplers!==undefined&&(!Array.isArray(doc.samplers)||doc.samplers.some((sampler:object)=>!sampler||Object.keys(sampler).length)))reject();
      const pngIndices=doc.images.map((image:{mimeType:string},index:number)=>image.mimeType==='image/png'?index:-1).filter((index:number)=>index>=0);
      const fallback=structuredClone(doc);fallback.images=pngIndices.map((index:number)=>fallback.images[index]);
      for(const texture of fallback.textures){texture.source=pngIndices.indexOf(texture.source);delete texture.extensions;}
      if(!ordinaryPngRoleSet(fallback))reject();
    }
    expectedTextures=doc.textures===undefined?doc.images.length:new Set(doc.textures.map((t: {source:number;extensions?:{KHR_texture_basisu?:{source:number}}})=>compressed&&t.extensions?.KHR_texture_basisu?t.extensions.KHR_texture_basisu.source:t.source)).size;
    const ordinary=ordinaryPngRoleSet(doc)&&doc.images.every((image:{bufferView:number})=>{const buffer=doc.bufferViews?.[image.bufferView],offset=buffer?.byteOffset??0,length=buffer?.byteLength;if(!buffer||buffer.buffer!==0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<33||offset+length>doc.buffers[0].byteLength)return false;const png=bytes.subarray(start+offset,start+offset+length),header=new DataView(png.buffer,png.byteOffset,png.byteLength);return [137,80,78,71,13,10,26,10].every((b,i)=>png[i]===b)&&header.getUint32(8)===13&&new TextDecoder().decode(png.subarray(12,16))==='IHDR'&&png[24]===8&&png[25]===2;}),pixelLimit=(ordinary?12:2)*1024*1024,byteLimit=(ordinary?24:8)*1024*1024;
    phasedPng=ordinary&&doc.extensionsUsed===undefined&&doc.extensionsRequired===undefined&&doc.animations===undefined&&doc.skins===undefined&&doc.meshes.every((mesh:{primitives:Record<string,unknown>[]})=>mesh.primitives.every(primitive=>primitive.targets===undefined));
    if(acquiredTextures&&(compressed||doc.images.length!==acquiredTextures.length||!Array.isArray(doc.textures)||
      doc.textures.length!==acquiredTextures.length||new Set(doc.textures.map((t:{source:number})=>t.source)).size!==doc.images.length))reject();
    let pixels = 0, totalBytes = 0;
    for (const image of doc.images) {
      const original=acquiredTextures?.find(item=>item.imageIndex===doc.images.indexOf(image));
      const jpeg=image.mimeType==='image/jpeg'&&original?.codec==='jpeg';
      if (Object.keys(image).some(k=>!['bufferView','mimeType','name'].includes(k)) || !jpeg&&!['image/png','image/ktx2'].includes(image.mimeType) || !Number.isSafeInteger(image.bufferView)) reject();
      const buffer = doc.bufferViews?.[image.bufferView], offset = buffer?.byteOffset ?? 0, length = buffer?.byteLength;
      if (!buffer || buffer.buffer !== 0 || buffer.byteStride !== undefined || buffer.target !== undefined || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 33 || length > 8388608 || totalBytes+length > (acquiredTextures?16*1024*1024:byteLimit) || offset+length > doc.buffers[0].byteLength) reject();
      const png = bytes.slice(start+offset,start+offset+length), p = new DataView(png.buffer);
      if(image.mimeType==='image/ktx2'){if(!basis.has(doc.images.indexOf(image)))reject();totalBytes+=length;if(totalBytes>8388608)reject();const key='exhibitos-embedded-ktx2-'+doc.images.indexOf(image);owned.add(key);image.uri=key;delete image.bufferView;compressedImages.set(key,png);continue;}
      const dimensions=jpeg?embeddedJpegSize(png):undefined;
      if(jpeg&&!dimensions||!jpeg&&(![137,80,78,71,13,10,26,10].every((b,i)=>png[i]===b)||p.getUint32(8)!==13||
        new TextDecoder().decode(png.subarray(12,16))!=='IHDR'))reject();
      const w=dimensions?.width??p.getUint32(16),h=dimensions?.height??p.getUint32(20);
      pixels+=w*h;totalBytes+=length;
      if(acquiredTextures){
        if(!original||original.codec!==(jpeg?'jpeg':'png')||original.encodedBytes!==length||w!==original.width||h!==original.height||
         w>acquiredModelTextureEdge||h>acquiredModelTextureEdge||pixels>3*acquiredModelTextureEdge**2)reject();
      }else if(!w||!h||w>2048||h>2048||pixels>pixelLimit||totalBytes>byteLimit||(ordinary||gpuModel)&&(png[24]!==8||png[25]!==2)||gpuModel&&(w!==512||h!==512))reject();
      // Loader handler matches an opaque model-local key; no general blob/data/http resource is allowed.
      const key = 'exhibitos-embedded-png-'+owned.size;
      owned.add(key);
      image.uri = key; delete image.bufferView;
      const loader = {
        load(_url: string,onLoad: (texture: unknown)=>void,_progress: unknown,onError: (error: unknown)=>void) {
          if(disposed){onError(Error('EMBEDDED_IMAGE_DISPOSED'));return;}const finish=track();
          import('three').then(async three=>{
            const blob=new Blob([png],{type:jpeg?'image/jpeg':'image/png'});
            const observation=gpuModel?observeGPUCall(png,blob,doc.images.indexOf(image),observationCallId++,()=>disposed):undefined;
            let bitmap:ImageBitmap;
            try{
              const decoding=createImageBitmap(blob,{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
              observation?.hash();bitmap=await decoding;
            }catch(error){observation?.hash();observation?.settled('decoder-error',error);throw error;}
            observation?.settled('success');
            if(disposed||original&&(bitmap.width!==w||bitmap.height!==h)){attempt(()=>bitmap.close());throw Error('EMBEDDED_IMAGE_DISPOSED');}
            bitmaps.add(bitmap);const texture=new three.Texture(bitmap);texture.needsUpdate=true;textures.add(texture);ownedTextures.add(texture);onLoad(texture);
          }).catch(error=>{childFailure('PNG',doc.images.indexOf(image),error);onError(error);}).finally(finish);
        }
      };
      const pattern=new RegExp('^'+key+'$');handlers.push(pattern);manager.addHandler(pattern,loader as never);
    }
  }
  const ktx2Loader=compressed?{load(url:string,onLoad:(texture:Texture)=>void,_progress:unknown,onError:(error:unknown)=>void){const data=compressedImages.get(url);if(!data||disposed){onError(Error('EXTERNAL_RESOURCE_REJECTED'));return;}const finish=track();let ended=false;const end=()=>{if(!ended){ended=true;finish();}};try{compressed.parse(data.slice().buffer,texture=>{try{if(disposed){attempt(()=>texture.dispose());onError(Error('EMBEDDED_IMAGE_DISPOSED'));return;}textures.add(texture);ownedTextures.add(texture);onLoad(texture);}finally{end();}},error=>{try{childFailure('KTX2',Number(url.slice('exhibitos-embedded-ktx2-'.length)),error);onError(error);}finally{end();}});}catch(error){try{childFailure('KTX2',Number(url.slice('exhibitos-embedded-ktx2-'.length)),error);onError(error);}finally{end();}}}}:undefined;
  manager.setURLModifier(url=>{if(owned.has(url))return url;if(gpuModel&&!disposed)throw Error('GPU_MODEL_EMBEDDED_URI_REJECTED');return reject();});
  const json=new TextEncoder().encode(JSON.stringify(doc)), padded=Math.ceil(json.length/4)*4, bin=bytes.subarray(start);if(padded>1048576||28+padded+bin.length>33554432)reject();const result=new ArrayBuffer(28+padded+bin.length), out=new Uint8Array(result), header=new DataView(result);header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,out.length,true);header.setUint32(12,padded,true);header.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+padded);out.set(json,20);header.setUint32(20+padded,bin.length,true);header.setUint32(24+padded,0x004e4942,true);out.set(bin,28+padded);
  if(!phasedPng)return Object.assign(legacyBacking(result),{dispose,assertLoaded,ownsTexture,drain,cleanupOK,releaseEncoded:()=>false,ktx2Loader});
  const backing=parsedPngBacking(manager,handlers,owned,assertLoaded,result);
  return Object.assign(backing,{dispose,assertLoaded,ownsTexture,drain,retire(){backing.retireBacking();retire();},cleanupOK,ktx2Loader});
}
