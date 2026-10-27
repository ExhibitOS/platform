// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {preparedImageInput,preparedImageHeader} from './prepared-image.ts';
const hex='1'.repeat(64);
const receipt=()=>({mime:'image/png',bytes:123,sha256:hex,recipe:{version:1,role:'baseColor',sampling:'nearest-centre',colourMeaning:'srgb-assumed',recipeSha256:createHash('sha256').update('{"colourMeaning":"srgb-assumed","role":"baseColor","sampling":"nearest-centre","version":1}').digest('hex'),settingsSha256:hex,sourcePixelsSha256:'2'.repeat(64),outputPixelsSha256:'3'.repeat(64),toolVersion:'ExhibitOSManager.ImageIO/1/macOS-27.0.1'}});
test('binds the agreed canonical recipe without promoting client provenance to authority',()=>{
 const input=receipt();expect(preparedImageInput(input)).toBe(input);expect(preparedImageInput(undefined)).toBeUndefined();
 expect(()=>preparedImageInput({...input,verified:true})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,recipe:{...input.recipe,approved:true}})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,recipe:{...input.recipe,colourMeaning:'srgb'}})).toThrow('INVALID_DERIVED_INPUT');
});
test('rejects non-image roles, malformed digests and unbounded producer labels',()=>{
 const input=receipt();
 for(const recipe of [{...input.recipe,role:'normal'},{...input.recipe,sourcePixelsSha256:'x'.repeat(64)},{...input.recipe,toolVersion:'x'.repeat(129)},{...input.recipe,toolVersion:'producer\nother'}])expect(()=>preparedImageInput({...input,recipe})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,bytes:8388609})).toThrow('INVALID_DERIVED_INPUT');
});
test('keeps the RGB8 preparation resource boundary independent from legacy PNG admission',()=>{
 const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(2048,16);bytes.writeUInt32BE(2048,20);bytes[24]=8;bytes[25]=2;
 expect(()=>preparedImageHeader(bytes)).not.toThrow();
 const alpha=Buffer.from(bytes);alpha[25]=6;expect(()=>preparedImageHeader(alpha)).toThrow('FORMAT_REJECTED');
 const oversized=Buffer.from(bytes);oversized.writeUInt32BE(2049,16);expect(()=>preparedImageHeader(oversized)).toThrow('FORMAT_REJECTED');
 // Header checks alone are not a PNG acceptance claim; the worker still performs strict decode.
});
