// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ApiError} from './auth.ts';
import {NEAR_TEXTURE_PAIR_PROFILE} from '@exhibitos/studio-contract';
export const MODEL_SETTINGS_SHA256='da9039b67435883255f723fd3b37b0fc395ba2acce3ab26706aeaa17d90f73bf';
export const MODEL_TOOL_VERSION='public-near-texture-v1';
export interface ModelDerivation {version:1;profileId:typeof NEAR_TEXTURE_PAIR_PROFILE;settingsSha256:typeof MODEL_SETTINGS_SHA256;toolVersion:typeof MODEL_TOOL_VERSION;operationID:string;generation:string;artworkRevision:number}
const token={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'};
export const MODEL_DERIVATION_SCHEMA={type:'object',additionalProperties:false,required:['version','profileId','settingsSha256','toolVersion','operationID','generation','artworkRevision'],properties:{version:{const:1},profileId:{const:NEAR_TEXTURE_PAIR_PROFILE},settingsSha256:{const:MODEL_SETTINGS_SHA256},toolVersion:{const:MODEL_TOOL_VERSION},operationID:token,generation:token,artworkRevision:{type:'integer',minimum:1,maximum:2147483647}}};
export function modelDerivationInput(value:unknown):ModelDerivation|undefined {
 if(value===undefined)return undefined;
 const fail=():never=>{throw new ApiError(400,'INVALID_MODEL_DERIVATION');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const v=value as Record<string,unknown>,keys=MODEL_DERIVATION_SCHEMA.required;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.version!==1||v.profileId!==NEAR_TEXTURE_PAIR_PROFILE||v.settingsSha256!==MODEL_SETTINGS_SHA256||v.toolVersion!==MODEL_TOOL_VERSION||!['operationID','generation'].every(k=>typeof v[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v[k]))||!Number.isSafeInteger(v.artworkRevision)||Number(v.artworkRevision)<1||Number(v.artworkRevision)>2147483647)fail();
 return value as ModelDerivation;
}
export interface ModelPairResult {bytes:Buffer;receipt:{version:1;toolName:'ExhibitOS validation-worker';toolVersion:typeof MODEL_TOOL_VERSION;profileId:typeof NEAR_TEXTURE_PAIR_PROFILE;binding:ModelDerivation&{sourceSha256:string};full:{sha256:string;bytes:number;reusedExactBytes:true;triangles:number;textureSize:number};reduced:{sha256:string;bytes:number;triangles:number;textureSize:number}}}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** Existing bounded worker and its close callback own actual execution. The
 * caller may cancel publication immediately, but must await this promise before
 * acknowledging drain or replacing the owned operation. */
export function prepareModelPair(source:Buffer,request:ModelDerivation):Promise<ModelPairResult>{
 const plan=modelDerivationInput(request)!;
 if(source.length<28||source.length>33554432)return Promise.reject(new ApiError(422,'MODEL_DERIVATIVE_UNSUPPORTED'));
 const binding={...plan,sourceSha256:hash(source)},url=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))url.pathname=url.pathname.replace(/\.js$/,'.ts');
 return new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(url),'model/gltf-binary','texture-pair',JSON.stringify(binding)],{timeout:8000,maxBuffer:33554432+65544,encoding:'buffer',env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,out)=>{
   try{
    if(error||out.length<8||out.toString('ascii',0,4)!=='ETEX')throw Error('MODEL_DERIVATIVE_UNSUPPORTED');
    const length=out.readUInt32LE(4);if(length>65536||8+length>=out.length)throw Error('MODEL_DERIVATIVE_UNSUPPORTED');
    const receipt=JSON.parse(out.toString('utf8',8,8+length)) as ModelPairResult['receipt'],bytes=out.subarray(8+length);
    if(receipt.version!==1||receipt.toolName!=='ExhibitOS validation-worker'||receipt.toolVersion!==MODEL_TOOL_VERSION||receipt.profileId!==NEAR_TEXTURE_PAIR_PROFILE||JSON.stringify(receipt.binding)!==JSON.stringify(binding)||receipt.full.sha256!==binding.sourceSha256||receipt.full.bytes!==source.length||receipt.full.reusedExactBytes!==true||receipt.reduced.sha256!==hash(bytes)||receipt.reduced.bytes!==bytes.length||bytes.length>33554432)throw Error('MODEL_DERIVATIVE_UNSUPPORTED');
    resolve({bytes,receipt});
   }catch{reject(new ApiError(422,'MODEL_DERIVATIVE_UNSUPPORTED'));}
  });child.stdin?.on('error',()=>{});child.stdin?.end(source);
 });
}
