// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseStaticJson} from '../../web/src/static-json.mjs';

export const LIGHT_FIXTURE_PREPARATION_POLICY='omit-unused-invalid-tangent-r1' as const;
export interface LightFixturePreparationReceipt {
 version:1;policy:typeof LIGHT_FIXTURE_PREPARATION_POLICY;
 source:{sha256:string;bytes:number};derived:{sha256:string;bytes:number};
 removed:{mesh:number;primitive:number;accessor:number}[];binSHA256:string;
}
const fail=():never=>{throw Error('LIGHT_FIXTURE_PREPARATION_UNSAFE');};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const integer=(v:unknown,max=8388608):number=>{if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>max)return fail();return Number(v);};
const list=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)return fail();return v;};
const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
/** Feature-based preparation only, never source admission or a validation waiver.
 * Caller must preserve original custody, examine full source/derived validation
 * and issue an ordinary registered candidate before any rendering or publication.
 */
export function prepareLightFixtureSource(source:Buffer):{bytes:Buffer;receipt:LightFixturePreparationReceipt}{
 try{
  if(!Buffer.isBuffer(source)||source.length<28||source.length>8388608||source.readUInt32LE(0)!==0x46546c67||source.readUInt32LE(4)!==2||source.readUInt32LE(8)!==source.length)return fail();
  const jsonLength=integer(source.readUInt32LE(12),1048576),binHeader=20+jsonLength;
  if(!jsonLength||jsonLength%4||source.readUInt32LE(16)!==0x4e4f534a||binHeader+8>source.length)return fail();
  const binLength=source.readUInt32LE(binHeader);
  if(binLength%4||source.readUInt32LE(binHeader+4)!==0x004e4942||binHeader+8+binLength!==source.length)return fail();
  const doc=record(parseStaticJson(source.subarray(20,binHeader),1048576));
  const walk=(v:unknown,depth=0):void=>{
   if(depth>64||typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))return fail();
   if(v&&typeof v==='object')for(const [key,x]of Object.entries(v)){
    if(['uri','extensions','extensionsUsed','extensionsRequired','skins','animations','targets'].includes(key))return fail();walk(x,depth+1);
   }
  };walk(doc);
  if(record(doc.asset).version!=='2.0'||!isDeepStrictEqual(doc,JSON.parse(JSON.stringify(doc))))return fail();
  const buffers=list(doc.buffers,1);if(buffers.length!==1)return fail();const declared=integer(record(buffers[0]).byteLength);
  if(!declared||declared>binLength||binLength-declared>3)return fail();
  const bin=source.subarray(binHeader+8),views=list(doc.bufferViews,4096).map(record),accessors=list(doc.accessors,4096).map(record);
  for(const view of views){
   const offset=integer(view.byteOffset??0),length=integer(view.byteLength);
   if(view.buffer!==0||!length||offset+length>declared||view.byteStride!==undefined&&(integer(view.byteStride,252)<4||Number(view.byteStride)%4)||view.target!==undefined&&view.target!==34962&&view.target!==34963)return fail();
  }
  // Sparse layouts are not a supported preparation input, even on other roles.
  if(accessors.some(a=>Object.hasOwn(a,'sparse')))return fail();
  const materials=list(doc.materials,256).map(record),meshes=list(doc.meshes,256).map(record);
  if(!materials.length||!meshes.length)return fail();
  const removed:LightFixturePreparationReceipt['removed']=[],cache=new Map<number,boolean>();let readCount=0,primitiveCount=0;
  const invalidTangent=(index:number,position:Record<string,unknown>):boolean=>{
   const accessor=accessors[index];if(!accessor)return fail();
   if(accessor.componentType!==5126||accessor.type!=='VEC4'||accessor.normalized!==undefined&&accessor.normalized!==false||
    Object.keys(accessor).some(key=>!['bufferView','byteOffset','componentType','count','type','normalized','min','max','name','extras'].includes(key)))return fail();
   const count=integer(accessor.count,524288);if(!count||count!==position.count)return fail();
   if(cache.has(index))return cache.get(index)!;
   readCount+=count;if(readCount>524288)return fail();
   const view=views[integer(accessor.bufferView,4095)];if(!view)return fail();
   const base=integer(view.byteOffset??0),offset=integer(accessor.byteOffset??0),length=integer(view.byteLength),stride=integer(view.byteStride??16,252);
   if(base%4||offset%4||stride<16||stride%4||offset+(count-1)*stride+16>length||view.target!==undefined&&view.target!==34962)return fail();
   let invalid=false;
   for(let i=0;i<count;i++){
    const at=base+offset+i*stride,x=bin.readFloatLE(at),y=bin.readFloatLE(at+4),z=bin.readFloatLE(at+8),w=bin.readFloatLE(at+12);
    if(![x,y,z,w].every(Number.isFinite))return fail();
    // Same length tolerance as the pinned ordinary gltf-validator
    // 2.0.0-dev.3.10; do not strip merely quantized but valid unit vectors.
    if(Math.abs(Math.hypot(x,y,z)-1)>0.00674||(w!==1&&w!==-1))invalid=true;
   }
   cache.set(index,invalid);return invalid;
  };
  for(const [mi,mesh]of meshes.entries())for(const [pi,raw]of list(mesh.primitives,4096).entries()){
   if(++primitiveCount>4096)return fail();const primitive=record(raw);
   if(primitive.mode!==undefined&&primitive.mode!==4)return fail();
   const attributes=record(primitive.attributes);if(!Object.hasOwn(attributes,'TANGENT'))continue;
   const material=materials[integer(primitive.material,255)];if(!material||Object.hasOwn(material,'normalTexture'))return fail();
   const position=accessors[integer(attributes.POSITION,4095)],normal=accessors[integer(attributes.NORMAL,4095)];
   if(!position||!normal||position.type!=='VEC3'||normal.type!=='VEC3'||position.componentType!==5126||normal.componentType!==5126||normal.count!==position.count)return fail();
   const accessor=integer(attributes.TANGENT,4095);
   if(invalidTangent(accessor,position)){delete attributes.TANGENT;removed.push({mesh:mi,primitive:pi,accessor});}
  }
  if(!removed.length)return fail();
  const json=Buffer.from(JSON.stringify(doc));if(json.length>1048576)return fail();
  const padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
  const total=20+padded.length+8+binLength;if(total>8388608)return fail();
  const header=Buffer.from(source.subarray(0,20));header.writeUInt32LE(total,8);header.writeUInt32LE(padded.length,12);
  // Retain the complete BIN chunk header, all declared data and original padding.
  const bytes=Buffer.concat([header,padded,source.subarray(binHeader)]);
  return {bytes,receipt:{version:1,policy:LIGHT_FIXTURE_PREPARATION_POLICY,source:{sha256:hash(source),bytes:source.length},derived:{sha256:hash(bytes),bytes:bytes.length},removed,binSHA256:hash(bin)}};
 }catch{return fail();}
}
