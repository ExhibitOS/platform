// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {SUPPORTED_FURNISHINGS,freezeCanonical,furnishingAsset,furnishingCatalogueEntry,type FurnishingAsset,type FurnishingCatalogId} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
const names:Record<FurnishingCatalogId,string>={'backless-oak-bench':'등받이 없는 참나무 벤치','museum-track-spot':'전시용 트랙 스포트','museum-wallwasher':'전시용 월워셔','museum-wallwasher-rear-relief':'전시용 월워셔 (후면 수정형)','gallery-open-portal':'열린 전시 통로','rectangular-plinth':'사각 전시 받침'};
export function furnishingCatalog(){return {version:1,items:Object.entries(SUPPORTED_FURNISHINGS).map(([id,hostKind])=>{
 const e=furnishingCatalogueEntry(id);return {catalogId:e.id,catalogVersion:e.version,name:names[id as FurnishingCatalogId],hostKinds:[hostKind],mime:e.mime,bytes:e.bytes,sha256:e.sha256,triangles:e.triangles,bounds:structuredClone(e.bounds),rights:{licenseId:'CC0-1.0'},functional:structuredClone(e.functional)};
})};}
import {readFurnishingBytes} from './furnishing-assets.ts';
export {readFurnishingBytes} from './furnishing-assets.ts';
/** Imported bytes survive reopen/backup independently of the installed library.
 * Public UUID remapping never changes the known catalogue resource identity. */
export async function furnishingResourcePair(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,asset:FurnishingAsset,signal?:AbortSignal):Promise<{model:Buffer;notice:Buffer}>{
 signal?.throwIfAborted();
 let expected:FurnishingAsset;try{expected=furnishingAsset(asset.id,asset.catalogId);}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
 if(freezeCanonical(asset)!==freezeCanonical(expected))throw new ApiError(409,'FURNISHING_INTEGRITY');
 const entry=furnishingCatalogueEntry(asset.catalogId);
 const rows=(await c.query('SELECT role,resource_path,bytes,sha256,object_key FROM studio_furnishing_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND catalog_id=$3 AND catalog_version=$4',[tenantId,exhibitionId,asset.catalogId,asset.catalogVersion])).rows;
 // A restored/imported half-pair is invalid, never a reason to mix persisted
 // and installed sources. Built-in fallback is allowed only for zero rows.
 if(!rows.length)return {model:await readFurnishingBytes(asset,'model',signal),notice:await readFurnishingBytes(asset,'notice',signal)};
 if(rows.length!==2||new Set(rows.map(row=>row.role)).size!==2||rows.some(row=>row.role!=='model'&&row.role!=='notice'))throw new ApiError(409,'FURNISHING_INTEGRITY');
 const read=async(role:'model'|'notice')=>{
  const row=rows.find(row=>row.role===role),path=role==='model'?entry.path:entry.rights.noticePath,bytes=role==='model'?asset.bytes:asset.rights.notice.bytes,hash=role==='model'?asset.sha256:asset.rights.notice.sha256;
  if(!row||row.resource_path!==path||Number(row.bytes)!==bytes||row.sha256!==hash||typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/'))throw new ApiError(409,'FURNISHING_INTEGRITY');
  signal?.throwIfAborted();let data:Buffer;try{if(signal&&!blobs.getBounded)throw Error('BOUNDED_READ_UNAVAILABLE');data=Buffer.from(await (blobs.getBounded?blobs.getBounded(row.object_key,bytes,signal):blobs.get(row.object_key,signal)));}catch{throw new ApiError(409,'FURNISHING_INTEGRITY');}signal?.throwIfAborted();
  if(data.length!==bytes||createHash('sha256').update(data).digest('hex')!==hash)throw new ApiError(409,'FURNISHING_INTEGRITY');return data;
 };
 return {model:await read('model'),notice:await read('notice')};
}
export async function furnishingResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,asset:FurnishingAsset,role:'model'|'notice'){
 if(role!=='model'&&role!=='notice')throw new ApiError(404,'FURNISHING_UNAVAILABLE');
 return (await furnishingResourcePair(c,blobs,tenantId,exhibitionId,asset))[role];
}
