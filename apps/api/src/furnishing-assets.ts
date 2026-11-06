// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {furnishingAsset,furnishingCatalogueEntry,type FurnishingAsset} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
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
