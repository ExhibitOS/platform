// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {DEVICE_BUDGETS,workspaceFurnishingModelPreflight} from './loading';
const buffer=(data:Buffer)=>new Uint8Array(data).buffer;
type FixtureDoc={scene?:number;scenes:{nodes:number[]}[];bufferViews:{buffer:number;byteOffset?:number;byteLength:number}[];images:{bufferView:number;mimeType:string}[];textures:{source:number;extensions?:{KHR_texture_basisu:{source:number}}}[];buffers:{byteLength:number}[];nodes:{extensions?:unknown}[];meshes:{primitives:{mode?:number}[]}[];skins?:unknown;animations?:unknown};
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
 const paired=rewrite(png,(doc,bin)=>{const offset=bin.length,ktx=Buffer.alloc(40);ktx.writeUInt32LE(8,20);ktx.writeUInt32LE(8,24);ktx.writeUInt32LE(1,36);doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:ktx.length});const index=doc.images.length;doc.images.push({bufferView:doc.bufferViews.length-1,mimeType:'image/ktx2'});doc.textures[0]!.extensions={KHR_texture_basisu:{source:index}};doc.textures.push({...doc.textures[0]!});doc.buffers[0]!.byteLength=offset+ktx.length;return Buffer.concat([bin,ktx]);});
 const result=workspaceFurnishingModelPreflight(buffer(paired),paired.length,DEVICE_BUDGETS.desktop);expect(result.reserveBytes).toBeGreaterThan(base.reserveBytes+8*8*4*2);expect(()=>workspaceFurnishingModelPreflight(buffer(paired),paired.length,{...DEVICE_BUDGETS.desktop,maxTextureSize:4})).toThrow('DECODE_BUDGET_EXCEEDED');
 for(const [offset,value] of [[28,2],[32,2],[36,6]]){const invalid=rewrite(paired,(doc,bin)=>{const image=doc.images.at(-1)!,view=doc.bufferViews[image.bufferView]!;bin.writeUInt32LE(value!, (view.byteOffset??0)+offset!);return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(invalid),invalid.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');}
 for(const offset of [-1,0.5]){const malformed=rewrite(png,(doc,bin)=>{doc.bufferViews[doc.images[0]!.bufferView]!.byteOffset=offset;return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(malformed),malformed.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');}
 const foreign=rewrite(png,(doc,bin)=>{doc.bufferViews[doc.images[0]!.bufferView]!.buffer=1;return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(foreign),foreign.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');
 const stress=rewrite(png,(doc,bin)=>{while(doc.textures.length<9)doc.textures.push({...doc.textures[0]!});return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(stress),stress.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');
 const images=rewrite(png,(doc,bin)=>{while(doc.images.length<17)doc.images.push({...doc.images[0]!});return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(images),images.length,DEVICE_BUDGETS.desktop)).toThrow('DECODE_BUDGET_EXCEEDED');
 const instanced=rewrite(png,(doc,bin)=>{doc.nodes[0]!.extensions={EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:0}}};return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(instanced),instanced.length,DEVICE_BUDGETS.desktop)).toThrow('WORKSPACE_FURNISHING_UNSUPPORTED');
 const strip=rewrite(png,(doc,bin)=>{doc.meshes[0]!.primitives[0]!.mode=5;return bin;});expect(()=>workspaceFurnishingModelPreflight(buffer(strip),strip.length,DEVICE_BUDGETS.desktop)).toThrow('WORKSPACE_FURNISHING_UNSUPPORTED');
 expect(()=>workspaceFurnishingModelPreflight(buffer(png),png.length,{...DEVICE_BUDGETS.desktop,maxTransitionBytes:1})).toThrow('ASSET_BUDGET_EXCEEDED');
});
