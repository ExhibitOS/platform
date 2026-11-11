// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {verifyGpuSourcePreservation,type GpuPreservationBinding} from './gpu-source-preservation.ts';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function glb(doc:unknown,bin:Buffer,jsonText=JSON.stringify(doc)){
 const raw=Buffer.from(jsonText),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const out=Buffer.alloc(28+json.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
 out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
 out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
function fixture(){
 // Deliberately synthetic payload: these tests establish preservation, NOT KTX or source admission.
 const bin=Buffer.from([1,2,3,4,5,6,7,0]),ktx=Buffer.from([21,22,23,24,25]);
 const sourceDoc={asset:{version:'2.0'},buffers:[{byteLength:7}],bufferViews:[{buffer:0,byteOffset:0,byteLength:7}],images:[{bufferView:0,mimeType:'image/png'}],textures:[{source:0}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:0},baseColorFactor:[1,1,1,1]}}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],accessors:[{componentType:5126,count:1,type:'VEC3',normalized:false,sparse:{count:0}},{componentType:5126,count:1,type:'VEC2'},{componentType:5123,count:1,type:'SCALAR'}],nodes:[{mesh:0,translation:[0,0,0]}],scenes:[{nodes:[0]}],scene:0};
 const doc=JSON.parse(JSON.stringify(sourceDoc));doc.buffers[0].byteLength=16;
 doc.bufferViews.push({buffer:0,byteOffset:8,byteLength:5});doc.images.push({bufferView:1,mimeType:'image/ktx2'});
 doc.textures[0].extensions={KHR_texture_basisu:{source:1}};doc.extensionsUsed=['KHR_texture_basisu'];
 const outputBin=Buffer.concat([bin,ktx,Buffer.alloc(3)]),source=glb(sourceDoc,bin);
 const candidate=()=>glb(doc,outputBin);
 const binding=(bytes:Buffer):GpuPreservationBinding=>({source:{sha256:sha(source),bytes:source.length},candidate:{sha256:sha(bytes),bytes:bytes.length},textureIndex:0,ktx:{sha256:sha(ktx),bytes:ktx.length}});
 return {sourceDoc,doc,source,bin,outputBin,candidate,binding};
}
it('binds complete source semantics and padded BIN while allowing only the exact append',()=>{
 const f=fixture(),candidate=f.candidate(),r=verifyGpuSourcePreservation(f.source,candidate,f.binding(candidate));
 expect(r.sourceSHA256).toBe(r.outputSHA256);expect(r.algorithm).toBe('glb-source-preservation-v1');expect(r.ktx).toMatchObject({imageIndex:1,textureIndex:0,bytes:5});
});
it.each([
 ['primitive material',(d:ReturnType<typeof fixture>['doc'])=>{d.meshes[0].primitives[0].material=1;}],
 ['indices',(d:ReturnType<typeof fixture>['doc'])=>{d.meshes[0].primitives[0].indices=0;}],
 ['node transform',(d:ReturnType<typeof fixture>['doc'])=>{d.nodes[0].translation[0]=1;}],
 ['texCoord',(d:ReturnType<typeof fixture>['doc'])=>{d.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord=1;}],
 ['factor',(d:ReturnType<typeof fixture>['doc'])=>{d.materials[0].pbrMetallicRoughness.baseColorFactor[0]=0;}],
 ['normalization',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[0].normalized=true;}],
 ['sparse',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[0].sparse.count=1;}],
 ['sampler',(d:ReturnType<typeof fixture>['doc'])=>{d.samplers=[{minFilter:9729}];d.textures[0].sampler=0;}],
 ['extra view',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews.push({buffer:0,byteOffset:0,byteLength:4});}],
 ['extra image',(d:ReturnType<typeof fixture>['doc'])=>{d.images.push({bufferView:0,mimeType:'image/png'});}],
 ['wrong binding',(d:ReturnType<typeof fixture>['doc'])=>{d.textures[0].extensions.KHR_texture_basisu.source=0;}],
 ['extra extension',(d:ReturnType<typeof fixture>['doc'])=>{d.textures[0].extensions.other={};}],
 ['wrong KTX range',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1].byteOffset=4;}],
 ['changed source view',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[0].byteLength=6;}],
] as const)('rejects %s even with a newly valid whole-candidate hash',(_name,mutate)=>{
 const f=fixture();mutate(f.doc);const b=f.candidate();expect(()=>verifyGpuSourcePreservation(f.source,b,f.binding(b))).toThrow('GPU_SOURCE_PRESERVATION_INVALID');
});
it.each([0,7,8,15])('rejects original bytes, original padding, KTX or trailing padding changes at %s',at=>{
 const f=fixture();f.outputBin[at]=f.outputBin[at]!^1;const b=f.candidate();expect(()=>verifyGpuSourcePreservation(f.source,b,f.binding(b))).toThrow();
});
it('rejects extra trailing data, chunk types, lengths and unbound hashes',()=>{
 const f=fixture(),b=f.candidate();for(const at of [0,4,8,12,16]){const bad=Buffer.from(b);bad[at]=bad[at]!^1;expect(()=>verifyGpuSourcePreservation(f.source,bad,f.binding(bad))).toThrow();}
 const extra=Buffer.concat([b,Buffer.alloc(4)]);extra.writeUInt32LE(extra.length,8);expect(()=>verifyGpuSourcePreservation(f.source,extra,f.binding(extra))).toThrow();
 const bound=f.binding(b);bound.candidate.sha256='0'.repeat(64);expect(()=>verifyGpuSourcePreservation(f.source,b,bound)).toThrow();
 bound.candidate.sha256=sha(b);bound.ktx.sha256='0'.repeat(64);expect(()=>verifyGpuSourcePreservation(f.source,b,bound)).toThrow();
});
it.each(['"scene":0,"scene":0','"scene":0,"\\u0073cene":0'])('rejects duplicate JSON keys, including escaped aliases: %s',replacement=>{
 const f=fixture(),text=JSON.stringify(f.doc).replace('"scene":0',replacement),b=glb(f.doc,f.outputBin,text);
 expect(()=>verifyGpuSourcePreservation(f.source,b,f.binding(b))).toThrow();
});
it('rejects nonfinite JSON and preserves numeric sign semantics',()=>{
 const f=fixture();let text=JSON.stringify(f.doc).replace('"scene":0','"scene":1e999'),b=glb(f.doc,f.outputBin,text);
 expect(()=>verifyGpuSourcePreservation(f.source,b,f.binding(b))).toThrow();
 text=JSON.stringify(f.doc).replace('"scene":0','"scene":-0');b=glb(f.doc,f.outputBin,text);
 expect(()=>verifyGpuSourcePreservation(f.source,b,f.binding(b))).toThrow();
});
it('preserves an existing extensionsUsed array and buffer properties exactly',()=>{
 const f=fixture();const sourceDoc={...f.sourceDoc,extensionsUsed:[]};const source=glb(sourceDoc,f.bin),b=f.candidate(),binding=f.binding(b);binding.source={sha256:sha(source),bytes:source.length};
 expect(verifyGpuSourcePreservation(source,b,binding).sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
});
it.each([
 ['KHR_texture_basisu'],
 ['EXAMPLE_other','KHR_texture_basisu'],
 ['KHR_texture_basisu','EXAMPLE_other'],
])('preserves existing Basis declaration and its array order: %j',(...used)=>{
 const f=fixture(),sourceDoc={...f.sourceDoc,extensionsUsed:used};f.doc.extensionsUsed=[...used];
 const source=glb(sourceDoc,f.bin),b=f.candidate(),binding=f.binding(b);binding.source={sha256:sha(source),bytes:source.length};
 expect(verifyGpuSourcePreservation(source,b,binding).sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
 f.doc.extensionsUsed=[...used,'KHR_texture_basisu'];const duplicate=f.candidate();
 expect(()=>verifyGpuSourcePreservation(source,duplicate,{...binding,candidate:{sha256:sha(duplicate),bytes:duplicate.length}})).toThrow();
});
it('preserves unrelated texture extensions while leaving eligibility to the source validator',()=>{
 const f=fixture(),sourceDoc=JSON.parse(JSON.stringify(f.sourceDoc));
 const other={source:0,extensions:{EXAMPLE_other:{value:2}}};sourceDoc.textures.push(other);f.doc.textures.push(structuredClone(other));
 const source=glb(sourceDoc,f.bin),b=f.candidate(),binding=f.binding(b);binding.source={sha256:sha(source),bytes:source.length};
 expect(verifyGpuSourcePreservation(source,b,binding).sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
 f.doc.textures[1].extensions.EXAMPLE_other.value=3;const changed=f.candidate();
 expect(()=>verifyGpuSourcePreservation(source,changed,{...binding,candidate:{sha256:sha(changed),bytes:changed.length}})).toThrow();
});
