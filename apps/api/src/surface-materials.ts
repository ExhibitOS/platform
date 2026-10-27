// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {SURFACE_MATERIAL_PACKS,SURFACE_MATERIAL_FILES,surfaceMaterialNotice,type SurfaceMaterialResourceEntry} from '@exhibitos/spec/surface-material-resources';
import {surfaceTextureDefaults,type SurfaceTexturePackId} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';
const names:Record<SurfaceTexturePackId,string>={'museum-matte-paint':'무광 페인트','fine-lime-plaster':'고운 석회 미장'};
export function surfaceMaterialCatalog(){return {version:1,items:SURFACE_MATERIAL_PACKS.map(pack=>({id:pack.id,version:pack.version,name:names[pack.id],defaults:surfaceTextureDefaults(pack.id),preview:null}))};}
/** Selected compiled descriptors only; no caller URL, filename or root. Imported
 * resources survive reopen/export independently of installed library contents. */
export async function surfaceMaterialResourceBytes(c:PoolClient,blobs:BlobStore,tenantId:string,exhibitionId:string,entry:SurfaceMaterialResourceEntry){
 const known=SURFACE_MATERIAL_FILES.find(f=>f.packId===entry.packId&&f.packVersion===entry.packVersion&&f.role===entry.role);
 if(!known||Object.keys(entry).length!==Object.keys(known).length||Object.entries(known).some(([key,value])=>entry[key as keyof SurfaceMaterialResourceEntry]!==value))throw new ApiError(422,'SURFACE_MATERIAL_DESCRIPTOR');
 const row=(await c.query('SELECT object_key,bytes,sha256,resource_path FROM studio_surface_material_resources WHERE tenant_id=$1 AND exhibition_id=$2 AND pack_id=$3 AND pack_version=$4 AND role=$5',[tenantId,exhibitionId,entry.packId,entry.packVersion,entry.role])).rows[0];let bytes:Buffer;
 if(row){
  if(typeof row.object_key!=='string'||!row.object_key.startsWith(tenantId+'/')||row.sha256!==entry.sha256||Number(row.bytes)!==entry.bytes||row.resource_path!==entry.artifactPath)throw new ApiError(409,'SURFACE_MATERIAL_INTEGRITY');
  bytes=Buffer.from(await blobs.get(row.object_key));
 }else if(entry.role==='notice')bytes=Buffer.from(surfaceMaterialNotice(SURFACE_MATERIAL_PACKS.find(p=>p.id===entry.packId)!));
 else{
  let path=fileURLToPath(new URL('../../web/dist/',import.meta.url));
  try{
   for(const part of entry.artifactPath.split('/').slice(0,-1)){const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('UNSAFE_DIRECTORY');path=join(path,part);}
   const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('UNSAFE_DIRECTORY');
   const file=await open(join(path,entry.artifactPath.split('/').at(-1)!),constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const info=await file.stat();if(!info.isFile()||info.size!==entry.bytes)throw Error('SIZE');const data=Buffer.alloc(entry.bytes+1),read=await file.read(data,0,data.length,0);if(read.bytesRead!==entry.bytes)throw Error('SIZE');bytes=data.subarray(0,entry.bytes);}finally{await file.close();}
  }catch{throw new ApiError(409,'SURFACE_MATERIAL_UNAVAILABLE');}
 }
 if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new ApiError(409,'SURFACE_MATERIAL_INTEGRITY');return bytes;
}
