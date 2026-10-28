// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {deflateSync} from 'node:zlib';
import {qualifyApprovedTextureDerivativePair,qualifyApprovedTexturedPair} from './approved-lod-pair.ts';
import {pngCrc} from './png-pixels.ts';
function chunk(name:string,body:Buffer){const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);h.write(name,4);tail.writeUInt32BE(pngCrc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);}
function image(role:number,reduced:boolean,corrupt=false,intent=0,idatCount=1){
 const edge=reduced?(role===0?512:256):1024,raw=Buffer.alloc((edge*3+1)*edge);
 for(let y=0;y<edge;y++)for(let x=0;x<edge;x++)for(let c=0;c<3;c++){
  const sx=Math.floor((2*x+1)*1024/(2*edge)),sy=Math.floor((2*y+1)*1024/(2*edge));raw[y*(edge*3+1)+1+x*3+c]=(sx*17+sy*11+role*53+c*71)%256;
 }
 if(corrupt)raw[1]=raw[1]!^1;
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(edge);ihdr.writeUInt32BE(edge,4);ihdr[8]=8;ihdr[9]=2;
 const compressed=deflateSync(raw),packets=Array.from({length:idatCount},(_,i)=>chunk('IDAT',compressed.subarray(Math.floor(i*compressed.length/idatCount),Math.floor((i+1)*compressed.length/idatCount))));
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('sRGB',Buffer.from([intent])),...packets,chunk('IEND',Buffer.alloc(0))]);
}
function model(reduced=false,change:'none'|'pixel'|'uv'|'intent'|'role'|'normal-sign'|'normal-zero'='none',idatCount=1){
 const parts:Buffer[]=[],views:Record<string,number>[]=[],add=(bytes:Buffer)=>{const i=views.length;views.push({buffer:0,byteOffset:parts.reduce((n,b)=>n+b.length,0),byteLength:bytes.length});parts.push(Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4)]));return i;};
 const positions=add(Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)),normals=add(Buffer.from(new Float32Array([0,0,change==='normal-sign'?-1:change==='normal-zero'?0:1,0,0,change==='normal-sign'?-1:change==='normal-zero'?0:1,0,0,change==='normal-sign'?-1:change==='normal-zero'?0:1]).buffer)),uv=add(Buffer.from(new Float32Array([0,0,change==='uv'?.5:1,0,0,1]).buffer)),indices=add(Buffer.from(new Uint32Array([0,1,2]).buffer));
 const images=[0,1,2].map(role=>({bufferView:add(image(role,reduced,change==='pixel'&&role===1,change==='intent'&&role===1?1:0,idatCount)),mimeType:'image/png'}));
 const d={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,mode:4,material:0}]}],materials:[{name:'retained',pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:.1,roughnessFactor:.8},normalTexture:{index:change==='role'?2:1},occlusionTexture:{index:change==='role'?1:2}}],images,textures:[{source:0},{source:1},{source:2}],buffers:[{byteLength:parts.reduce((n,b)=>n+b.length,0)}],bufferViews:views,accessors:[{bufferView:positions,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:normals,componentType:5126,count:3,type:'VEC3'},{bufferView:uv,componentType:5126,count:3,type:'VEC2'},{bufferView:indices,componentType:5125,count:3,type:'SCALAR'}]};
 const raw=Buffer.from(JSON.stringify(d)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),h=Buffer.alloc(20),bh=Buffer.alloc(8),bin=Buffer.concat(parts);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,bh,bin]);
}
const declared={triangles:1,fullTextureSize:1024,reducedTextureSize:512};
test('explicit texture-only pair retains geometry and proves role-aware centre samples; legacy stays separate',()=>{
 const full=model(),low=model(true),observed=qualifyApprovedTextureDerivativePair(full,low,declared);
 expect(observed.full).toEqual({triangles:1,textureSize:1024});expect(observed.coarse).toEqual({triangles:1,textureSize:512});
 expect(()=>qualifyApprovedTexturedPair(full,low,1,1)).toThrow();
});
test('rejects modified sampled pixels, UV, transfer intent, semantic role and declared dimensions',()=>{
 const full=model();
 for(const change of ['pixel','uv','intent','role'] as const)expect(()=>qualifyApprovedTextureDerivativePair(full,model(true,change),declared)).toThrow();
 expect(()=>qualifyApprovedTextureDerivativePair(full,model(true),{...declared,reducedTextureSize:256})).toThrow();
});

