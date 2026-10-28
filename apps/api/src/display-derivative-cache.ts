// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {normalizeDisplayWatermark,embeddedWatermarkTextSupported,type DisplayWatermark} from '@exhibitos/studio-contract';
import {derivative,type DerivativeOptions} from './derivative.ts';
import {ApiError} from './auth.ts';
export interface DisplayDerivativeCache {client:PoolClient;blobs:BlobStore;tenantId:string;assetId:string;sourceSha256:string}
/** Current approval/rights are checked by the caller on every use. Cache identity
 * grants neither access nor an exception to source/byte integrity. */
export async function cachedDisplayDerivative(original:Buffer,mime:string,options:DerivativeOptions={},cache?:DisplayDerivativeCache){
 if(!cache)return derivative(original,mime,options);
 if(sha256(original)!==cache.sourceSha256)throw new ApiError(409,'ASSET_INTEGRITY');
 let watermark:DisplayWatermark=normalizeDisplayWatermark(options.watermark);
 if(mime==='model/gltf-binary'||watermark.mode!=='embedded')watermark={version:1,mode:'none'};
 else{
  const label=watermark.text??'EXHIBITOS';
  if(!embeddedWatermarkTextSupported(label))throw new ApiError(422,'WATERMARK_TEXT_UNSUPPORTED');
  watermark={...watermark,text:label.toUpperCase()};
 }
 const recipe={version:2,mime,quality:{maxTextureSize:options.maxTextureSize??512},watermark},recipeSha256=sha256(Buffer.from(JSON.stringify(recipe)));
 const identity=createHash('sha256').update(`${cache.tenantId}:${cache.assetId}:${cache.sourceSha256}:${recipeSha256}`).digest('hex'),id=`${identity.slice(0,8)}-${identity.slice(8,12)}-4${identity.slice(13,16)}-8${identity.slice(17,20)}-${identity.slice(20,32)}`;
 const prefix=`${cache.tenantId}/derivatives/${cache.sourceSha256}-display-v2/${recipeSha256}/`;
 const row=(await cache.client.query('SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 AND deleted_at IS NULL',[cache.tenantId,id,cache.assetId])).rows[0],known=row?.metadata;
 if(known?.kind==='display-v2'&&known.sourceSha256===cache.sourceSha256&&known.recipeSha256===recipeSha256&&known.mime===mime&&typeof known.sha256==='string'&&/^[a-f0-9]{64}$/.test(known.sha256)&&known.objectKey===prefix+known.sha256&&Number.isSafeInteger(known.bytes)&&known.bytes>0&&known.bytes<=33554432){
  const bytes=Buffer.from(await cache.blobs.get(known.objectKey));
  if(bytes.length!==known.bytes||sha256(bytes)!==known.sha256)throw new ApiError(409,'DERIVATIVE_INTEGRITY');
  return bytes;
 }
 const bytes=await derivative(original,mime,{...options,watermark}),hash=sha256(bytes),key=prefix+hash;
 await cache.blobs.put(key,bytes);
 await cache.client.query('INSERT INTO asset_derivatives(tenant_id,id,metadata,asset_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,id) DO NOTHING',[cache.tenantId,id,{kind:'display-v2',objectKey:key,sha256:hash,mime,bytes:bytes.length,watermarked:watermark.mode==='embedded',policy:'display',sourceSha256:cache.sourceSha256,recipeSha256,recipe},cache.assetId]);
 return bytes;
}
