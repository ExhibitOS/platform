// SPDX-License-Identifier: AGPL-3.0-or-later
import {textureCRC} from './embedded-texture-fixture.mjs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const remove=new Set(['tEXt','zTXt','iTXt','eXIf','pHYs','oFFs']);
const retain=new Set(['IHDR','PLTE','IDAT','IEND','iCCP','sRGB','cHRM','gAMA','cICP','sBIT','tRNS','bKGD']);
/** Fixed bounded catalogue thumbnails only. Preserve every pixel/compression and
 * color-management chunk byte; remove private author metadata without decoding,
 * resizing, recompressing or changing color interpretation. */
export function furnishingPreviewPng(input){
 if(!(input instanceof Uint8Array)||input.byteLength<45||input.byteLength>2097152)throw Error('PREVIEW_PNG_LIMIT');
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);if(!bytes.subarray(0,8).equals(signature))throw Error('PREVIEW_PNG_SIGNATURE');
 const chunks=[signature],removed=[];let at=8,count=0,width=0,height=0,idat=false,ended=false,afterIdat=false;
 while(at<bytes.length){
  if(++count>512||at+12>bytes.length||ended)throw Error('PREVIEW_PNG_LAYOUT');
  const size=bytes.readUInt32BE(at),end=at+size+12;if(end>bytes.length)throw Error('PREVIEW_PNG_LAYOUT');
  const kind=bytes.toString('ascii',at+4,at+8),chunk=bytes.subarray(at,end);
  if(!/^[A-Za-z]{4}$/.test(kind)||bytes.readUInt32BE(end-4)!==textureCRC(bytes.subarray(at+4,end-4)))throw Error('PREVIEW_PNG_CRC');
  if(count===1){if(kind!=='IHDR'||size!==13)throw Error('PREVIEW_PNG_LAYOUT');width=bytes.readUInt32BE(at+8);height=bytes.readUInt32BE(at+12);if(width<1||height<1||width>1024||height>1024||width*height>1048576||bytes[at+16]!==8||![2,6].includes(bytes[at+17])||bytes[at+18]!==0||bytes[at+19]!==0||bytes[at+20]!==0)throw Error('PREVIEW_PNG_HEADER');}
  else if(kind==='IHDR')throw Error('PREVIEW_PNG_LAYOUT');
  if(kind==='IDAT'){if(afterIdat)throw Error('PREVIEW_PNG_LAYOUT');idat=true;}else if(idat)afterIdat=true;
  if(kind==='IEND'){if(size!==0||!idat)throw Error('PREVIEW_PNG_LAYOUT');ended=true;}
  if(remove.has(kind))removed.push(kind);else if(retain.has(kind))chunks.push(chunk);else throw Error('PREVIEW_PNG_UNSUPPORTED_CHUNK');
  at=end;
 }
 if(!ended)throw Error('PREVIEW_PNG_LAYOUT');
 return {bytes:Buffer.concat(chunks),width,height,removed,recipe:'strip-private-png-metadata-v1'};
}
