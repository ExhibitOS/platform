// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SUPPORTED_FURNISHINGS,furnishingAsset,furnishingCatalogueEntry,type FurnishingAsset,type FurnishingCatalogId} from '@exhibitos/studio-contract';
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
export async function furnishingResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,asset:FurnishingAsset,role:'model'|'notice'){
 let expected:FurnishingAsset;try{expected=furnishingAsset(asset.id,asset.catalogId);}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
 if(asset.catalogVersion!==expected.catalogVersion||asset.sha256!==expected.sha256||asset.bytes!==expected.bytes||asset.rights.notice.sha256!==expected.rights.notice.sha256||asset.rights.notice.bytes!==expected.rights.notice.bytes)throw new ApiError(409,'FURNISHING_INTEGRITY');
 const entry=furnishingCatalogueEntry(asset.catalogId),path=role==='model'?entry.path:entry.rights.noticePath,bytes=role==='model'?asset.bytes:asset.rights.notice.bytes,sha256=role==='model'?asset.sha256:asset.rights.notice.sha256;
 const row=(await c.query('SELECT resource_path,bytes,sha256,object_key FROM studio_furnishing_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND catalog_id=$3 AND catalog_version=$4 AND role=$5',[tenantId,exhibitionId,asset.catalogId,asset.catalogVersion,role])).rows[0];
 if(!row)return readFurnishingBytes(asset,role);
 if(row.resource_path!==path||Number(row.bytes)!==bytes||row.sha256!==sha256||typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/'))throw new ApiError(409,'FURNISHING_INTEGRITY');
 const data=Buffer.from(await blobs.get(row.object_key));if(data.length!==bytes||createHash('sha256').update(data).digest('hex')!==sha256)throw new ApiError(409,'FURNISHING_INTEGRITY');return data;
}
