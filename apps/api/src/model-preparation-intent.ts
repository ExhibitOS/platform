import {validDisplayReference,preparedDisplayReference,type ProvisionalDisplayReference} from './model-preparation-display-reference.ts';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import {COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,modelPreparationHash,type CompactModelReceipt} from './oam-original-preparation.ts';
export interface ModelPreparationIntent {version:1;profileId:typeof COMPACT_MODEL_RECIPE.id;operationID:string;generation:string;artworkRevision:number;sourceFull?:{assetId:string;approvalSHA256:string};sourceDisplayReference?:ProvisionalDisplayReference}
const token={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'};
export const MODEL_PREPARATION_SCHEMA={type:'object',additionalProperties:false,required:['version','profileId','operationID','generation','artworkRevision'],properties:{version:{const:1},profileId:{const:COMPACT_MODEL_RECIPE.id},operationID:token,generation:token,artworkRevision:{type:'integer',minimum:1,maximum:2147483647},sourceFull:{type:'object',additionalProperties:false,required:['assetId','approvalSHA256'],properties:{assetId:{type:'string',format:'uuid'},approvalSHA256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}};
export function modelPreparationIntent(value:unknown):ModelPreparationIntent|undefined {
 if(value===undefined)return undefined;
 const fail=():never=>{throw new ApiError(400,'INVALID_MODEL_PREPARATION');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const v=value as Record<string,unknown>,keys=MODEL_PREPARATION_SCHEMA.required;
 if(Object.keys(v).length!==keys.length+(Object.hasOwn(v,'sourceFull')?1:0)+(Object.hasOwn(v,'sourceDisplayReference')?1:0)||keys.some(k=>!Object.hasOwn(v,k))||v.version!==1||v.profileId!==COMPACT_MODEL_RECIPE.id||!['operationID','generation'].every(k=>typeof v[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v[k]))||!Number.isSafeInteger(v.artworkRevision)||Number(v.artworkRevision)<1||Number(v.artworkRevision)>2147483647)fail();
 if(v.sourceFull!==undefined){const f=v.sourceFull as Record<string,unknown>;if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).sort().join(',')!=='approvalSHA256,assetId'||typeof f.assetId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(f.assetId)||typeof f.approvalSHA256!=='string'||!/^[a-f0-9]{64}$/.test(f.approvalSHA256))fail();}
 if(Object.hasOwn(v,'sourceDisplayReference')&&(!validDisplayReference(v.sourceDisplayReference)||v.sourceFull!==undefined))fail();
 return value as ModelPreparationIntent;
}
export function canonicalModelValue(value:unknown):unknown{return Array.isArray(value)?value.map(canonicalModelValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,canonicalModelValue(v)])):value;}
export const modelReceiptDigest=(value:unknown)=>modelPreparationHash(Buffer.from(JSON.stringify(canonicalModelValue(value))));
export interface ModelPreparationAsset {assetId:string;mime:'model/gltf-binary';sha256:string;bytes:number}
export interface ModelPreparationServerReceipt {version:1;profileId:typeof COMPACT_MODEL_RECIPE.id;recipeSHA256:string;jobId:string;artworkId:string;artworkRevision:number;operationID:string;generation:string;rightsSHA256:string;original:ModelPreparationAsset;display:ModelPreparationAsset&{reusedOriginal:boolean};producer:CompactModelReceipt;displayReference?:ProvisionalDisplayReference;sha256:string}
export function storedModelPreparation(row:Record<string,unknown>):ModelPreparationIntent|undefined {
 if(row.model_preparation==null)return undefined;
 const v=row.model_preparation as {kind?:unknown;request?:unknown;result?:unknown};
 if(!v||typeof v!=='object'||Array.isArray(v)||v.kind!=='required-model-compact'||Object.keys(v).some(k=>!['kind','request','result','claim'].includes(k))||row.mime!=='model/gltf-binary'||row.derived!=null||row.model_derivation!=null||row.png_drain_version!==1)throw new ApiError(422,'MODEL_PREPARATION_STATE_INVALID');
 return modelPreparationIntent(v.request)??(()=>{throw new ApiError(422,'MODEL_PREPARATION_STATE_INVALID');})();
}
export function modelPreparationDrained(row:Record<string,unknown>){return row.png_drain_version===1&&row.lease_id==null&&Array.isArray(row.png_worker_tokens)&&row.png_worker_tokens.length===0&&['approved','failed','cancelled'].includes(String(row.state));}
export function createModelPreparationReceipt(row:Record<string,unknown>,originalAssetId:string,displayAssetId:string,producer:CompactModelReceipt):ModelPreparationServerReceipt {
 const intent=storedModelPreparation(row);if(!intent||intent.sourceFull)throw new ApiError(409,'MODEL_PREPARATION_STATE_INVALID');
 const original:ModelPreparationAsset={assetId:originalAssetId,mime:'model/gltf-binary',sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)},display={assetId:displayAssetId,mime:'model/gltf-binary' as const,sha256:producer.output.sha256,bytes:producer.output.bytes,reusedOriginal:producer.output.reusedOriginal};
 if(producer.source.sha256!==original.sha256||producer.source.bytes!==original.bytes||producer.recipeSHA256!==COMPACT_MODEL_RECIPE_SHA256||producer.recipeId!==intent.profileId||display.reusedOriginal&&(original.assetId!==display.assetId||original.sha256!==display.sha256||original.bytes!==display.bytes)||!display.reusedOriginal&&original.assetId===display.assetId)throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');
 const body={version:1 as const,profileId:intent.profileId,recipeSHA256:producer.recipeSHA256,jobId:String(row.id),artworkId:String(row.artwork_id),artworkRevision:intent.artworkRevision,operationID:intent.operationID,generation:intent.generation,rightsSHA256:modelReceiptDigest(row.rights),original,display,producer,...(intent.sourceDisplayReference?{displayReference:preparedDisplayReference(intent.sourceDisplayReference,producer)}:{})};return {...body,sha256:modelReceiptDigest(body)};
}
export function modelPreparationReceipt(row:Record<string,unknown>):ModelPreparationServerReceipt {
 const value=(row.model_preparation as {result?:ModelPreparationServerReceipt}|null)?.result;
 if(!value||typeof value!=='object')throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');
 let expected:ModelPreparationServerReceipt;try{expected=createModelPreparationReceipt(row,String(row.original_asset_id??row.asset_id),String(row.asset_id),value.producer);}catch{throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');}
 if(!isDeepStrictEqual(value,expected)||value.display.assetId!==row.asset_id||value.original.assetId!==(row.original_asset_id??row.asset_id))throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');return expected;
}
export function modelPreparationView(row:Record<string,unknown>){
 const intent=storedModelPreparation(row);if(!intent)return undefined;if(intent.sourceFull)return compactVariantView(row);const workerDrained=modelPreparationDrained(row),ready=row.state==='approved'&&workerDrained;
 const status=ready?'ready':row.state==='failed'?'failed':row.state==='cancelled'?'cancelled':['processing','approved'].includes(String(row.state))?'processing':'pending';
 const base={...intent,required:true as const,status,workerDrained,original:{mime:'model/gltf-binary' as const,sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)}};
 if(!ready)return base;const serverReceipt=modelPreparationReceipt(row);return {...base,original:serverReceipt.original,display:serverReceipt.display,serverReceipt};
}

