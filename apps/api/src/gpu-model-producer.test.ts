// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileBlobStore} from '@exhibitos/storage';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {assertGpuModelOutputCapacity,GPU_MODEL_OUTPUT_MAX_BYTES,inspectGpuModelSource,assembleGpuModelDerivative} from './gpu-model-producer.ts';
import {verifyGpuSourcePreservation} from './gpu-source-preservation.ts';
import {pngCrc} from './png-pixels.ts';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const identity=(b:Buffer)=>({bytes:b.length,sha256:sha(b)});
function png(value:number,width=512,channels=3){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(512,4);h[8]=8;h[9]=channels===3?2:6;
 const rows=Buffer.alloc((width*channels+1)*512,value);for(let y=0;y<512;y++)rows[y*(width*channels+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function glb(text:string,bin:Buffer){
 const raw=Buffer.from(text),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const out=Buffer.alloc(28+json.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
function fixture(options:{width?:number;channels?:number;transform?:(text:string)=>string}={}){
 const images=[png(80,options.width,options.channels),png(128),png(240)];
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint16Array([0,1,2]).buffer),...images];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part]of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const padding=(4-length%4)%4;blocks.push(Buffer.alloc(padding));length+=padding;}
 // Original undeclared BIN padding is deliberately nonzero. It must survive too.
 blocks.push(Buffer.from([91,92,93,94]));const bin=Buffer.concat(blocks);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:2},baseColorFactor:[0.8,0.9,1,1]},normalTexture:{index:0},occlusionTexture:{index:1}}],textures:[{source:1},{source:2},{source:0}],images:images.map((_,i)=>({bufferView:i+4,mimeType:'image/png'})),accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5123,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:bin.length-3}]};
 const text=JSON.stringify(doc),source=glb(options.transform?.(text)??text,bin);return {source,bin,doc,images};
}
function ktx(){
 // Closed synthetic container; payload is NOT a real encoding or quality proof.
 const sizes=[262144,65536,16384,4096,1024,256,64,16,16,16],out=Buffer.alloc(368+sizes.reduce((a,b)=>a+b,0));
 Buffer.from([171,75,84,88,32,50,48,187,13,10,26,10]).copy(out);
 for(const[at,n]of[[16,1],[20,512],[24,512],[36,1],[40,10],[48,320],[52,44]])out.writeUInt32LE(n!,at!);
 Buffer.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff','hex').copy(out,320);let offset=368;
 for(let i=9;i>=0;i--){out.writeBigUInt64LE(BigInt(offset),80+i*24);out.writeBigUInt64LE(BigInt(sizes[i]!),88+i*24);out.writeBigUInt64LE(BigInt(sizes[i]!),96+i*24);out.fill(i+1,offset,offset+sizes[i]!);offset+=sizes[i]!;}return out;
}
function unpack(b:Buffer){const at=20+b.readUInt32LE(12);return {doc:JSON.parse(b.toString('utf8',20,at)) as ReturnType<typeof fixture>['doc']&{extensionsUsed:string[]},bin:b.subarray(at+8)};}

