// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {describe,it,expect} from 'vitest';
import {pngCrc} from './png-pixels.ts';
import {decode} from './imports.ts';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(name:string,body:Buffer){const type=Buffer.from(name),out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);type.copy(out,4);body.copy(out,8);out.writeUInt32BE(pngCrc(Buffer.concat([type,body])),body.length+8);return out;}
function png(width:number,height:number,colour=2){const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=colour;const pixels=deflateSync(Buffer.alloc((width*3+1)*height));return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',pixels),chunk('IEND',Buffer.alloc(0))]);}
describe('direct original PNG pixel-limit diagnosis',()=>{
 it('accepts the exact pixel limit and identifies a CRC-checked 2050-square original',async()=>{
  await expect(decode(png(2048,2048),'image/png',{classifyPngPixelLimit:true})).resolves.toBeUndefined();
  const oversized=png(2050,2050);await expect(decode(oversized,'image/png',{classifyPngPixelLimit:true})).rejects.toMatchObject({code:'PNG_PIXEL_LIMIT_EXCEEDED'});
  await expect(decode(oversized,'image/png')).rejects.toMatchObject({code:'FORMAT_REJECTED'});
 });
 it('keeps corrupt, unsupported, dimension-only and non-PNG inputs generic',async()=>{
  const original=png(2050,2050),badCrc=Buffer.from(original);badCrc[29]=badCrc[29]!^1;
  const badIdat=Buffer.from(original);badIdat[badIdat.length-16]=badIdat[badIdat.length-16]!^1;
  for(const bytes of [badCrc,badIdat,original.subarray(0,33),original.subarray(0,original.length-12),png(2050,2050,3),png(8193,1)])await expect(decode(bytes,'image/png',{classifyPngPixelLimit:true})).rejects.toMatchObject({code:'FORMAT_REJECTED'});
  await expect(decode(png(2050,2050),'model/gltf-binary',{classifyPngPixelLimit:true})).rejects.toMatchObject({code:'FORMAT_REJECTED'});
 });
});
