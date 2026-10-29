// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {FOOTSTEP_SAMPLES,FOOTSTEP_NOTICES,type FootstepResource} from '@exhibitos/spec/footstep-resources';
import {ApiError} from './auth.ts';

/** Imported bytes take precedence; the fixed shipped registry is the only fallback. */
export async function footstepResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,entry:FootstepResource){
 const known=[...FOOTSTEP_SAMPLES,...FOOTSTEP_NOTICES].find(x=>x.artifactPath===entry.artifactPath);
 if(!known||Object.keys(entry).length!==Object.keys(known).length||Object.entries(known).some(([k,v])=>entry[k as keyof FootstepResource]!==v))throw new ApiError(422,'FOOTSTEP_RESOURCE_DESCRIPTOR');
 const row=(await c.query('SELECT object_key,bytes,sha256,resource_path FROM studio_footstep_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND resource_path=$3',[tenantId,exhibitionId,entry.artifactPath])).rows[0];
 let bytes:Buffer;
 if(row){
  if(typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/')||row.sha256!==entry.sha256||Number(row.bytes)!==entry.bytes||row.resource_path!==entry.artifactPath)throw new ApiError(409,'ASSET_INTEGRITY');
  bytes=Buffer.from(await blobs.get(row.object_key));
 }else{
  let path=fileURLToPath(new URL('../../web/dist/',import.meta.url));
  for(const part of entry.artifactPath.split('/').slice(0,-1)){const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw new ApiError(409,'FOOTSTEP_RESOURCE_UNAVAILABLE');path=join(path,part);}
  const directory=await lstat(path);if(directory.isSymbolicLink()||!directory.isDirectory())throw new ApiError(409,'FOOTSTEP_RESOURCE_UNAVAILABLE');
  const file=await open(join(path,entry.artifactPath.split('/').at(-1)!),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size!==entry.bytes)throw new ApiError(409,'ASSET_INTEGRITY');bytes=await file.readFile();}finally{await file.close();}
 }
 if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new ApiError(409,'ASSET_INTEGRITY');return bytes;
}
