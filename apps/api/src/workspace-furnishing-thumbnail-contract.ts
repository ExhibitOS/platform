// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';
export const WORKSPACE_FURNISHING_THUMBNAIL_PROFILE='workspace-furnishing-thumbnail-v1' as const;
export const FURNISHING_THUMBNAIL_RECIPE_ID='furnishing-glb-card-256-v1' as const;
export const FURNISHING_THUMBNAIL_TOOL_ID='exhibitos-three-0.186.1-thumbnail-v1' as const;
export const MAX_FURNISHING_THUMBNAIL_BYTES=512*1024;
export interface FurnishingThumbnailRenderRequest {version:1;epoch:string;sequence:number;tenantId:string;principalId:string;requestId:string;furnishingId:string;furnishingVersion:1;modelBytes:number;modelSha256:string;recipeId:typeof FURNISHING_THUMBNAIL_RECIPE_ID;toolId:typeof FURNISHING_THUMBNAIL_TOOL_ID}
export interface FurnishingThumbnailSubmit {kind:typeof WORKSPACE_FURNISHING_THUMBNAIL_PROFILE;requestId:string;renderRequest:FurnishingThumbnailRenderRequest;pngSha256:string;pngBytes:number;pngBase64:string}
export interface FurnishingThumbnailSelection {requestId:string;candidateId:string;receiptSha256:string;expectedSelectionVersion:number}
export interface FurnishingThumbnailSource {furnishingId:string;furnishingVersion:1;modelSha256:string;modelBytes:number;descriptorSha256:string;rightsSha256:string}
export interface FurnishingThumbnailPng {mime:'image/png';width:256;height:256;sha256:string;bytes:number}
export interface FurnishingThumbnailReceipt {version:1;purpose:'registered-furnishing-thumbnail';profile:typeof WORKSPACE_FURNISHING_THUMBNAIL_PROFILE;workspaceId:string;candidateId:string;requestId:string;source:FurnishingThumbnailSource;renderRequest:FurnishingThumbnailRenderRequest;png:FurnishingThumbnailPng}
const bad=():never=>{throw new ApiError(400,'INVALID_INPUT');};
const invalidPng=():never=>{throw new ApiError(422,'WORKSPACE_FURNISHING_THUMBNAIL_INVALID');};
function closed(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!d.enumerable||!Object.hasOwn(d,'value')))return bad();return value as Record<string,unknown>;
}
const id=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)?v.toLowerCase():bad();
const hash=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:bad();
const integer=(v:unknown,min:number,max:number):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:bad();
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** Canonical JSON only: no property-order authority, nonfinite values or coercion. */
export function furnishingThumbnailCanonicalHash(value:unknown):string{
 const seen=new Set<object>();const encode=(v:unknown,depth=0):string=>{
  if(depth>64)return bad();if(v===null)return 'null';if(typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);if(typeof v==='number')return Number.isFinite(v)&&!Object.is(v,-0)?JSON.stringify(v):bad();
  if(!v||typeof v!=='object'||seen.has(v))return bad();seen.add(v);let result:string;
  if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1||Object.keys(v).length!==v.length||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)||!Object.getOwnPropertyDescriptor(v,String(i))?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,String(i))!,'value')))return bad();result='['+v.map(x=>encode(x,depth+1)).join(',')+']';}
  else {const keys=Object.keys(v).sort();closed(v,keys);result='{'+keys.map(k=>JSON.stringify(k)+':'+encode((v as Record<string,unknown>)[k],depth+1)).join(',')+'}';}seen.delete(v);return result;
 };return sha(Buffer.from(encode(value)));
}
export function parseFurnishingThumbnailRenderRequest(value:unknown):FurnishingThumbnailRenderRequest{
 const v=closed(value,['version','epoch','sequence','tenantId','principalId','requestId','furnishingId','furnishingVersion','modelBytes','modelSha256','recipeId','toolId']);if(v.version!==1||v.furnishingVersion!==1||v.recipeId!==FURNISHING_THUMBNAIL_RECIPE_ID||v.toolId!==FURNISHING_THUMBNAIL_TOOL_ID)return bad();
 return {version:1,epoch:id(v.epoch),sequence:integer(v.sequence,1,Number.MAX_SAFE_INTEGER),tenantId:id(v.tenantId),principalId:id(v.principalId),requestId:id(v.requestId),furnishingId:id(v.furnishingId),furnishingVersion:1,modelBytes:integer(v.modelBytes,1,32*1024*1024),modelSha256:hash(v.modelSha256),recipeId:FURNISHING_THUMBNAIL_RECIPE_ID,toolId:FURNISHING_THUMBNAIL_TOOL_ID};
}
export function furnishingThumbnailPngDescriptor(bytes:Buffer):FurnishingThumbnailPng{
 if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>MAX_FURNISHING_THUMBNAIL_BYTES||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==256||bytes.readUInt32BE(20)!==256)return invalidPng();
 return {mime:'image/png',width:256,height:256,sha256:sha(bytes),bytes:bytes.length};
}
export function parseFurnishingThumbnailSubmit(value:unknown):FurnishingThumbnailSubmit&{png:Buffer}{
 const v=closed(value,['kind','requestId','renderRequest','pngSha256','pngBytes','pngBase64']);if(v.kind!==WORKSPACE_FURNISHING_THUMBNAIL_PROFILE)return bad();const requestId=id(v.requestId),renderRequest=parseFurnishingThumbnailRenderRequest(v.renderRequest),pngSha256=hash(v.pngSha256),pngBytes=integer(v.pngBytes,1,MAX_FURNISHING_THUMBNAIL_BYTES);
 if(requestId!==renderRequest.requestId||typeof v.pngBase64!=='string'||!v.pngBase64.length||v.pngBase64.length>Math.ceil(MAX_FURNISHING_THUMBNAIL_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.pngBase64))return bad();
 const png=Buffer.from(v.pngBase64,'base64');if(png.length>MAX_FURNISHING_THUMBNAIL_BYTES||png.toString('base64')!==v.pngBase64)return bad();const descriptor=furnishingThumbnailPngDescriptor(png);if(descriptor.bytes!==pngBytes||descriptor.sha256!==pngSha256)return invalidPng();
 return {kind:WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,requestId,renderRequest,pngSha256,pngBytes,pngBase64:v.pngBase64,png};
}
export function parseFurnishingThumbnailSelection(value:unknown):FurnishingThumbnailSelection{const v=closed(value,['requestId','candidateId','receiptSha256','expectedSelectionVersion']);return {requestId:id(v.requestId),candidateId:id(v.candidateId),receiptSha256:hash(v.receiptSha256),expectedSelectionVersion:integer(v.expectedSelectionVersion,0,2147483646)};}
export function parseFurnishingThumbnailSource(value:unknown):FurnishingThumbnailSource{const v=closed(value,['furnishingId','furnishingVersion','modelSha256','modelBytes','descriptorSha256','rightsSha256']);if(v.furnishingVersion!==1)return bad();return {furnishingId:id(v.furnishingId),furnishingVersion:1,modelSha256:hash(v.modelSha256),modelBytes:integer(v.modelBytes,1,32*1024*1024),descriptorSha256:hash(v.descriptorSha256),rightsSha256:hash(v.rightsSha256)};}
export function parseFurnishingThumbnailReceipt(value:unknown):FurnishingThumbnailReceipt{
 const v=closed(value,['version','purpose','profile','workspaceId','candidateId','requestId','source','renderRequest','png']);if(v.version!==1||v.purpose!=='registered-furnishing-thumbnail'||v.profile!==WORKSPACE_FURNISHING_THUMBNAIL_PROFILE)return bad();const source=parseFurnishingThumbnailSource(v.source),renderRequest=parseFurnishingThumbnailRenderRequest(v.renderRequest),requestId=id(v.requestId),p=closed(v.png,['mime','width','height','sha256','bytes']);if(p.mime!=='image/png'||p.width!==256||p.height!==256||requestId!==renderRequest.requestId||source.furnishingId!==renderRequest.furnishingId||source.modelSha256!==renderRequest.modelSha256||source.modelBytes!==renderRequest.modelBytes)return bad();
 return {version:1,purpose:'registered-furnishing-thumbnail',profile:WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,workspaceId:id(v.workspaceId),candidateId:id(v.candidateId),requestId,source,renderRequest,png:{mime:'image/png',width:256,height:256,sha256:hash(p.sha256),bytes:integer(p.bytes,1,MAX_FURNISHING_THUMBNAIL_BYTES)}};
}
export function createFurnishingThumbnailReceipt(input:Omit<FurnishingThumbnailReceipt,'version'|'purpose'|'profile'>):{receipt:FurnishingThumbnailReceipt;receiptSha256:string}{const v=closed(input,['workspaceId','candidateId','requestId','source','renderRequest','png']);const receipt=parseFurnishingThumbnailReceipt({version:1,purpose:'registered-furnishing-thumbnail',profile:WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,...v});return {receipt,receiptSha256:furnishingThumbnailCanonicalHash(receipt)};}
