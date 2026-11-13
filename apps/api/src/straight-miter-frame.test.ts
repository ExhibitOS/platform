// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {sha256} from '@exhibitos/storage';
import {expect,it} from 'vitest';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
type Doc={accessors:{bufferView:number;byteOffset?:number;count:number;componentType:number;type:string;min?:number[];max?:number[]}[];bufferViews:{byteOffset?:number;byteStride?:number;byteLength:number}[];meshes:{primitives:{attributes:Record<string,number>;indices:number}[]}[];materials:{name?:string}[]};
const original=()=>readFile(new URL('../test-fixtures/thin-brass-frame/model.glb',import.meta.url));
const declaration=(bytes:Buffer)=>({mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:sha256(bytes)});
function variant(bytes:Buffer,mutate:(doc:Doc,bin:Buffer)=>void){
 const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.toString('utf8',20,20+size)) as Doc,bin=Buffer.from(bytes.subarray(28+size));mutate(doc,bin);
 const a=doc.accessors[doc.meshes[0]!.primitives[0]!.attributes.POSITION!]!,v=doc.bufferViews[a.bufferView]!,offset=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??12;
 const axis=(j:number)=>Array.from({length:a.count},(_,i)=>bin.readFloatLE(offset+i*stride+j*4));a.min=[0,1,2].map(j=>Math.min(...axis(j)));a.max=[0,1,2].map(j=>Math.max(...axis(j)));
 const json=Buffer.from(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4,header=Buffer.alloc(20),body=Buffer.alloc(jsonLength,32),binHeader=Buffer.alloc(8);json.copy(body);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonLength+bin.length,8);header.writeUInt32LE(jsonLength,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,body,binHeader,bin]);
}
it('qualifies unchanged original eight-level geometry with original attributes/material/UV intact',async()=>{
 const bytes=await original(),before=Buffer.from(bytes);expect(sha256(bytes)).toBe('4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4');
 await expect(validateWorkspaceFurnishingGlb(declaration(bytes),bytes,{},'straight-miter-ring-v1')).resolves.toEqual({profile:'straight-miter-ring-v1',openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012});expect(bytes).toEqual(before);
 await expect(validateWorkspaceFurnishingGlb(declaration(bytes),bytes,{},'straight-ring-v1')).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});
},15000);
it('qualifies a compatible section at another opening without filename, material-name or hash admission',async()=>{
 const bytes=variant(await original(),(doc,bin)=>{doc.materials[0]!.name='Other constant finish';const a=doc.accessors[doc.meshes[0]!.primitives[0]!.attributes.POSITION!]!,v=doc.bufferViews[a.bufferView]!,offset=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??12;for(let i=0;i<a.count;i++)for(const j of [0,1]){const p=offset+i*stride+j*4,x=bin.readFloatLE(p);bin.writeFloatLE(x+Math.sign(x)*.1,p);}});
 expect(sha256(bytes)).not.toBe('4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4');
 await expect(validateWorkspaceFurnishingGlb(declaration(bytes),bytes,{},'straight-miter-ring-v1')).resolves.toEqual({profile:'straight-miter-ring-v1',openingWidth:.8,openingHeight:1,imagePlaneZ:-.012});
},15000);
it('rejects changed section corners or winding even when the GLB container remains valid',async()=>{
 for(const mutate of [(doc:Doc,bin:Buffer)=>{const a=doc.accessors[doc.meshes[0]!.primitives[0]!.attributes.POSITION!]!,v=doc.bufferViews[a.bufferView]!,p=(v.byteOffset??0)+(a.byteOffset??0);bin.writeFloatLE(bin.readFloatLE(p)+.0001,p);},(doc:Doc,bin:Buffer)=>{const a=doc.accessors[doc.meshes[0]!.primitives[0]!.indices]!,v=doc.bufferViews[a.bufferView]!,p=(v.byteOffset??0)+(a.byteOffset??0);expect(a.componentType).toBe(5123);const first=bin.readUInt16LE(p);bin.writeUInt16LE(bin.readUInt16LE(p+2),p);bin.writeUInt16LE(first,p+2);}]){
  const bytes=variant(await original(),mutate);await expect(validateWorkspaceFurnishingGlb(declaration(bytes),bytes,{},'straight-miter-ring-v1')).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});
 }
},15000);