it('extracts exact detached PNG and immutable metrics/ordered role map without a hash allowlist',()=>{
 const f=fixture(),original=Buffer.from(f.source),r=inspectGpuModelSource(f.source,identity(f.source));
 expect(r.colourPNG.equals(f.images[0]!)).toBe(true);expect(r.metrics).toEqual({triangles:1,vertices:3});expect(r.roles.map(x=>[x.role,x.textureIndex,x.sourceImageIndex,x.colorSpace])).toEqual([['baseColor',2,0,'srgb'],['normal',0,1,'linear'],['occlusion',1,2,'linear']]);
 expect(Object.isFrozen(r.roles)).toBe(true);expect(Object.isFrozen(r.roles[0])).toBe(true);expect(Object.isFrozen(r.metrics)).toBe(true);expect(Object.isFrozen(r.source)).toBe(true);
 r.colourPNG.fill(0);expect(f.source.equals(original)).toBe(true);expect(inspectGpuModelSource(f.source,identity(f.source)).colourPNG.equals(f.images[0]!)).toBe(true);
});
it('appends one optional texture-local KTX while preserving complete padded BIN, PNGs, geometry and source semantics',()=>{
 const f=fixture(),encoded=ktx(),before=Buffer.from(f.source),encodedBefore=Buffer.from(encoded),result=assembleGpuModelDerivative(f.source,identity(f.source),encoded),out=unpack(result.bytes);
 expect(f.source.equals(before)).toBe(true);expect(encoded.equals(encodedBefore)).toBe(true);expect(out.bin.subarray(0,f.bin.length).equals(f.bin)).toBe(true);expect(out.bin.subarray(f.bin.length,f.bin.length+encoded.length).equals(encoded)).toBe(true);
 expect(out.doc.images).toHaveLength(4);expect(out.doc.bufferViews).toHaveLength(f.doc.bufferViews.length+1);expect(out.doc.materials).toEqual(f.doc.materials);expect(out.doc.meshes).toEqual(f.doc.meshes);expect(out.doc.accessors).toEqual(f.doc.accessors);expect(out.doc.extensionsUsed).toEqual(['KHR_texture_basisu']);expect(out.doc).not.toHaveProperty('extensionsRequired');
 expect(out.doc.textures).toEqual([{source:1},{source:2},{source:0,extensions:{KHR_texture_basisu:{source:3}}}]);
 const p=result.producer;expect(Object.keys(p).sort()).toEqual(['geometry','ktx','roles','samplers','tool','version']);expect(p.geometry.algorithm).toBe('glb-source-preservation-v1');expect(p.geometry.sourceSHA256).toBe(p.geometry.outputSHA256);expect(p.samplers.sourceSHA256).toBe(sha(Buffer.from('null')));expect(p.samplers.outputSHA256).toBe(p.samplers.sourceSHA256);
 expect(p.tool).toEqual({name:'toktx',version:'4.4.2',executableSHA256:'4ec0c7fa5f123e91f8e2adb21c1b94e7119a0f396f11cc8fd747459b2a51620c',librarySHA256:'e2f8115a77cf2c1e375210d3687f487a4e54f0cde803060cb1c4085427f3d393',recipeSHA256:'82a7dd855788e590ba6698f1c3c5fc51b7638edd24c891391b20c20c09ac1fdf'});
 expect(p.ktx).toEqual({imageIndex:3,sha256:sha(encoded),bytes:encoded.length,width:512,height:512,levels:10,format:'uastc',transfer:'srgb',opaque:true,levelDimensions:[512,256,128,64,32,16,8,4,2,1]});
 for(const role of p.roles){expect(role.outputPngImageIndex).toBe(role.sourceImageIndex);expect(role.outputPngSHA256).toBe(role.sourceSHA256);expect(role.outputPngBytes).toBe(role.sourceBytes);expect(role.sourceSHA256).toBe(sha(f.images[role.sourceImageIndex]!));}
 expect(Object.isFrozen(p.ktx.levelDimensions)).toBe(true);
});
it('retains empty sampler arrays and explicit empty sampler objects exactly, including their distinct digests',()=>{
 for(const suffix of [',"samplers":[]',',"samplers":[{}]']){const f=fixture({transform:s=>s.slice(0,-1)+suffix+'}'}),r=assembleGpuModelDerivative(f.source,identity(f.source),ktx());expect(unpack(r.bytes).doc).toMatchObject({samplers:JSON.parse(suffix.slice(1).replace('"samplers":',''))});expect(r.producer.samplers.sourceSHA256).toBe(sha(Buffer.from(suffix.includes('{}')?'[{}]':'[]')));}
});
it.each([
 ['missing normal',(s:string)=>s.replace(',"normalTexture":{"index":0}','')],
 ['aliased roles',(s:string)=>s.replace('"normalTexture":{"index":0}','"normalTexture":{"index":2}')],
 ['aliased images',(s:string)=>s.replace('"source":1','"source":0')],
 ['nonzero UV',(s:string)=>s.replace('"baseColorTexture":{"index":2}','"baseColorTexture":{"index":2,"texCoord":1}')],
 ['explicit nonmip filter',(s:string)=>s.slice(0,-1)+',"samplers":[{"minFilter":9729}]}'],
 ['explicit equivalent repeat',(s:string)=>s.slice(0,-1)+',"samplers":[{"wrapS":10497}]}'],
 ['duplicate JSON',(s:string)=>s.replace('"scene":0','"scene":0,"scene":0')],
 ['escaped duplicate JSON',(s:string)=>s.replace('"scene":0','"scene":0,"\\u0073cene":0')],
 ['nonfinite JSON',(s:string)=>s.replace('"scene":0','"scene":1e999')],
 ['nonpreservable negative zero',(s:string)=>s.replace('"scene":0','"scene":-0')],
 ['node transform',(s:string)=>s.replace('"mesh":0','"mesh":0,"scale":[1,1,1]')],
] as const)('rejects unsupported %s before encoding',(_label,transform)=>{const f=fixture({transform});expect(()=>inspectGpuModelSource(f.source,identity(f.source))).toThrow();expect(()=>assembleGpuModelDerivative(f.source,identity(f.source),ktx())).toThrow();});
it.each([{width:256},{channels:4}])('rejects dimensions or alpha-bearing PNG %j',options=>{const f=fixture(options);expect(()=>inspectGpuModelSource(f.source,identity(f.source))).toThrow();});
it('rejects malformed PNG pixels/CRC even with a fresh valid GLB hash',()=>{
 const f=fixture(),b=Buffer.from(f.source),at=b.indexOf(f.images[0]!);b[at+40]=b[at+40]!^1;expect(()=>inspectGpuModelSource(b,identity(b))).toThrow();
});
it('rejects mismatched source identity and KTX structural corruption without modifying inputs',()=>{
 const f=fixture(),before=Buffer.from(f.source);expect(()=>inspectGpuModelSource(f.source,{...identity(f.source),sha256:'0'.repeat(64)})).toThrow('MODEL_PREPARATION_INPUT_INTEGRITY');
 const b=ktx();b.writeUInt32LE(1,44);expect(()=>assembleGpuModelDerivative(f.source,identity(f.source),b)).toThrow('KTX2_MIPPED_PROFILE_INVALID');expect(f.source.equals(before)).toBe(true);
});
it('whole-output hash recomputation cannot hide mutation of original padding or PNG bytes',()=>{
 const f=fixture(),encoded=ktx(),r=assembleGpuModelDerivative(f.source,identity(f.source),encoded),at=28+r.bytes.readUInt32LE(12);
 for(const offset of [f.bin.length-1,f.doc.bufferViews[4]!.byteOffset]){const b=Buffer.from(r.bytes);b[at+offset]=b[at+offset]!^1;expect(()=>verifyGpuSourcePreservation(f.source,b,{source:identity(f.source),candidate:identity(b),textureIndex:2,ktx:identity(encoded)})).toThrow('GPU_SOURCE_PRESERVATION_INVALID');}
});

