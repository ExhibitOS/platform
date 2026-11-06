// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {DEVICE_BUDGETS,workspaceFurnishingModelPreflight} from './loading';
const buffer=(data:Buffer)=>new Uint8Array(data).buffer;
type FixtureDoc={scene?:number;scenes:{nodes:number[]}[];bufferViews:{buffer:number;byteOffset?:number;byteLength:number}[];images:{bufferView:number;mimeType:string}[];textures:{source:number;extensions?:{KHR_texture_basisu:{source:number}}}[];buffers:{byteLength:number}[];skins?:unknown;animations?:unknown};
function rewrite(bytes:Buffer,edit:(doc:FixtureDoc,bin:Buffer)=>Buffer){
 const n=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+n).toString()) as FixtureDoc,bin=edit(doc,Buffer.from(bytes.subarray(28+n))),json=Buffer.from(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4,result=Buffer.alloc(28+length+bin.length,0x20);
 result.write('glTF');result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(length,12);result.write('JSON',16);json.copy(result,20);result.writeUInt32LE(bin.length,20+length);result.write('BIN\0',24+length);bin.copy(result,28+length);return result;
}
it('counts scene instances and enforces the actual triangle, draw and byte budgets',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),result=workspaceFurnishingModelPreflight(buffer(bytes),bytes.length,DEVICE_BUDGETS.desktop);expect(result.triangles).toBeGreaterThan(0);expect(result.draws).toBeGreaterThan(0);expect(result.reserveBytes).toBeGreaterThan(bytes.length);
 expect(()=>workspaceFurnishingModelPreflight(buffer(bytes),bytes.length+1,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');expect(()=>workspaceFurnishingModelPreflight(buffer(bytes),bytes.length,{...DEVICE_BUDGETS.desktop,maxTriangles:result.triangles-1})).toThrow('ASSET_BUDGET_EXCEEDED');
 const duplicate=rewrite(bytes,(doc,bin)=>{doc.scenes[doc.scene??0]!.nodes.push(doc.scenes[doc.scene??0]!.nodes[0]!);return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(duplicate),duplicate.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');
 const animated=rewrite(bytes,(doc,bin)=>{doc.animations=[];return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(animated),animated.length,DEVICE_BUDGETS.desktop)).toThrow('WORKSPACE_FURNISHING_UNSUPPORTED');
});
it('reserves embedded PNG and KTX2 headers conservatively, including shared KTX2 references',()=>{
 const {publicPBRTexturedGLB}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicPBRTexturedGLB:()=>Buffer},png=publicPBRTexturedGLB(),base=workspaceFurnishingModelPreflight(buffer(png),png.length,DEVICE_BUDGETS.desktop);
 // Budget-header fixture only: registration and the model-local loader separately validate the actual KTX2 payload.
 const paired=rewrite(png,(doc,bin)=>{const offset=bin.length,ktx=Buffer.alloc(28);ktx.writeUInt32LE(8,20);ktx.writeUInt32LE(8,24);doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:ktx.length});const index=doc.images.length;doc.images.push({bufferView:doc.bufferViews.length-1,mimeType:'image/ktx2'});doc.textures[0]!.extensions={KHR_texture_basisu:{source:index}};doc.textures.push({...doc.textures[0]!});doc.buffers[0]!.byteLength=offset+ktx.length;return Buffer.concat([bin,ktx]);});
 const result=workspaceFurnishingModelPreflight(buffer(paired),paired.length,DEVICE_BUDGETS.desktop);expect(result.reserveBytes).toBeGreaterThan(base.reserveBytes+8*8*4*2);expect(()=>workspaceFurnishingModelPreflight(buffer(paired),paired.length,{...DEVICE_BUDGETS.desktop,maxTextureSize:4})).toThrow('DECODE_BUDGET_EXCEEDED');
});
