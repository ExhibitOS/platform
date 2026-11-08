// SPDX-License-Identifier: AGPL-3.0-or-later
/** Values supplied from a separately verified detail-only source authority.
 * This descriptor is not an authority, a grant, or a memory qualification. */
export interface HayesDetailJpegDescriptor {
 sourceSha256:string;imageIndex:number;bufferView:number;byteOffset:number;encodedBytes:number;imageSha256:string;width:number;height:number;channels:number;
}
const SOURCE_SHA256='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6';
const IMAGES=[
 {view:4,offset:4558464,bytes:1803167,sha256:'b664100de1942a37e8e033b1fb4d21a60f9e07226e18e96e3b5910f591f5980f',channels:3},
 {view:5,offset:6361631,bytes:640186,sha256:'9d9e148bd723bf686000bc6ce96e4235e4c6b26996404d2ca47d8726ca3bef16',channels:1},
 {view:6,offset:7001817,bytes:1379723,sha256:'ec036b576c4018fd139de22b833e474e8c3538fb4bab5833c83ed3a35e3ebee8',channels:3},
] as const;
const hash=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');

/** Detail-only helper for the exact retained Hayes bytes; not an admission API.
 * Caller must already verify whole-file authority/inspector and reserve capacity
 * for all concurrent decodes; at most one such scope may belong to an attempt.
 * Abort stops new work and closes late results, but retains returned bitmaps
 * until explicit dispose after the caller has retired textures and fenced GPU work.
 * This scope owns all returned bitmaps, including late ones. Consumers own their
 * textures; they must dispose them and complete GPU commands independently.
 * drain awaits actual settlement and rejects if a bitmap could not be closed. */
export function createHayesDetailJpegDecoder(signal:AbortSignal){
 signal.throwIfAborted();let disposed=false,cleanupFailed=false;
 const bitmaps=new Set<ImageBitmap>(),pending=new Set<Promise<void>>(),started=new Set<number>();
 const close=(bitmap:ImageBitmap)=>{try{bitmap.close();}catch{cleanupFailed=true;}};
 const dispose=()=>{if(disposed)return;disposed=true;for(const bitmap of bitmaps)close(bitmap);bitmaps.clear();};
 return {
  decode(descriptor:HayesDetailJpegDescriptor,input:Uint8Array):Promise<ImageBitmap>{
   const {sourceSha256,imageIndex,bufferView,byteOffset,encodedBytes,imageSha256,width,height,channels}=descriptor;
   if(!Number.isInteger(imageIndex)||imageIndex<0||imageIndex>=IMAGES.length)return Promise.reject(Error('DETAIL_HAYES_DECODE_UNAVAILABLE'));
   const expected=IMAGES[imageIndex];
   if(disposed||signal.aborted||!expected||started.has(imageIndex)||sourceSha256!==SOURCE_SHA256||bufferView!==expected.view||byteOffset!==expected.offset||encodedBytes!==expected.bytes||imageSha256!==expected.sha256||width!==4096||height!==4096||channels!==expected.channels||input.byteLength!==expected.bytes)return Promise.reject(Error('DETAIL_HAYES_DECODE_UNAVAILABLE'));
   started.add(imageIndex);const bytes=new Uint8Array(input);
   const task=(async()=>{
    if(await hash(bytes)!==expected.sha256||bytes[0]!==0xff||bytes[1]!==0xd8||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)throw Error('DETAIL_HAYES_IMAGE');
    if(disposed||signal.aborted)throw Error('DETAIL_HAYES_DECODE_UNAVAILABLE');
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    let adopted=false;try{if(disposed||signal.aborted||bitmap.width!==4096||bitmap.height!==4096)throw Error('DETAIL_HAYES_DECODE_UNAVAILABLE');bitmaps.add(bitmap);adopted=true;return bitmap;}finally{if(!adopted)close(bitmap);}
   })();
   const settled=task.then(()=>{},()=>{});pending.add(settled);void settled.then(()=>{pending.delete(settled);});return task;
  },
  dispose,
  async drain(){if(!disposed)throw Error('DETAIL_HAYES_NOT_DISPOSED');while(pending.size)await Promise.all([...pending]);if(cleanupFailed)throw Error('DETAIL_HAYES_CLEANUP_UNCERTAIN');},
 };
}