function paddedSource(binBytes:number){
 const f=fixture(),bin=Buffer.alloc(binBytes,17);f.bin.copy(bin);f.doc.buffers[0]!.byteLength=bin.length-3;
 return glb(JSON.stringify(f.doc),bin);
}
it('reserves the managed encoder ceiling before encoding, conservatively without shrinking admitted sources',()=>{
 const fitting=paddedSource(23*1024*1024),conservative=paddedSource(25*1024*1024);
 expect(assertGpuModelOutputCapacity(fitting,identity(fitting)).metrics).toEqual({triangles:1,vertices:3});
 expect(inspectGpuModelSource(conservative,identity(conservative)).metrics).toEqual({triangles:1,vertices:3});
 // This actual small structural container would fit; the preflight intentionally
 // reserves the encoder 8 MiB ceiling rather than promising a physical output size.
 expect(assembleGpuModelDerivative(conservative,identity(conservative),ktx()).bytes.length).toBeLessThan(GPU_MODEL_OUTPUT_MAX_BYTES);
 expect(()=>assertGpuModelOutputCapacity(conservative,identity(conservative))).toThrow('GPU_MODEL_OUTPUT_CAPACITY');
});
it('rejects near-store-limit source capacity before output allocation while real durable source custody stays intact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gpu-output-capacity-')),store=new FileBlobStore(root),source=paddedSource(GPU_MODEL_OUTPUT_MAX_BYTES-4096),before=Buffer.from(source);
 try{
  expect(source.length).toBeLessThanOrEqual(32*1024*1024);
  await store.putDurable('synthetic/source',source);
  expect(Buffer.from(await store.getBounded('synthetic/source',source.length)).equals(before)).toBe(true);
  expect(inspectGpuModelSource(source,identity(source)).metrics.triangles).toBe(1);
  expect(()=>assertGpuModelOutputCapacity(source,identity(source))).toThrow('GPU_MODEL_OUTPUT_CAPACITY');
  expect(()=>assembleGpuModelDerivative(source,identity(source),ktx())).toThrow('GPU_MODEL_OUTPUT_CAPACITY');
  expect(Buffer.from(await store.getBounded('synthetic/source',source.length)).equals(before)).toBe(true);
  await expect(store.putDurable('synthetic/over-limit',Buffer.alloc(GPU_MODEL_OUTPUT_MAX_BYTES+1))).rejects.toThrow('size');
  await expect(store.getBounded('synthetic/source',GPU_MODEL_OUTPUT_MAX_BYTES+1)).rejects.toThrow('size');
  expect(await store.listAll()).toEqual(['synthetic/source']);
 }finally{await rm(root,{recursive:true,force:true});}
});
