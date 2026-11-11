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
export async function readFurnishingBytes(asset:Pick<FurnishingAsset,'id'|'catalogId'|'catalogVersion'|'bytes'|'sha256'>,role:'model'|'notice'='model',signal?:AbortSignal){
 let e;try{e=furnishingCatalogueEntry(asset.catalogId);const expected=furnishingAsset(asset.id,asset.catalogId);if(asset.catalogVersion!==expected.catalogVersion||asset.bytes!==expected.bytes||asset.sha256!==expected.sha256)throw Error('MISMATCH');}catch{throw new ApiError(404,'FURNISHING_UNAVAILABLE');}
 if(role!=='model'&&role!=='notice')throw new ApiError(404,'FURNISHING_UNAVAILABLE');
 return readInstalledFurnishing(
  role==='model'?e.path:e.rights.noticePath,
  role==='model'?e.bytes:e.rights.noticeBytes,
  role==='model'?e.sha256:e.rights.noticeSha256,
  signal,
 );
}
/** Read only a caller-pinned packaged path. A missing optional asset is not corruption. */
export function readInstalledFurnishing(relative:string,expectedBytes:number,expectedHash:string,signal?:AbortSignal):Promise<Buffer>;
export function readInstalledFurnishing(relative:string,expectedBytes:number,expectedHash:string,signal:AbortSignal|undefined,optional:true):Promise<Buffer|undefined>;
export async function readInstalledFurnishing(relative:string,expectedBytes:number,expectedHash:string,signal?:AbortSignal,optional=false):Promise<Buffer|undefined>{
 if(!/^assets\/furnishings\/(?:user-authored-20261027\/[a-z-]+|exhibitos-authored-20261111\/museum-wallwasher(?:-rear-relief)?)\/(model\.glb|LICENSE-NOTICE\.txt)$/.test(relative))throw new ApiError(404,'FURNISHING_UNAVAILABLE');
 let directory=fileURLToPath(new URL('../../../',import.meta.url));
 try{
  for(const part of relative.split('/').slice(0,-1)){signal?.throwIfAborted();directory=join(directory,part);const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('UNSAFE_SOURCE');}
  const file=await open(join(directory,relative.split('/').at(-1)!),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{signal?.throwIfAborted();const stat=await file.stat();if(!stat.isFile()||stat.size!==expectedBytes)throw Error('INTEGRITY');const data=Buffer.alloc(expectedBytes+1),stream=file.createReadStream({start:0,end:expectedBytes,autoClose:false,...(signal?{signal}:{})});let length=0;for await(const chunk of stream){const bytes=Buffer.from(chunk);if(length+bytes.length>data.length)throw Error('INTEGRITY');bytes.copy(data,length);length+=bytes.length;}signal?.throwIfAborted();if(length!==expectedBytes)throw Error('INTEGRITY');const bytes=data.subarray(0,expectedBytes);if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Error('INTEGRITY');return bytes;}finally{await file.close();}
 }catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new ApiError(409,'FURNISHING_INTEGRITY');}
}
