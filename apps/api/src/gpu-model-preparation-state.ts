// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';
import {GPU_MODEL_PREPARATION_PROFILE as PROFILE,GPU_MODEL_PREPARATION_PURPOSE as PURPOSE,GPU_MODEL_PREPARATION_RECIPE_SHA256 as RECIPE,GPU_MODEL_PREPARATION_LEGACY_RECIPE_SHA256 as LEGACY,GPU_MODEL_PREPARATION_RECIPE,parseGpuModelPreparationIntent,type GpuModelPreparationIntent} from './gpu-model-preparation-contract.ts';
import type {GpuModelProducerReceipt} from './gpu-model-producer.ts';
export interface GpuModelAsset {assetId:string;mime:'model/gltf-binary';sha256:string;bytes:number}
export interface GpuModelSource extends GpuModelAsset {approvalSHA256:string;rightsSHA256:string}
export interface GpuModelServerReceipt {
 version:1;purpose:typeof PURPOSE;profile:typeof PROFILE;recipeSHA256:typeof RECIPE;
 jobId:string;artworkId:string;artworkRevision:number;operationID:string;generation:string;
 source:GpuModelSource;candidate:GpuModelAsset;producer:GpuModelProducerReceipt;sha256:string;
}
export interface StoredGpuPreparation {kind:'gpu-model-preparation';intent:GpuModelPreparationIntent;claim?:Record<string,unknown>;executionRecipeSHA256?:typeof RECIPE;result?:GpuModelServerReceipt}
function invalid():never{throw new ApiError(409,'GPU_MODEL_PREPARATION_STATE_INVALID');}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
export const gpuModelDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const exact=(v:unknown,keys:string[]):boolean=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function storedGpuModelPreparation(row:Record<string,unknown>):StoredGpuPreparation|undefined {
 if(row.gpu_preparation==null)return undefined;const value=row.gpu_preparation as StoredGpuPreparation;
 if(!value||typeof value!=='object'||Array.isArray(value)||value.kind!=='gpu-model-preparation'||Object.keys(value).some(k=>!['kind','intent','claim','result','executionRecipeSHA256'].includes(k))||
   row.mime!=='model/gltf-binary'||row.model_preparation!=null||row.model_derivation!=null||row.derived!=null||row.original_asset_id!=null||row.png_drain_version!==1)invalid();
 const intent=parseGpuModelPreparationIntent(value.intent),r=intent.request,b=intent.binding;
 if(row.tenant_id!==b.tenantId||row.user_id!==b.principalId||row.artwork_id!==b.artworkId||row.idempotency_key!==r.idempotencyKey||row.expected_hash!==r.sha256||Number(row.expected_bytes)!==r.bytes||gpuModelDigest(row.rights)!==b.rightsSHA256)invalid();
 // The049 intent envelope remains immutable. New CREATE or explicit guarded
 // retry supplies a current execution identity; legacy metadata alone never grants current worker/receipt authority.
 if(value.executionRecipeSHA256!==undefined&&(intent.recipeSHA256!==LEGACY||value.executionRecipeSHA256!==RECIPE))invalid();
 if(intent.recipeSHA256===LEGACY&&value.executionRecipeSHA256===undefined&&
  (row.state!=='failed'||!gpuModelPreparationDrained(row)||row.lease_until!=null||value.result!==undefined))invalid();
 return {...value,intent};
}
export function gpuModelExecutionRecipe(value:StoredGpuPreparation){return value.executionRecipeSHA256??value.intent.recipeSHA256;}
export function gpuModelPreparationDrained(row:Record<string,unknown>){return row.png_drain_version===1&&row.lease_id==null&&Array.isArray(row.png_worker_tokens)&&row.png_worker_tokens.length===0&&['approved','failed','cancelled'].includes(String(row.state));}
export function gpuModelSource(intent:GpuModelPreparationIntent):GpuModelSource {
 return {assetId:intent.request.assetId,mime:'model/gltf-binary',sha256:intent.request.sha256,bytes:intent.request.bytes,approvalSHA256:intent.binding.approvalSHA256,rightsSHA256:intent.binding.rightsSHA256};
}
/** Validate receipt structure and fixed producer identity, not source authority. */
function assertProducer(p:GpuModelProducerReceipt){
 if(!exact(p,['version','tool','geometry','samplers','roles','ktx'])||p.version!==1||
  !isDeepStrictEqual(p.tool,{name:'toktx',version:'4.4.2',executableSHA256:GPU_MODEL_PREPARATION_RECIPE.encoder.sha256,librarySHA256:GPU_MODEL_PREPARATION_RECIPE.encoder.librarySHA256,recipeSHA256:RECIPE})||
  !exact(p.geometry,['algorithm','sourceSHA256','outputSHA256','triangles','vertices'])||p.geometry.algorithm!=='glb-source-preservation-v1'||!hash(p.geometry.sourceSHA256)||p.geometry.sourceSHA256!==p.geometry.outputSHA256||!Number.isSafeInteger(p.geometry.triangles)||p.geometry.triangles<1||!Number.isSafeInteger(p.geometry.vertices)||p.geometry.vertices<3||
  !exact(p.samplers,['sourceSHA256','outputSHA256','semantics'])||!hash(p.samplers.sourceSHA256)||p.samplers.sourceSHA256!==p.samplers.outputSHA256||p.samplers.semantics!=='source-preserved-implicit-repeat-mipmapped'||!Array.isArray(p.roles)||p.roles.length!==3)invalid();
 const textures=new Set<number>(),images=new Set<number>();
 for(const [i,role]of ['baseColor','normal','occlusion'].entries()){
  const r=p.roles[i];if(!r||!exact(r,['role','textureIndex','sourceImageIndex','sourceSHA256','sourceBytes','outputPngImageIndex','outputPngSHA256','outputPngBytes','width','height','colorSpace'])||r.role!==role||r.width!==512||r.height!==512||r.colorSpace!==(i===0?'srgb':'linear')||!hash(r.sourceSHA256)||r.sourceSHA256!==r.outputPngSHA256||r.sourceBytes!==r.outputPngBytes||!Number.isSafeInteger(r.sourceBytes)||r.sourceBytes<24||r.sourceBytes>8388608||!Number.isSafeInteger(r.textureIndex)||r.textureIndex<0||!Number.isSafeInteger(r.sourceImageIndex)||r.sourceImageIndex<0||r.sourceImageIndex!==r.outputPngImageIndex||textures.has(r.textureIndex)||images.has(r.sourceImageIndex))invalid();
  textures.add(r.textureIndex);images.add(r.sourceImageIndex);
 }
 if(!exact(p.ktx,['imageIndex','sha256','bytes','width','height','levels','format','transfer','opaque','levelDimensions'])||!Number.isSafeInteger(p.ktx.imageIndex)||p.ktx.imageIndex<0||images.has(p.ktx.imageIndex)||!hash(p.ktx.sha256)||!Number.isSafeInteger(p.ktx.bytes)||p.ktx.bytes<1||p.ktx.bytes>8388608||p.ktx.width!==512||p.ktx.height!==512||p.ktx.levels!==10||p.ktx.format!=='uastc'||p.ktx.transfer!=='srgb'||p.ktx.opaque!==true||!isDeepStrictEqual(p.ktx.levelDimensions,[512,256,128,64,32,16,8,4,2,1]))invalid();
}
export function createGpuModelReceipt(row:Record<string,unknown>,candidate:GpuModelAsset,producer:GpuModelProducerReceipt):GpuModelServerReceipt {
 const value=storedGpuModelPreparation(row);if(!value||gpuModelExecutionRecipe(value)!==RECIPE||!uuid(row.id)||!exact(candidate,['assetId','mime','sha256','bytes'])||!uuid(candidate.assetId)||candidate.assetId.toLowerCase()===value.intent.request.assetId.toLowerCase()||candidate.mime!=='model/gltf-binary'||!hash(candidate.sha256)||!Number.isSafeInteger(candidate.bytes)||candidate.bytes<28||candidate.bytes>33554432)invalid();
 assertProducer(producer);const {intent}=value;
 const body:Omit<GpuModelServerReceipt,'sha256'>={version:1,purpose:PURPOSE,profile:PROFILE,recipeSHA256:RECIPE,jobId:row.id as string,artworkId:intent.binding.artworkId,artworkRevision:intent.request.revision,operationID:intent.request.idempotencyKey,generation:intent.request.generation,source:gpuModelSource(intent),candidate,producer};
 return {...body,sha256:gpuModelDigest(body)};
}
export function gpuModelReceipt(row:Record<string,unknown>){
 const result=storedGpuModelPreparation(row)?.result;if(!result)invalid();
 const expected=createGpuModelReceipt(row,result.candidate,result.producer);
 if(!isDeepStrictEqual(expected,result)||row.asset_id!==result.candidate.assetId)invalid();return expected;
}
export function gpuModelJobView(row:Record<string,unknown>){
 const value=storedGpuModelPreparation(row);if(!value)invalid();const {intent}=value,workerDrained=gpuModelPreparationDrained(row),ready=row.state==='approved'&&workerDrained;
 if(!uuid(row.id)||!['queued','processing','approved','failed','cancelled'].includes(String(row.state))||!Number.isSafeInteger(row.progress)||Number(row.progress)<0||Number(row.progress)>100||!Number.isSafeInteger(row.attempts)||Number(row.attempts)<0||Number(row.attempts)>5||row.error_code!=null&&(typeof row.error_code!=='string'||!row.error_code.length)||!Number.isFinite(new Date(String(row.available_at)).getTime())||ready&&row.progress!==100)invalid();
 const status=ready?'ready':row.state==='failed'?'failed':row.state==='cancelled'?'cancelled':row.state==='queued'?'pending':'processing';
 const gpuPreparation={version:1 as const,purpose:PURPOSE,profile:PROFILE,recipeSHA256:gpuModelExecutionRecipe(value),operationID:intent.request.idempotencyKey,generation:intent.request.generation,artworkRevision:intent.request.revision,status,workerDrained,source:gpuModelSource(intent)};
 const base={id:row.id,state:row.state,progress:Number(row.progress),attempts:Number(row.attempts),errorCode:row.error_code??null,retryAt:new Date(String(row.available_at)).toISOString()};
 if(!ready)return {...base,gpuPreparation};const serverReceipt=gpuModelReceipt(row);
 return {...base,assetId:serverReceipt.candidate.assetId,gpuPreparation:{...gpuPreparation,candidate:serverReceipt.candidate,serverReceipt}};
}
