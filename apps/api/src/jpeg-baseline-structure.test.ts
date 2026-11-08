// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {inspectBaselineJpegStructure} from './jpeg-baseline-structure.ts';
const segment=(marker:number,payload:number[])=>Buffer.from([255,marker,(payload.length+2)>>8,(payload.length+2)&255,...payload]);
function fixture(){const quant=segment(0xdb,[0,...Array(64).fill(1)]),table=(id:number)=>segment(0xc4,[id,1,...Array(15).fill(0),0]),sof=segment(0xc0,[8,0,2,0,3,3,1,0x11,0,2,0x11,0,3,0x11,0]),sos=segment(0xda,[3,1,0,2,0,3,0,0,63,0]);return Buffer.concat([Buffer.from([255,216]),quant,sof,table(0),table(0x10),sos,Buffer.from([0x3f,255,0,0x18,255,217])]);}
describe('conservative baseline JPEG structural envelope',()=>{
 it('parses a bounded three-component single-scan envelope without claiming entropy validity',()=>{expect(inspectBaselineJpegStructure(fixture())).toEqual({codec:'jpeg',width:3,height:2,bitDepth:8,channels:3,frameCount:1,interlaced:false,iccBytes:0,iccSha256:undefined});});
 it('rejects truncated entropy, missing EOI, trailing bytes and alternate scan markers',()=>{const bytes=fixture();for(const broken of [bytes.subarray(0,Math.floor(bytes.length/2)),bytes.subarray(0,bytes.length-2),Buffer.concat([bytes,Buffer.from([0])]),Buffer.concat([bytes.subarray(0,bytes.length-2),Buffer.from([255,208,255,217])])])expect(()=>inspectBaselineJpegStructure(broken)).toThrow('JPEG_STRUCTURE_UNSUPPORTED');});
 it('rejects progressive frame, missing required tables and duplicate quantization table',()=>{const bytes=fixture(),progressive=Buffer.from(bytes);progressive[progressive.indexOf(Buffer.from([255,192]))+1]=194;const noTable=Buffer.concat([bytes.subarray(0,2),bytes.subarray(2+69)]),duplicate=Buffer.concat([bytes.subarray(0,71),bytes.subarray(2)]);for(const broken of [progressive,noTable,duplicate])expect(()=>inspectBaselineJpegStructure(broken)).toThrow('JPEG_STRUCTURE_UNSUPPORTED');});
 it('rejects empty entropy, all-ones code, invalid symbols and oversized MCU',()=>{
  const bytes=fixture(),sos=bytes.indexOf(Buffer.from([255,218])),sof=bytes.indexOf(Buffer.from([255,192])),dc=bytes.indexOf(Buffer.from([255,196])),ac=bytes.indexOf(Buffer.from([255,196]),dc+2);
  const empty=Buffer.concat([bytes.subarray(0,sos+14),Buffer.from([255,217])]),full=Buffer.concat([bytes.subarray(0,dc),segment(0xc4,[0,2,...Array(15).fill(0),0,1]),bytes.subarray(dc+22)]),badDc=Buffer.from(bytes),badAc=Buffer.from(bytes),badMcu=Buffer.from(bytes),badSelector=Buffer.from(bytes);
  badDc[dc+21]=255;badAc[ac+21]=0x10;badMcu[sof+11]=0x44;badSelector[sos+6]=0x20;
  for(const broken of [empty,full,badDc,badAc,badMcu,badSelector])expect(()=>inspectBaselineJpegStructure(broken)).toThrow('JPEG_STRUCTURE_UNSUPPORTED');
 });
 it('bounds and orders ICC segments and compares signature as exact bytes',()=>{
  const bytes=fixture(),profile=Buffer.alloc(128);profile.writeUInt32BE(profile.length);profile.write('acsp',36);const prefix=[...Buffer.from('ICC_PROFILE\0','binary')],chunk=(seq:number,count:number,content:Buffer)=>segment(0xe2,[...prefix,seq,count,...content]),withChunks=(chunks:Buffer[])=>Buffer.concat([bytes.subarray(0,2),...chunks,bytes.subarray(2)]),first=chunk(1,2,profile.subarray(0,64)),second=chunk(2,2,profile.subarray(64));
  expect(inspectBaselineJpegStructure(withChunks([second,first])).iccSha256).toBe(createHash('sha256').update(profile).digest('hex'));
  const bad=Buffer.from(profile);for(let i=36;i<40;i++)bad[i]!|=0x80;const huge=Buffer.alloc(60000,1);
  for(const chunks of [[first],[first,first],[chunk(1,1,bad)],[chunk(1,3,huge),chunk(2,3,huge),chunk(3,3,huge)]])expect(()=>inspectBaselineJpegStructure(withChunks(chunks))).toThrow('JPEG_STRUCTURE_UNSUPPORTED');
 });
});
