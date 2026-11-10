// SPDX-License-Identifier: AGPL-3.0-or-later
import {MAX_ARTWORK_THUMBNAIL_BYTES,checkedArtworkThumbnailView,type ArtworkThumbnailView} from '@exhibitos/studio-contract';
import {decode} from './imports.ts';
import {ApiError} from './auth.ts';

export interface ThumbnailCandidateInput {requestId:string;expectedRevision:number;sourceAssetId:string;sourceSha256:string;thumbnailAssetId:string;thumbnailSha256:string;expectedSelectionVersion:number;view:ArtworkThumbnailView}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const RENDERED_ARTWORK_THUMBNAIL_PROFILE='rendered-display-preview-v1';
export const RENDERED_ARTWORK_THUMBNAIL_RECIPE='artwork-glb-card-256-v1';
export const RENDERED_ARTWORK_THUMBNAIL_TOOL='exhibitos-three-0.186.1-thumbnail-v1';
/** Client pixels are authorized representatives, not proof of visual derivation. */
export function parseRenderedThumbnail(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'INVALID_INPUT');
 const v=value as Record<string,unknown>;
 const keys=['kind','requestId','expectedRevision','expectedSelectionVersion','sourceAssetId','sourceSha256','displaySha256','pngSha256','pngBase64','view'];
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.kind!==RENDERED_ARTWORK_THUMBNAIL_PROFILE||
  typeof v.requestId!=='string'||!uuid.test(v.requestId)||typeof v.sourceAssetId!=='string'||!uuid.test(v.sourceAssetId)||
  !Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<1||Number(v.expectedRevision)>2147483647||
  !Number.isSafeInteger(v.expectedSelectionVersion)||Number(v.expectedSelectionVersion)<0||Number(v.expectedSelectionVersion)>2147483647||
  [v.sourceSha256,v.displaySha256,v.pngSha256].some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||
  typeof v.pngBase64!=='string'||v.pngBase64.length>699052||!v.pngBase64.length||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.pngBase64))throw new ApiError(400,'INVALID_INPUT');
 const view=checkedArtworkThumbnailView(v.view);
 if(!view||view.kind!=='default')throw new ApiError(400,'INVALID_INPUT');
 const png=Buffer.from(v.pngBase64,'base64');
 if(png.length>MAX_ARTWORK_THUMBNAIL_BYTES||png.toString('base64')!==v.pngBase64)throw new ApiError(400,'INVALID_INPUT');
 return {requestId:v.requestId.toLowerCase(),expectedRevision:Number(v.expectedRevision),expectedSelectionVersion:Number(v.expectedSelectionVersion),
  sourceAssetId:v.sourceAssetId.toLowerCase(),sourceSha256:v.sourceSha256 as string,displaySha256:v.displaySha256 as string,pngSha256:v.pngSha256 as string,view,png};
}
/** Syntax alone grants no access: callers must bind these claims to live server authority. */
export function parseThumbnailCandidate(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'INVALID_INPUT');
 const input=value as Record<string,unknown>,keys=['requestId','expectedRevision','sourceAssetId','sourceSha256','thumbnailAssetId','thumbnailSha256','expectedSelectionVersion','view'];
 if(Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k))||typeof input.requestId!=='string'||!uuid.test(input.requestId)||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<1||Number(input.expectedRevision)>2147483647||typeof input.sourceAssetId!=='string'||!uuid.test(input.sourceAssetId)||typeof input.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceSha256)||typeof input.thumbnailAssetId!=='string'||!uuid.test(input.thumbnailAssetId)||input.thumbnailAssetId.toLowerCase()===input.sourceAssetId.toLowerCase()||typeof input.thumbnailSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.thumbnailSha256)||!Number.isSafeInteger(input.expectedSelectionVersion)||Number(input.expectedSelectionVersion)<0||Number(input.expectedSelectionVersion)>2147483647)throw new ApiError(400,'INVALID_INPUT');
 const view=checkedArtworkThumbnailView(input.view);if(!view)throw new ApiError(400,'INVALID_INPUT');
 return {requestId:input.requestId,expectedRevision:Number(input.expectedRevision),sourceAssetId:input.sourceAssetId,sourceSha256:input.sourceSha256,thumbnailAssetId:input.thumbnailAssetId,thumbnailSha256:input.thumbnailSha256,expectedSelectionVersion:Number(input.expectedSelectionVersion),view};
}

/** Admit dimensions before the isolated decoder; a header alone is never accepted. */
export async function validateThumbnailBytes(bytes:Buffer,hooks?:{onSpawn?:(child:import('node:child_process').ChildProcess)=>void}){
 try{
  if(bytes.length<33||bytes.length>MAX_ARTWORK_THUMBNAIL_BYTES||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('header');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>256||height>256)throw Error('dimensions');
  await decode(bytes,'image/png',hooks);
  return {width,height};
 }catch{throw new ApiError(422,'ARTWORK_THUMBNAIL_INVALID');}
}
