// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';

export const GPU_MODEL_PREPARATION_PROFILE='embedded-model-basecolor-uastc-512-mips-v1';
export const GPU_MODEL_PREPARATION_PURPOSE='approved-display-gpu-derivative';

function immutable<T>(value:T):T {
 if(value&&typeof value==='object'){for(const item of Object.values(value))immutable(item);Object.freeze(value);}
 return value;
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 return JSON.stringify(value);
}

/** A producer recipe, not a capability or an assertion of encoder readiness. */
export const GPU_MODEL_PREPARATION_VENDOR_RECIPE=immutable({
 consumer:{formats:['astc-4x4','bc7'],otherwise:'core-png-before-parse',reservation:'conservative-no-discount'},
 encoder:{librarySHA256:'bd26f0747b7a800384b7b3c9221dafeb3943ef565a560ab98238cade597c0947',name:'toktx',
  options:['--t2','--encode','uastc','--uastc_quality','2','--threads','1','--assign_oetf','srgb','--assign_primaries','bt709','--genmipmap','--filter','lanczos4','--fscale','1','--wmode','wrap','--nometadata'],
  platform:'darwin-arm64',sha256:'708e94078c8b8a8096f3573e2899bf08fbcf702d92bbbac47bd2098a1aaa6eb6',version:'4.4.2'},
 input:{baseColor:{height:512,opaque:true,transfer:'srgb',width:512},geometry:'unchanged',maxBytes:33554432,mime:'model/gltf-binary',
  roleSet:['baseColor','normal','occlusion'],sampler:'source-preserved-implicit-repeat-mipmapped'},
 output:{baseColorFallback:'byte-identical-png',dimensions:[512,256,128,64,32,16,8,4,2,1],extension:'KHR_texture_basisu',geometry:'unchanged',
  levels:10,normal:'byte-identical-png',occlusion:'byte-identical-png',required:false,samplers:'unchanged'},
 profile:GPU_MODEL_PREPARATION_PROFILE,purpose:GPU_MODEL_PREPARATION_PURPOSE,version:1,
} as const);
// Historical vendor input remains immutable; never use its pins for the signed source build.
export const GPU_MODEL_PREPARATION_VENDOR_RECIPE_SHA256='6739a173b5a3af38f3fb02b250a2fa4d3315972f62ea8592f1c5695ab5848d98';
export const GPU_MODEL_PREPARATION_RECIPE=immutable({
 ...GPU_MODEL_PREPARATION_VENDOR_RECIPE,version:2,
 encoder:{...GPU_MODEL_PREPARATION_VENDOR_RECIPE.encoder,
  sha256:'4ec0c7fa5f123e91f8e2adb21c1b94e7119a0f396f11cc8fd747459b2a51620c',bytes:993520,
  librarySHA256:'e2f8115a77cf2c1e375210d3687f487a4e54f0cde803060cb1c4085427f3d393',libraryBytes:2454960,
  build:'source-noetc-v1',sourceCommit:'4d6fc70eaf62ad0558e63e8d97eb9766118327a6',etcUnpack:false,
  runtimePrefix:'platform/tools/ktx-4.4.2-noetc',signingTeam:'W563ZQD9G6'},
} as const);
export const GPU_MODEL_PREPARATION_RECIPE_JSON=canonical(GPU_MODEL_PREPARATION_RECIPE);
export const GPU_MODEL_PREPARATION_RECIPE_SHA256='886e3815a386a46462e46d35ccb640498ebefcc853cefba61f76560b62cae4bc';

