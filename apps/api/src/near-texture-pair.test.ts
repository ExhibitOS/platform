// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {deflateSync} from 'node:zlib';
import {qualifyApprovedTextureDerivativePair,qualifyApprovedTexturedPair} from './approved-lod-pair.ts';
import {pngCrc} from './png-pixels.ts';
function chunk(name:string,body:Buffer){const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);h.write(name,4);tail.writeUInt32BE(pngCrc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);}
function image(role:number,reduced:boolean,corrupt=false,intent=0){
 const edge=reduced?(role===0?512:256):1024,raw=Buffer.alloc((edge*3+1)*edge);
 for(let y=0;y<edge;y++)for(let x=0;x<edge;x++)for(let c=0;c<3;c++){
  const sx=Math.floor((2*x+1)*1024/(2*edge)),sy=Math.floor((2*y+1)*1024/(2*edge));raw[y*(edge*3+1)+1+x*3+c]=(sx*17+sy*11+role*53+c*71)%256;
 }
 if(corrupt)raw[1]^=1;
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(edge);ihdr.writeUInt32BE(edge,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('sRGB',Buffer.from([intent])),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function model(reduced=false,change:'none'|'pixel'|'uv'|'intent'|'role'='none'){
 const parts:Buffer[]=[],views:Record<string,number>[]=[],add=(bytes:Buffer)=>{const i=views.length;views.push({buffer:0,byteOffset:parts.reduce((n,b)=>n+b.length,0),byteLength:bytes.length});parts.push(Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4)]));return i;};
 const positions=add(Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)),normals=add(Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer)),uv=add(Buffer.from(new Float32Array([0,0,change==='uv'?.5:1,0,0,1]).buffer)),indices=add(Buffer.from(new Uint32Array([0,1,2]).buffer));
 const images=[0,1,2].map(role=>({bufferView:add(image(role,reduced,change==='pixel'&&role===1,change==='intent'&&role===1?1:0)),mimeType:'image/png'}));
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
