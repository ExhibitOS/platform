import {it,expect} from 'vitest';
import {deflateSync} from 'node:zlib';
import {decode} from './imports.ts';
function crc(data:Buffer){let value=0xffffffff;for(const b of data){value^=b;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(kind:string,body:Buffer){const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);h.write(kind,4);tail.writeUInt32BE(crc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);}
function png(edge=2048,rgba=false){const h=Buffer.alloc(13);h.writeUInt32BE(edge);h.writeUInt32BE(edge,4);h[8]=8;h[9]=rgba?6:2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc((edge*(rgba?4:3)+1)*edge))),chunk('IEND',Buffer.alloc(0))]);}
function fixture(options:{edge?:number;rgba?:boolean;crc?:boolean;alias?:boolean;sampler?:number;partialSampler?:boolean}={}){
 const positions=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),normals=Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),uv=Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),indices=Buffer.from(new Uint16Array([0,1,2]).buffer),image=png(),images=[image,png(options.edge??2048,options.rgba),image];
 if(options.crc)images[1]![images[1]!.length-1]^=1;
 const parts:Buffer[]=[],views:{buffer:number;byteOffset:number;byteLength:number}[]=[];let offset=0;
 for(const data of [positions,normals,uv,indices,...images]){views.push({buffer:0,byteOffset:offset,byteLength:data.length});const padded=Buffer.alloc(Math.ceil(data.length/4)*4);data.copy(padded);parts.push(padded);offset+=padded.length;}
 const texture=(source:number)=>({source,...(options.sampler!==undefined||options.partialSampler?{sampler:0}:{})});
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{byteLength:offset}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5123,count:3,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],images:[4,5,6].map(bufferView=>({bufferView,mimeType:'image/png'})),textures:[0,1,2].map(texture),materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:.1,roughnessFactor:.8},normalTexture:{index:options.alias?0:1},occlusionTexture:{index:2}}],...(options.sampler!==undefined||options.partialSampler?{samplers:[options.partialSampler?{}:{minFilter:options.sampler}]}:{})};
 const text=Buffer.from(JSON.stringify(doc)),size=Math.ceil(text.length/4)*4,header=Buffer.alloc(20),json=Buffer.alloc(size,32),binHeader=Buffer.alloc(8);text.copy(json);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+size+offset,8);header.writeUInt32LE(size,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(offset);binHeader.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,json,binHeader,...parts]);
}
it('strict ordinary RGB role decoding preserves omitted/partial/default mip samplers',async()=>{
 for(const options of [{},{partialSampler:true},{sampler:9987}])await expect(decode(fixture(options),'model/gltf-binary')).resolves.toBeUndefined();
},30000);
it('strict ordinary resource bounds retain CRC/RGB/edge/role/sampler rejection before approval',async()=>{
 for(const options of [{crc:true},{rgba:true},{edge:2049},{alias:true},{sampler:1234}])await expect(decode(fixture(options),'model/gltf-binary')).rejects.toMatchObject({code:'FORMAT_REJECTED'});
},30000);