export interface GpuModelPreparationInput {
 revision:number;assetId:string;sha256:string;bytes:number;idempotencyKey:string;generation:string;profile:typeof GPU_MODEL_PREPARATION_PROFILE;
}
/** Resolved by the authenticated transaction, never accepted from a client. */
export interface GpuModelPreparationBinding {
 tenantId:string;principalId:string;artworkId:string;approvalSHA256:string;rightsSHA256:string;
}
export interface GpuModelPreparationIntent {
 version:1;purpose:typeof GPU_MODEL_PREPARATION_PURPOSE;recipeSHA256:typeof GPU_MODEL_PREPARATION_RECIPE_SHA256;
 request:Readonly<GpuModelPreparationInput>;binding:Readonly<GpuModelPreparationBinding>;
}
type Fail=()=>never;
const invalidInput:Fail=()=>{throw new ApiError(400,'INVALID_GPU_MODEL_PREPARATION');};
const invalidIntent:Fail=()=>{throw new ApiError(409,'GPU_MODEL_PREPARATION_INTENT_INVALID');};
const inputKeys=['revision','assetId','sha256','bytes','idempotencyKey','generation','profile'];
const bindingKeys=['tenantId','principalId','artworkId','approvalSHA256','rightsSHA256'];
function record(value:unknown,keys:readonly string[],fail:Fail):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return fail();
 const names=Reflect.ownKeys(value);
 if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)))return fail();
 for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return fail();}
 return value as Record<string,unknown>;
}
function uuid(value:unknown,fail:Fail):string {
 if(typeof value!=='string'||value.length!==36||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return fail();
 return value.toLowerCase();
}
function digest(value:unknown,fail:Fail):string {
 if(typeof value!=='string'||value.length!==64||!/^[a-f0-9]{64}$/.test(value))return fail();return value;
}
function token(value:unknown,fail:Fail):string {
 if(typeof value!=='string'||value.length<1||value.length>128||!/^[A-Za-z0-9]/.test(value)||/[^A-Za-z0-9._-]/.test(value))return fail();return value;
}
function input(value:unknown,fail:Fail):Readonly<GpuModelPreparationInput> {
 const v=record(value,inputKeys,fail);
 if(v.profile!==GPU_MODEL_PREPARATION_PROFILE||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||Number(v.revision)>2147483647||
  !Number.isSafeInteger(v.bytes)||Number(v.bytes)<28||Number(v.bytes)>GPU_MODEL_PREPARATION_RECIPE.input.maxBytes)return fail();
 return Object.freeze({revision:v.revision as number,assetId:uuid(v.assetId,fail),sha256:digest(v.sha256,fail),bytes:v.bytes as number,
  idempotencyKey:token(v.idempotencyKey,fail),generation:token(v.generation,fail),profile:GPU_MODEL_PREPARATION_PROFILE});
}
function binding(value:unknown,fail:Fail):Readonly<GpuModelPreparationBinding> {
 const v=record(value,bindingKeys,fail);
 return Object.freeze({tenantId:uuid(v.tenantId,fail),principalId:uuid(v.principalId,fail),artworkId:uuid(v.artworkId,fail),
  approvalSHA256:digest(v.approvalSHA256,fail),rightsSHA256:digest(v.rightsSHA256,fail)});
}

/** Only the explicit seven-field GPU branch calls this parser. */
export function parseGpuModelPreparationInput(value:unknown):Readonly<GpuModelPreparationInput>{return input(value,invalidInput);}

/** Binds a checked request to server-resolved source authority. The caller still
 * owns authentication, source validation, locking and idempotency persistence. */
export function bindGpuModelPreparationIntent(request:unknown,serverBinding:unknown):Readonly<GpuModelPreparationIntent>{
 return Object.freeze({version:1,purpose:GPU_MODEL_PREPARATION_PURPOSE,recipeSHA256:GPU_MODEL_PREPARATION_RECIPE_SHA256,
  request:input(request,invalidInput),binding:binding(serverBinding,invalidIntent)});
}
export function parseGpuModelPreparationIntent(value:unknown):Readonly<GpuModelPreparationIntent>{
 const v=record(value,['version','purpose','recipeSHA256','request','binding'],invalidIntent);
 if(v.version!==1||v.purpose!==GPU_MODEL_PREPARATION_PURPOSE||v.recipeSHA256!==GPU_MODEL_PREPARATION_RECIPE_SHA256)return invalidIntent();
 return Object.freeze({version:1,purpose:GPU_MODEL_PREPARATION_PURPOSE,recipeSHA256:GPU_MODEL_PREPARATION_RECIPE_SHA256,
  request:input(v.request,invalidIntent),binding:binding(v.binding,invalidIntent)});
}
/** Compare durable, canonical intent digests for the same tenant/key. Tokens and
 * lowercase source digests are preserved exactly; only UUID case is normalized. */
export function gpuModelPreparationIntentSHA256(value:unknown):string {
 return createHash('sha256').update(canonical(parseGpuModelPreparationIntent(value)),'utf8').digest('hex');
}
