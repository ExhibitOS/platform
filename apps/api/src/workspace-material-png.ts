// SPDX-License-Identifier: AGPL-3.0-or-later
import {sha256} from '@exhibitos/storage';
import {ApiError} from './auth.ts';
import {decode} from './imports.ts';

export type WorkspaceMaterialMapRole='color'|'normal'|'roughness'|'ao';
export interface WorkspaceMaterialMapDescriptor {
 mime:'image/png';bytes:number;sha256:string;width:number;height:number;
 colorSpace:'srgb'|'linear';normalY?:'up';
}
/** Validate one declared map without changing its source bytes. Workspace
 * authorization, rights, idempotency and durable registration are separate. */
export async function validateWorkspaceMaterialPng(role:WorkspaceMaterialMapRole,descriptor:WorkspaceMaterialMapDescriptor,bytes:Buffer):Promise<void>{
 if(!['color','normal','roughness','ao'].includes(role)||!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor)||Object.keys(descriptor).sort().join(',')!==(role==='normal'?'bytes,colorSpace,height,mime,normalY,sha256,width':'bytes,colorSpace,height,mime,sha256,width')||descriptor.mime!=='image/png'||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||!Number.isSafeInteger(descriptor.width)||!Number.isSafeInteger(descriptor.height)||descriptor.width<1||descriptor.height<1||descriptor.width>8192||descriptor.height>8192||descriptor.colorSpace!==(role==='color'?'srgb':'linear')||(role==='normal'?descriptor.normalY!=='up':descriptor.normalY!==undefined))throw new ApiError(400,'MATERIAL_MAP_DESCRIPTOR');
 if(descriptor.width*descriptor.height>4*1024*1024)throw new ApiError(422,'PNG_PIXEL_LIMIT_EXCEEDED');
 if(!Buffer.isBuffer(bytes)||bytes.length!==descriptor.bytes||sha256(bytes)!==descriptor.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
 // Existing subprocess waits for actual worker close before resolving; all CRC,
 // metadata, zlib and scanline checks remain in the existing PNG profile.
 await decode(bytes,'image/png',{classifyPngPixelLimit:true});
 if(bytes.readUInt32BE(16)!==descriptor.width||bytes.readUInt32BE(20)!==descriptor.height)throw new ApiError(422,'MATERIAL_MAP_DIMENSIONS');
 if(role!=='color'){
  // Existing decoder has already checked every chunk boundary and CRC.
  for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);if(kind==='sRGB')throw new ApiError(422,'MATERIAL_MAP_COLOR_SPACE');offset+=12+size;}
 }
}