test('existing bounded public worker creates a hash-bound image-only derivative and closes before resolving',async()=>{
 const {prepareModelPair,MODEL_SETTINGS_SHA256,MODEL_TOOL_VERSION}=await import('./model-derivation.ts');
 const source=model(false,'none',355),result=await prepareModelPair(source,{version:1,profileId:'exhibitos-near-texture-pair-v1',settingsSha256:MODEL_SETTINGS_SHA256,toolVersion:MODEL_TOOL_VERSION,operationID:'worker-test',generation:'one',artworkRevision:1});
 expect(result.receipt.full).toMatchObject({bytes:source.length,reusedExactBytes:true,triangles:1,textureSize:1024});
 expect(result.receipt.reduced).toMatchObject({bytes:result.bytes.length,triangles:1,textureSize:512});
 expect(()=>qualifyApprovedTextureDerivativePair(source,result.bytes,declared)).not.toThrow();
},15000);


test('exact-topology texture path preserves authored normal signs without accepting invalid or changed normals',()=>{
 const full=model(false,'normal-sign'),low=model(true,'normal-sign');
 expect(()=>qualifyApprovedTextureDerivativePair(full,low,declared)).not.toThrow();
 expect(()=>qualifyApprovedTextureDerivativePair(full,model(true),declared)).toThrow();
 expect(()=>qualifyApprovedTextureDerivativePair(model(false,'normal-zero'),model(true,'normal-zero'),declared)).toThrow();
 expect(()=>qualifyApprovedTexturedPair(full,low,1,1)).toThrow();
});

function legacySignedPair(sign:1|-1){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(8);ihdr.writeUInt32BE(8,4);ihdr[8]=8;ihdr[9]=2;
 const image=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((8*3+1)*8))),chunk('IEND',Buffer.alloc(0))]);
 const build=(coarse:boolean)=>{
  const points=coarse?[0,0,0,1,0,0,1,1,0]:[0,0,0,1,0,0,1,1,0,0,1,0],count=points.length/3;
  const normals=Array.from({length:count},()=>[0,0,sign]).flat(),uv=Array.from({length:count},(_,i)=>[points[i*3]!,points[i*3+1]!]).flat(),indices=coarse?[0,1,2]:[0,1,2,0,2,3];
  const data=[Buffer.from(new Float32Array(points).buffer),Buffer.from(new Float32Array(normals).buffer),Buffer.from(new Float32Array(uv).buffer),Buffer.from(new Uint32Array(indices).buffer),image,image,image],parts:Buffer[]=[],views:Record<string,number>[]= [];let offset=0;
  for(const b of data){views.push({buffer:0,byteOffset:offset,byteLength:b.length});const padded=Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);parts.push(padded);offset+=padded.length;}
  const d={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,mode:4,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:.1,roughnessFactor:.8},normalTexture:{index:1},occlusionTexture:{index:2}}],images:[4,5,6].map(bufferView=>({bufferView,mimeType:'image/png'})),textures:[0,1,2].map(source=>({source,sampler:0})),samplers:[{minFilter:9729,magFilter:9729,wrapS:10497,wrapT:10497}],buffers:[{byteLength:offset}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count,type:'VEC3'},{bufferView:2,componentType:5126,count,type:'VEC2'},{bufferView:3,componentType:5125,count:indices.length,type:'SCALAR'}]};
  const raw=Buffer.from(JSON.stringify(d)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),h=Buffer.alloc(20),bh=Buffer.alloc(8),bin=Buffer.concat(parts);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,bh,bin]);
 };return {full:build(false),coarse:build(true)};
}
test('legacy geometry reduction still enforces its own positive face-normal predicate',()=>{
 const positive=legacySignedPair(1),negative=legacySignedPair(-1);
 expect(()=>qualifyApprovedTexturedPair(positive.full,positive.coarse,2,1)).not.toThrow();
 expect(()=>qualifyApprovedTexturedPair(negative.full,negative.coarse,2,1)).toThrow();
});
