// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const GPU_SOURCE_IDENTITY='glb-source-preservation-v1' as const;
const fail=():never=>{throw Error('GPU_SOURCE_PRESERVATION_INVALID');};
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
type Doc=Record<string,Json>;
const object=(v:Json|undefined):Doc=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Doc;};
const array=(v:Json|undefined):Json[]=>{if(!Array.isArray(v))fail();return v as Json[];};
const integer=(v:unknown):number=>{if(!Number.isSafeInteger(v)||Number(v)<0)fail();return Number(v);};
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

/** JSON.parse alone silently accepts duplicate keys, including escaped aliases. */
function strictJson(text:string):Json {
 let at=0;
 const space=()=>{while(/[\x20\t\r\n]/.test(text[at]??'!'))at++;};
 const string=():string=>{
  const start=at;if(text[at++]!=='"')fail();
  while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"'){try{return JSON.parse(text.slice(start,at)) as string;}catch{fail();}}}
  return fail();
 };
 const value=(depth:number):Json=>{
  if(depth>64)fail();space();const c=text[at];
  if(c==='"')return string();
  if(c==='{'){
   at++;space();const result:Doc={},keys=new Set<string>();
   if(text[at]==='}'){at++;return result;}
   for(;;){space();const key=string();if(keys.has(key))fail();keys.add(key);space();if(text[at++]!==':')fail();const v=value(depth+1);Object.defineProperty(result,key,{value:v,enumerable:true,writable:true,configurable:true});space();const end=text[at++];if(end==='}')return result;if(end!==',')fail();}
  }
  if(c==='['){at++;space();const result:Json[]=[];if(text[at]===']'){at++;return result;}for(;;){result.push(value(depth+1));space();const end=text[at++];if(end===']')return result;if(end!==',')fail();}}
  for(const [token,v] of [['null',null],['true',true],['false',false]] as const)if(text.startsWith(token,at)){at+=token.length;return v;}
  const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
  if(!match)fail();at+=match![0].length;const n=Number(match![0]);if(!Number.isFinite(n))fail();return n;
 };
 const result=value(0);space();if(at!==text.length)fail();return result;
}

/** Strict structural parse only; source feature/role admission remains separate. */
export function parseGpuModelSource(bytes:Buffer,maxBytes=33554432){
 if(bytes.length<28||bytes.length>maxBytes||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)fail();
 const jsonLength=bytes.readUInt32LE(12),binHeader=20+jsonLength;
 if(!jsonLength||jsonLength>8388608||jsonLength%4||bytes.readUInt32LE(16)!==0x4e4f534a||binHeader+8>bytes.length)fail();
 const binLength=bytes.readUInt32LE(binHeader);
 if(binLength%4||bytes.readUInt32LE(binHeader+4)!==0x004e4942||binHeader+8+binLength!==bytes.length)fail();
 const doc=object(strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,binHeader))));
 const buffers=array(doc.buffers);if(buffers.length!==1)fail();const buffer=object(buffers[0]);
 const declared=integer(buffer.byteLength);if(Object.hasOwn(buffer,'uri')||declared>binLength||binLength-declared>3)fail();
 return {doc,bin:bytes.subarray(binHeader+8),declared};
}

function canonical(v:Json):string {
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k]!)).join(',')+'}';
}
function digest(doc:Doc,bin:Buffer){
 const json=Buffer.from(canonical(doc)),length=(n:number)=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b;};
 return hash(Buffer.concat([Buffer.from('ExhibitOS/'+GPU_SOURCE_IDENTITY+'\0'),length(json.length),json,length(bin.length),bin]));
}
export interface GpuPreservationBinding {
 source:{sha256:string;bytes:number};candidate:{sha256:string;bytes:number};
 textureIndex:number;ktx:{sha256:string;bytes:number};
}

/** Preservation only. Caller must ALSO admit the source and validate the bounded mipped KTX profile. */
export function verifyGpuSourcePreservation(source:Buffer,candidate:Buffer,binding:GpuPreservationBinding){
 for(const [bytes,expected] of [[source,binding.source],[candidate,binding.candidate]] as const){
  if(!expected||!/^[a-f0-9]{64}$/.test(expected.sha256)||expected.bytes!==bytes.length||hash(bytes)!==expected.sha256)fail();
 }
 const a=parseGpuModelSource(source,33554432),b=parseGpuModelSource(candidate,41943040),index=integer(binding.textureIndex);
 const sourceImages=array(a.doc.images),sourceViews=array(a.doc.bufferViews),textures=array(a.doc.textures);
 const images=array(b.doc.images),views=array(b.doc.bufferViews),outTextures=array(b.doc.textures);
 if(images.length!==sourceImages.length+1||views.length!==sourceViews.length+1||outTextures.length!==textures.length||index>=textures.length)fail();
 if(sourceImages.some(x=>object(x).mimeType==='image/ktx2'))fail();
 if(a.doc.extensionsRequired!==undefined&&array(a.doc.extensionsRequired).includes('KHR_texture_basisu'))fail();
 const originalUsed=a.doc.extensionsUsed===undefined?undefined:array(a.doc.extensionsUsed);
 const expectedUsed=originalUsed===undefined?['KHR_texture_basisu']:originalUsed.includes('KHR_texture_basisu')?originalUsed:[...originalUsed,'KHR_texture_basisu'];
 if(!isDeepStrictEqual(b.doc.extensionsUsed,expectedUsed))fail();
 const sourceTexture=object(textures[index]),pngIndex=integer(sourceTexture.source);
 if(Object.hasOwn(sourceTexture,'extensions'))fail();
 if(pngIndex>=sourceImages.length||object(sourceImages[pngIndex]).mimeType!=='image/png')fail();
 if(!isDeepStrictEqual(object(outTextures[index]).extensions,{KHR_texture_basisu:{source:sourceImages.length}}))fail();
 const ktxLength=integer(binding.ktx.bytes);if(!ktxLength||ktxLength>8388608||!/^[a-f0-9]{64}$/.test(binding.ktx.sha256))fail();
 if(!isDeepStrictEqual(views.at(-1),{buffer:0,byteOffset:a.bin.length,byteLength:ktxLength})||!isDeepStrictEqual(images.at(-1),{bufferView:sourceViews.length,mimeType:'image/ktx2'}))fail();
 const end=a.bin.length+ktxLength,padded=Math.ceil(end/4)*4;
 if(b.bin.length!==padded||b.declared!==padded||!b.bin.subarray(0,a.bin.length).equals(a.bin)||b.bin.subarray(end).some(x=>x!==0))fail();
 const ktx=b.bin.subarray(a.bin.length,end);if(hash(ktx)!==binding.ktx.sha256)fail();
 const restored=structuredClone(b.doc);array(restored.images).pop();array(restored.bufferViews).pop();
 object(array(restored.buffers)[0]).byteLength=a.declared;
 delete object(array(restored.textures)[index]).extensions;
 if(a.doc.extensionsUsed===undefined)delete restored.extensionsUsed;else restored.extensionsUsed=structuredClone(a.doc.extensionsUsed);
 if(!isDeepStrictEqual(restored,a.doc))fail();
 const sourceSHA256=digest(a.doc,a.bin),outputSHA256=digest(restored,b.bin.subarray(0,a.bin.length));
 if(sourceSHA256!==outputSHA256)fail();
 return {algorithm:GPU_SOURCE_IDENTITY,sourceSHA256,outputSHA256,ktx:{sha256:binding.ktx.sha256,bytes:ktxLength,imageIndex:sourceImages.length,textureIndex:index}};
}
