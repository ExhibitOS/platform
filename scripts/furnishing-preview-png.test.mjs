// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicTexturePNG,texturePNGChunk,textureCRC} from './embedded-texture-fixture.mjs';
import {furnishingPreviewPng} from './furnishing-preview-png.mjs';
test('private metadata is removed while IDAT and color chunks remain byte-identical',()=>{
 const clean=publicTexturePNG(),color=texturePNGChunk('gAMA',Buffer.from([0,0,177,143]));
 const original=Buffer.concat([clean.subarray(0,33),color,texturePNGChunk('tEXt',Buffer.from('File\0C:\\Users\\Example\\private.blend')),texturePNGChunk('eXIf',Buffer.from('example author metadata')),clean.subarray(33)]);
 const result=furnishingPreviewPng(original);assert.deepEqual(result.removed,['tEXt','eXIf']);assert.equal(result.width,2);assert.equal(result.height,2);
 assert.equal(result.bytes.equals(Buffer.concat([clean.subarray(0,33),color,clean.subarray(33)])),true);assert.equal(result.bytes.includes(Buffer.from('private.blend')),false);
 assert.equal(furnishingPreviewPng(result.bytes).bytes.equals(result.bytes),true);
});
test('CRC corruption, unknown animation/chunks, trailing data and oversized headers fail closed',()=>{
 const clean=publicTexturePNG(),bad=Buffer.from(clean);bad[45]^=1;assert.throws(()=>furnishingPreviewPng(bad),/CRC/);
 assert.throws(()=>furnishingPreviewPng(Buffer.concat([clean,Buffer.from([0])])),/LAYOUT/);
 for(const name of ['acTL','ABCD','aaAA'])assert.throws(()=>furnishingPreviewPng(Buffer.concat([clean.subarray(0,33),texturePNGChunk(name,Buffer.alloc(0)),clean.subarray(33)])),/UNSUPPORTED/);
 const header=Buffer.from(clean.subarray(16,29));header.writeUInt32BE(2048);assert.throws(()=>furnishingPreviewPng(Buffer.concat([clean.subarray(0,8),texturePNGChunk('IHDR',header),clean.subarray(33)])),/HEADER/);
});

test('CRC-correct high-bit chunk names cannot masquerade as ASCII IDAT or IEND',()=>{
 const clean=publicTexturePNG();for(const name of ['IDAT','IEND']){const bytes=Buffer.from(clean);let at=8;while(bytes.toString('latin1',at+4,at+8)!==name)at+=bytes.readUInt32BE(at)+12;const end=at+bytes.readUInt32BE(at)+12;bytes[at+4]|=128;bytes.writeUInt32BE(textureCRC(bytes.subarray(at+4,end-4)),end-4);assert.throws(()=>furnishingPreviewPng(bytes),/CRC/);}
});
