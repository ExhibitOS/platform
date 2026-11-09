// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ModelPreparationWriter} from './model-preparation-import.ts';
import {ApiError} from './api-error.ts';
import {freshImageIntent,type FreshImageIntent} from './fresh-image-intent.ts';
import {FRESH_IMAGE_RECIPE_SHA256,PRODUCT_IMAGE_PROFILE,PRODUCT_IMAGE_RECIPE_SHA256,PRODUCT_IMAGE_RECIPE,PRODUCT_IMAGE_LIMITS,imageHash,validProductFullDimensions,type ProductImageProducerReceipt,type ImageMetric} from './product-image-preparation.ts';
export interface ProductImageIntent {version:1;profile:typeof PRODUCT_IMAGE_PROFILE;artworkRevision:number}
export const PRODUCT_IMAGE_INTENT_SCHEMA={type:'object',additionalProperties:false,required:['version','profile','artworkRevision'],properties:{version:{const:1},profile:{const:PRODUCT_IMAGE_PROFILE},artworkRevision:{type:'integer',minimum:1,maximum:2147483646}}};
export const canonicalImageHash=(value:unknown):string=>{const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;return imageHash(sort(value) as object);};
export interface ProductImageReceipt<Mime extends 'image/jpeg'|'image/png'='image/jpeg'> {version:1;jobId:string;artworkId:string;artworkRevision:number;workspaceId:string;principalId:string;rightsSHA256:string;original:{assetId:string;sha256:string;bytes:number;mime:Mime};full:ImageMetric&{assetId:string;mime:'image/png'};coarse?:ImageMetric&{assetId:string;mime:'image/png'};producer:ProductImageProducerReceipt<Mime>;sha256:string}
export interface ProductImageState {kind:'product-image-pair';request:ProductImageIntent;workspaceId:string;principalId:string;result?:ProductImageReceipt}
export interface FreshImageState {
 kind:'fresh-product-image';
 request:FreshImageIntent;
 workspaceId:string;
 principalId:string;
 result?:ProductImageReceipt<'image/jpeg'|'image/png'>;
 claim?:{token:string}&ModelPreparationWriter['identity'];
}
export const isProductImageIntent=(v:unknown)=>!!v&&typeof v==='object'&&(v as {profile?:unknown}).profile===PRODUCT_IMAGE_PROFILE;
export function productImageIntent(value:unknown):ProductImageIntent{
 const v=value as ProductImageIntent;if(!v||Object.keys(v).sort().join(',')!=='artworkRevision,profile,version'||v.version!==1||v.profile!==PRODUCT_IMAGE_PROFILE||!Number.isSafeInteger(v.artworkRevision)||v.artworkRevision<1||v.artworkRevision>=2147483647)throw new ApiError(400,'IMAGE_PREPARATION_INTENT_INVALID');return {...v};
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function storedPreparedImage(row:Record<string,unknown>):ProductImageState|FreshImageState|undefined{
 const value=row.derived as ProductImageState|FreshImageState|null;
 if(!value||(value.kind!=='product-image-pair'&&value.kind!=='fresh-product-image'))return undefined;
 const fresh=value.kind==='fresh-product-image',claim=fresh?value.claim:undefined;
 const fail=():never=>{throw new ApiError(409,'IMAGE_PREPARATION_STATE_INVALID');};
 if(Object.keys(value).sort().join(',')!==(value.result?'kind,principalId,request,result,workspaceId':claim?'claim,kind,principalId,request,workspaceId':'kind,principalId,request,workspaceId')||(row.mime!=='image/jpeg'&&(!fresh||row.mime!=='image/png'))||row.model_derivation!=null||row.model_preparation!=null||row.png_drain_version!==1||value.principalId!==row.user_id||!uuid(value.principalId)||!uuid(value.workspaceId)||typeof row.tenant_id!=='string'||typeof row.id!=='string'||row.object_key!==`${row.tenant_id}/quarantine/import-${row.id}/${row.expected_hash}`||row.derived_object_key!==`${row.tenant_id}/quarantine/import-${row.id}/product-full`)fail();
 try{if(fresh)freshImageIntent(value.request);else productImageIntent(value.request);}catch{fail();}if(Buffer.byteLength(JSON.stringify(value))>4096)fail();
 if(claim&&(!['processing','failed','cancelled'].includes(String(row.state))||!uuid(claim.token)||!uuid(claim.runtimeGeneration)||
    claim.workspaceId!==value.workspaceId||claim.tenantId!==row.tenant_id||claim.principalId!==value.principalId||
    !Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length!==1||row.png_worker_tokens[0]!==claim.token||
    (row.state==='processing'?row.lease_id!==claim.token:row.lease_id!=null&&row.lease_id!==claim.token)))fail();
 if(row.state==='approved'&&!value.result||row.state!=='approved'&&value.result)fail();return value;
}
export function storedProductImage(row:Record<string,unknown>):ProductImageState|undefined{
 const state=storedPreparedImage(row);
 return state?.kind==='product-image-pair'?state:undefined;
}
export const productImageDrained=(row:Record<string,unknown>)=>row.png_drain_version===1&&row.lease_id==null&&Array.isArray(row.png_worker_tokens)&&row.png_worker_tokens.length===0;
export function preparedImageReceipt(row:Record<string,unknown>):ProductImageReceipt<'image/jpeg'|'image/png'>{
 const state=storedPreparedImage(row),r=state?.result;const bad=():never=>{throw new ApiError(409,'IMAGE_PREPARATION_RECEIPT_INVALID');};if(!state||!r||!r.original||!r.full)bad();
 const receipt=r!,{sha256:digest,...body}=receipt,p=receipt.producer;
 if(canonicalImageHash(body)!==digest||receipt.version!==1||receipt.jobId!==row.id||receipt.artworkId!==row.artwork_id||receipt.artworkRevision!==state!.request.artworkRevision||receipt.workspaceId!==state!.workspaceId||receipt.principalId!==row.user_id||receipt.rightsSHA256!==canonicalImageHash(row.rights)||!p||p.version!==1||p.recipeSHA256!==(state!.kind==='fresh-product-image'?FRESH_IMAGE_RECIPE_SHA256:PRODUCT_IMAGE_RECIPE_SHA256)||p.decoder!==PRODUCT_IMAGE_RECIPE.decoder||receipt.original.assetId!==row.original_asset_id||receipt.full.assetId!==row.asset_id||!uuid(receipt.original.assetId)||!uuid(receipt.full.assetId)||receipt.original.assetId===receipt.full.assetId||receipt.original.mime!==row.mime||receipt.original.sha256!==row.expected_hash||receipt.original.bytes!==Number(row.expected_bytes)||p.source?.sha256!==row.expected_hash||p.source.bytes!==Number(row.expected_bytes)||p.source.mime!==row.mime||row.approved_key!==`${row.tenant_id}/approved/${receipt.full.sha256}`)bad();
 const dimensions=(m:ImageMetric,edge:number)=>m&&/^[a-f0-9]{64}$/.test(m.sha256)&&Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=PRODUCT_IMAGE_LIMITS.outputBytes&&Number.isSafeInteger(m.width)&&Number.isSafeInteger(m.height)&&m.width>0&&m.height>0&&Math.max(m.width,m.height)<=edge;
 const projection=(m:ImageMetric)=>({sha256:m.sha256,bytes:m.bytes,width:m.width,height:m.height});
 if(!p.full||!dimensions(receipt.full,2048)||receipt.full.mime!=='image/png'||canonicalImageHash(p.full)!==canonicalImageHash(projection(receipt.full)))bad();
 const source=p.source;if(source.mime==='image/png'&&source.iccSHA256!==null||!Number.isSafeInteger(source.width)||!Number.isSafeInteger(source.height)||source.width<1||source.height<1||Math.max(source.width,source.height)>PRODUCT_IMAGE_LIMITS.edge||source.width*source.height>PRODUCT_IMAGE_LIMITS.pixels||source.iccSHA256!==null&&!/^[a-f0-9]{64}$/.test(source.iccSHA256))bad();
 if(!validProductFullDimensions(source,receipt.full))bad();
 const low=Math.min(1,512/Math.max(receipt.full.width,receipt.full.height));if(receipt.coarse||p.coarse){const c=receipt.coarse;if(low===1||!c||!p.coarse||c.bytes>=receipt.full.bytes||!uuid(c.assetId)||[receipt.original.assetId,receipt.full.assetId].includes(c.assetId)||c.mime!=='image/png'||!dimensions(c,512)||canonicalImageHash(p.coarse)!==canonicalImageHash(projection(c))||c.width!==Math.max(1,Math.round(receipt.full.width*low))||c.height!==Math.max(1,Math.round(receipt.full.height*low)))bad();}
 return receipt;
}
export function productImageReceipt(row:Record<string,unknown>):ProductImageReceipt{
 const receipt=preparedImageReceipt(row);
 if(!storedProductImage(row)||receipt.original.mime!=='image/jpeg')throw new ApiError(409,'IMAGE_PREPARATION_RECEIPT_INVALID');
 return receipt as ProductImageReceipt;
}
export function productImageView(row:Record<string,unknown>){const state=storedPreparedImage(row);if(!state)return undefined;const receipt=state.result?preparedImageReceipt(row):undefined,drained=productImageDrained(row);return {provenance:'server-generated' as const,profile:state.request.profile,artworkRevision:state.request.artworkRevision,status:receipt&&drained?'ready':['failed','cancelled'].includes(String(row.state))?'failed':'pending',workerDrained:drained&&['approved','failed','cancelled'].includes(String(row.state)),...(receipt&&drained?{original:receipt.original,full:receipt.full,...(receipt.coarse?{coarse:receipt.coarse}:{}),serverReceipt:receipt}:{})};}