export interface CompactVariantReceipt {
 version:1;purpose:'approved-full-compact';profileId:typeof COMPACT_MODEL_RECIPE.id;publicationProfile:'exhibitos-budget-geometry-pair-v1';recipeSHA256:string;
 jobId:string;artworkId:string;artworkRevision:number;operationID:string;generation:string;rightsSHA256:string;approvalSHA256:string;
 sourceFull:ModelPreparationAsset;coarse:ModelPreparationAsset;producer:CompactModelReceipt;sha256:string;
}
export function createCompactVariantReceipt(row:Record<string,unknown>,coarseAssetId:string,producer:CompactModelReceipt):CompactVariantReceipt {
 const request=storedModelPreparation(row),source=request?.sourceFull;
 if(!request||!source||producer.recipeId!==COMPACT_MODEL_RECIPE.id||producer.recipeSHA256!==COMPACT_MODEL_RECIPE_SHA256||producer.source.sha256!==row.expected_hash||producer.source.bytes!==Number(row.expected_bytes)||producer.output.reusedOriginal||source.assetId===coarseAssetId)throw new ApiError(409,'COMPACT_VARIANT_RECEIPT_INVALID');
 const body={version:1 as const,purpose:'approved-full-compact' as const,profileId:request.profileId,publicationProfile:'exhibitos-budget-geometry-pair-v1' as const,recipeSHA256:producer.recipeSHA256,jobId:String(row.id),artworkId:String(row.artwork_id),artworkRevision:request.artworkRevision,operationID:request.operationID,generation:request.generation,rightsSHA256:modelReceiptDigest(row.rights),approvalSHA256:source.approvalSHA256,sourceFull:{assetId:source.assetId,mime:'model/gltf-binary' as const,sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)},coarse:{assetId:coarseAssetId,mime:'model/gltf-binary' as const,sha256:producer.output.sha256,bytes:producer.output.bytes},producer};
 return {...body,sha256:modelReceiptDigest(body)};
}
export function compactVariantReceipt(row:Record<string,unknown>):CompactVariantReceipt {
 const actual=(row.model_preparation as {result?:CompactVariantReceipt}|null)?.result;
 if(!actual?.producer||row.original_asset_id!==storedModelPreparation(row)?.sourceFull?.assetId)throw new ApiError(409,'COMPACT_VARIANT_RECEIPT_INVALID');
 const expected=createCompactVariantReceipt(row,String(row.asset_id),actual.producer);
 if(!isDeepStrictEqual(actual,expected))throw new ApiError(409,'COMPACT_VARIANT_RECEIPT_INVALID');return expected;
}
function compactVariantView(row:Record<string,unknown>){
 const request=storedModelPreparation(row)!,workerDrained=modelPreparationDrained(row),ready=row.state==='approved'&&workerDrained;
 const status=ready?'ready':row.state==='failed'?'failed':row.state==='cancelled'?'cancelled':['processing','approved'].includes(String(row.state))?'processing':'pending';
 const base={...request,purpose:'approved-full-compact' as const,required:true as const,status,workerDrained,sourceFull:{assetId:request.sourceFull!.assetId,mime:'model/gltf-binary' as const,sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)}};
 if(!ready)return base;const serverReceipt=compactVariantReceipt(row);return {...base,coarse:serverReceipt.coarse,serverReceipt};
}
