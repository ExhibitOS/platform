// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {sha256} from '@exhibitos/storage';
import {FLOOR_RESOURCE_PACKS,FLOOR_RESOURCE_FILES,floorResourceNotice,type FloorResourceEntry} from '@exhibitos/spec/floor-resources';
import {ApiError} from './auth.ts';
/** Only a catalogue file can be read. No caller path, provider URL or arbitrary
 * filesystem root is accepted. Existing web dist is already in both runtimes. */
export async function floorResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,entry:FloorResourceEntry){
 const known=FLOOR_RESOURCE_FILES.find(f=>f.packId===entry.packId&&f.packVersion===entry.packVersion&&f.role===entry.role);
 if(!known||Object.keys(entry).length!==Object.keys(known).length||Object.entries(known).some(([key,value])=>entry[key as keyof FloorResourceEntry]!==value))throw new ApiError(422,'FLOOR_RESOURCE_DESCRIPTOR');
 const row=(await c.query('SELECT object_key,bytes,sha256,resource_path FROM studio_floor_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND pack_id=$3 AND pack_version=$4 AND role=$5',[tenantId,exhibitionId,entry.packId,entry.packVersion,entry.role])).rows[0];
 let bytes:Buffer;
 if(row){
  if(typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/')||row.sha256!==entry.sha256||Number(row.bytes)!==entry.bytes||row.resource_path!==entry.artifactPath)throw new ApiError(409,'ASSET_INTEGRITY');
  bytes=Buffer.from(await blobs.get(row.object_key));
 }else if(entry.role==='notice'){
  const pack=FLOOR_RESOURCE_PACKS.find(p=>p.id===entry.packId)!;bytes=Buffer.from(floorResourceNotice(pack),'utf8');
 }else{
  let path=fileURLToPath(new URL('../../web/dist/',import.meta.url));
  for(const part of entry.artifactPath.split('/').slice(0,-1)){const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw new ApiError(409,'FLOOR_RESOURCE_UNAVAILABLE');path=join(path,part);}
  const directory=await lstat(path);if(directory.isSymbolicLink()||!directory.isDirectory())throw new ApiError(409,'FLOOR_RESOURCE_UNAVAILABLE');
  const file=await open(join(path,entry.artifactPath.split('/').at(-1)!),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size!==entry.bytes)throw new ApiError(409,'ASSET_INTEGRITY');bytes=await file.readFile();}finally{await file.close();}
 }
 if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new ApiError(409,'ASSET_INTEGRITY');return bytes;
}
