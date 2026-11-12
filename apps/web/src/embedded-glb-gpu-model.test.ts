// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import {LoadingManager} from 'three';
import {embeddedPNGManager} from './embedded-glb';

// Structural container only, matching bounded-mipped-ktx2.test.ts. These blocks
// and PNG headers do not claim encoder, decoder, transcode, or fidelity proof.
function mippedKtx(){
 const sizes=[262144,65536,16384,4096,1024,256,64,16,16,16];
 const dfd=[44,0,0,0,0,0,0,0,2,0,40,0,166,1,2,0,3,3,0,0,16,0,0,0,0,0,0,0,0,0,127,0,0,0,0,0,0,0,0,0,255,255,255,255];
 const bytes=new Uint8Array(368+sizes.reduce((a,b)=>a+b,0)),v=new DataView(bytes.buffer);
 bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
 for(const [at,n]of [[16,1],[20,512],[24,512],[36,1],[40,10],[48,320],[52,44]])v.setUint32(at!,n!,true);
 bytes.set(dfd,320);let offset=368;
 for(let i=9;i>=0;i--){v.setBigUint64(80+i*24,BigInt(offset),true);v.setBigUint64(88+i*24,BigInt(sizes[i]!),true);v.setBigUint64(96+i*24,BigInt(sizes[i]!),true);bytes.fill(i+1,offset,offset+sizes[i]!);offset+=sizes[i]!;}
 return bytes;
}
function png(width:number,colourType:number){
 const bytes=new Uint8Array(36),v=new DataView(bytes.buffer);
 bytes.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,width);v.setUint32(20,width);bytes[24]=8;bytes[25]=colourType;return bytes;
}
function fixture(change?:(doc:ReturnType<typeof JSON.parse>)=>void,widths=[512,512,512],colours=[2,2,2]){
 const parts=[...widths.map((width,i)=>png(width,colours[i]!)),mippedKtx()],bin=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));
 let offset=0;const views=parts.map(part=>{const view={buffer:0,byteOffset:offset,byteLength:part.length};bin.set(part,offset);offset+=part.length;return view;});
 const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:views,images:parts.map((_part,i)=>({bufferView:i,mimeType:i===3?'image/ktx2':'image/png'})),textures:[{source:0,extensions:{KHR_texture_basisu:{source:3}}},{source:1},{source:2}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},normalTexture:{index:1},occlusionTexture:{index:2}}],meshes:[{primitives:[{material:0}]}],extensionsUsed:['KHR_texture_basisu']};
 change?.(doc);
 const json=new TextEncoder().encode(JSON.stringify(doc)),n=Math.ceil(json.length/4)*4,bytes=new Uint8Array(28+n+bin.length),v=new DataView(bytes.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+n);bytes.set(json,20);v.setUint32(20+n,bin.length,true);v.setUint32(24+n,0x004e4942,true);bytes.set(bin,28+n);return bytes.buffer;
}
afterEach(()=>vi.unstubAllGlobals());
test('real manager accepts dedicated ten-mip colour/three raw PNG recipe without starting a decoder',async()=>{
 const parse=vi.fn(),bitmap=vi.fn();vi.stubGlobal('createImageBitmap',bitmap);
 const manager=new LoadingManager(),scope=embeddedPNGManager(manager,fixture(),{parse},undefined,'gpu-model-v1');
 expect(scope.ktx2Loader).toBeDefined();expect(scope.bytes.byteLength).toBeGreaterThan(349000);expect(parse).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();
 scope.dispose();await scope.drain();scope.retire();expect(scope.cleanupOK()).toBe(true);expect(()=>scope.bytes).toThrow('EXTERNAL_RESOURCE_REJECTED');
});
test('legacy default does not admit the new mipped profile',()=>{
 const parse=vi.fn();expect(()=>embeddedPNGManager(new LoadingManager(),fixture(),{parse})).toThrow('EXTERNAL_RESOURCE_REJECTED');expect(parse).not.toHaveBeenCalled();
});
test.each([
 ['missing pair',(doc:ReturnType<typeof JSON.parse>)=>{delete doc.textures[0].extensions;}],
 ['basecolour misbinding',(doc:ReturnType<typeof JSON.parse>)=>{doc.materials[0].pbrMetallicRoughness.baseColorTexture.index=1;}],
 ['compressed normal',(doc:ReturnType<typeof JSON.parse>)=>{doc.textures[1].extensions=doc.textures[0].extensions;delete doc.textures[0].extensions;}],
 ['untextured',(doc:ReturnType<typeof JSON.parse>)=>{delete doc.images;delete doc.textures;delete doc.materials;delete doc.extensionsUsed;}],
 ['unknown extension',(doc:ReturnType<typeof JSON.parse>)=>{doc.extensionsUsed.push('KHR_unapproved');}],
 ['nested extension',(doc:ReturnType<typeof JSON.parse>)=>{doc.extras={extensions:{unknown:{}}};}],
])('real manager rejects %s before any decoder callback',(_name,change)=>{
 const parse=vi.fn(),bitmap=vi.fn();vi.stubGlobal('createImageBitmap',bitmap);
 expect(()=>embeddedPNGManager(new LoadingManager(),fixture(change),{parse},undefined,'gpu-model-v1')).toThrow('EXTERNAL_RESOURCE_REJECTED');expect(parse).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();
});
test.each([0,1,2])('requires every raw fallback role to remain512RGB (role%i)',role=>{
 const parse=vi.fn(),widths=[512,512,512],colours=[2,2,2];widths[role]=256;
 expect(()=>embeddedPNGManager(new LoadingManager(),fixture(undefined,widths),{parse},undefined,'gpu-model-v1')).toThrow('EXTERNAL_RESOURCE_REJECTED');
 colours[role]=6;expect(()=>embeddedPNGManager(new LoadingManager(),fixture(undefined,undefined,colours),{parse},undefined,'gpu-model-v1')).toThrow('EXTERNAL_RESOURCE_REJECTED');expect(parse).not.toHaveBeenCalled();
});
test('GPU mode requires explicit decoder proxy and refuses acquired-original texture mixing',()=>{
 const parse=vi.fn();expect(()=>embeddedPNGManager(new LoadingManager(),fixture(),undefined,undefined,'gpu-model-v1')).toThrow('EXTERNAL_RESOURCE_REJECTED');
 expect(()=>embeddedPNGManager(new LoadingManager(),fixture(),{parse},[],'gpu-model-v1')).toThrow('EXTERNAL_RESOURCE_REJECTED');expect(parse).not.toHaveBeenCalled();
});
