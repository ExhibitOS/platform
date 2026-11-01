// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SUPPORTED_FURNISHINGS,freezeCanonical,furnishingAsset,furnishingCatalogueEntry,type FurnishingAsset,type FurnishingCatalogId} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
const names:Record<FurnishingCatalogId,string>={'backless-oak-bench':'등받이 없는 참나무 벤치','museum-track-spot':'전시용 트랙 스포트','gallery-open-portal':'열린 전시 통로','rectangular-plinth':'사각 전시 받침'};
export function furnishingCatalog(){return {version:1,items:Object.entries(SUPPORTED_FURNISHINGS).map(([id,hostKind])=>{
 const e=furnishingCatalogueEntry(id);return {catalogId:e.id,catalogVersion:e.version,name:names[id as FurnishingCatalogId],hostKinds:[hostKind],mime:e.mime,bytes:e.bytes,sha256:e.sha256,triangles:e.triangles,bounds:structuredClone(e.bounds),rights:{licenseId:'CC0-1.0'},functional:structuredClone(e.functional)};
})};}
/** Only compile-time catalogue paths are read. Caller-supplied roots, filenames,
 * URLs and symlink components never reach a filesystem read. */
export async function readFurnishingBytes(asset:Pick<FurnishingAsset,'id'|'catalogId'|'catalogVersion'|'bytes'|'sha256'>,role:'model'|'notice'='model'){
 let e;try{e=furnishingCatalogueEntry(asset.catalogId);const expected=furnishingAsset(asset.id,asset.catalogId);if(asset.catalogVersion!==expected.catalogVersion||asset.bytes!==expected.bytes||asset.sha256!==expected.sha256)throw Error('MISMATCH');}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
 const relative=role==='model'?e.path:e.rights.noticePath,expectedBytes=role==='model'?e.bytes:e.rights.noticeBytes,expectedHash=role==='model'?e.sha256:e.rights.noticeSha256;
 if(!['model','notice'].includes(role)||!/^assets\/furnishings\/user-authored-20261027\/[a-z-]+\/(model\.glb|LICENSE-NOTICE\.txt)$/.test(relative))throw new ApiError(404,'FURNISHING_UNAVAILABLE');
 let directory=fileURLToPath(new URL('../../../',import.meta.url));
 try{
  for(const part of relative.split('/').slice(0,-1)){directory=join(directory,part);const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('UNSAFE_SOURCE');}
  const file=await open(join(directory,relative.split('/').at(-1)!),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size!==expectedBytes)throw Error('INTEGRITY');const data=Buffer.alloc(expectedBytes+1),read=await file.read(data,0,data.length,0);if(read.bytesRead!==expectedBytes)throw Error('INTEGRITY');const bytes=data.subarray(0,expectedBytes);if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Error('INTEGRITY');return bytes;}finally{await file.close();}
 }catch{throw new ApiError(409,'FURNISHING_INTEGRITY');}
}
/** Imported bytes survive reopen/backup independently of the installed library.
 * Public UUID remapping never changes the known catalogue resource identity. */
export async function furnishingResourcePair(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,asset:FurnishingAsset):Promise<{model:Buffer;notice:Buffer}>{
 let expected:FurnishingAsset;try{expected=furnishingAsset(asset.id,asset.catalogId);}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
 if(freezeCanonical(asset)!==freezeCanonical(expected))throw new ApiError(409,'FURNISHING_INTEGRITY');
 const entry=furnishingCatalogueEntry(asset.catalogId);
 const rows=(await c.query('SELECT role,resource_path,bytes,sha256,object_key FROM studio_furnishing_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND catalog_id=$3 AND catalog_version=$4',[tenantId,exhibitionId,asset.catalogId,asset.catalogVersion])).rows;
 // A restored/imported half-pair is invalid, never a reason to mix persisted
 // and installed sources. Built-in fallback is allowed only for zero rows.
 if(!rows.length)return {model:await readFurnishingBytes(asset,'model'),notice:await readFurnishingBytes(asset,'notice')};
 if(rows.length!==2||new Set(rows.map(row=>row.role)).size!==2||rows.some(row=>row.role!=='model'&&row.role!=='notice'))throw new ApiError(409,'FURNISHING_INTEGRITY');
 const read=async(role:'model'|'notice')=>{
  const row=rows.find(row=>row.role===role),path=role==='model'?entry.path:entry.rights.noticePath,bytes=role==='model'?asset.bytes:asset.rights.notice.bytes,hash=role==='model'?asset.sha256:asset.rights.notice.sha256;
  if(!row||row.resource_path!==path||Number(row.bytes)!==bytes||row.sha256!==hash||typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/'))throw new ApiError(409,'FURNISHING_INTEGRITY');
  let data:Buffer;try{data=Buffer.from(await blobs.get(row.object_key));}catch{throw new ApiError(409,'FURNISHING_INTEGRITY');}
  if(data.length!==bytes||createHash('sha256').update(data).digest('hex')!==hash)throw new ApiError(409,'FURNISHING_INTEGRITY');return data;
 };
 return {model:await read('model'),notice:await read('notice')};
}
export async function furnishingResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,asset:FurnishingAsset,role:'model'|'notice'){
 if(role!=='model'&&role!=='notice')throw new ApiError(404,'FURNISHING_UNAVAILABLE');
 return (await furnishingResourcePair(c,blobs,tenantId,exhibitionId,asset))[role];
}
