// SPDX-License-Identifier: AGPL-3.0-or-later
import {sha256} from '@exhibitos/storage';
import {ApiError} from './auth.ts';
import {execFile,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Dedicated worker protocol: only explicit format/pixel tokens with a normal
 * exit classify input; killed, timed-out or failed workers remain retryable. */
export function decodeWorkspaceMaterialPng(bytes:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void}){
 return new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  let callbackDone=false,closed=false,hookFailed=false,closeCode:number|null=null,output='',error:Error|null=null;
  const settle=()=>{if(!callbackDone||!closed)return;const normal=!!error&&'code'in error&&error.code===1&&!('signal'in error&&error.signal)&&!('killed'in error&&error.killed)&&closeCode===1;
   if(hookFailed)reject(new ApiError(503,'MATERIAL_VALIDATION_UNAVAILABLE'));
   else if(!error&&closeCode===0&&output==='VALID')resolve();
   else if(normal&&output==='FORMAT_REJECTED')reject(new ApiError(422,'FORMAT_REJECTED'));
   else if(normal&&output==='PNG_PIXEL_LIMIT_EXCEEDED')reject(new ApiError(422,'PNG_PIXEL_LIMIT_EXCEEDED'));
   else reject(new ApiError(503,'MATERIAL_VALIDATION_UNAVAILABLE'));
  };
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path),'image/png','workspace-material-png'],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(err,stdout)=>{callbackDone=true;error=err;output=stdout.trim();settle();});
  child.once('close',(code:number|null)=>{closeCode=code;closed=true;settle();});child.stdin?.on('error',()=>{});try{hooks?.onSpawn?.(child);}catch{hookFailed=true;try{child.kill('SIGKILL');}catch{/* Still wait for callback and close. */}}child.stdin?.end(bytes);
 });
}
export type WorkspaceMaterialMapRole='color'|'normal'|'roughness'|'ao';
export interface WorkspaceMaterialMapDescriptor {
 mime:'image/png';bytes:number;sha256:string;width:number;height:number;
 colorSpace:'srgb'|'linear';normalY?:'up';
}
/** Validate one declared map without changing its source bytes. Workspace
 * authorization, rights, idempotency and durable registration are separate. */
export async function validateWorkspaceMaterialPng(role:WorkspaceMaterialMapRole,descriptor:WorkspaceMaterialMapDescriptor,bytes:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void}):Promise<void>{
 if(!['color','normal','roughness','ao'].includes(role)||!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor)||Object.keys(descriptor).sort().join(',')!==(role==='normal'?'bytes,colorSpace,height,mime,normalY,sha256,width':'bytes,colorSpace,height,mime,sha256,width')||descriptor.mime!=='image/png'||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||!Number.isSafeInteger(descriptor.width)||!Number.isSafeInteger(descriptor.height)||descriptor.width<1||descriptor.height<1||descriptor.width>8192||descriptor.height>8192||descriptor.colorSpace!==(role==='color'?'srgb':'linear')||(role==='normal'?descriptor.normalY!=='up':descriptor.normalY!==undefined))throw new ApiError(400,'MATERIAL_MAP_DESCRIPTOR');
 if(descriptor.width*descriptor.height>4*1024*1024)throw new ApiError(422,'PNG_PIXEL_LIMIT_EXCEEDED');
 if(!Buffer.isBuffer(bytes)||bytes.length!==descriptor.bytes||sha256(bytes)!==descriptor.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
 // Existing subprocess waits for actual worker close before resolving; all CRC,
 // metadata, zlib and scanline checks remain in the existing PNG profile.
 await decodeWorkspaceMaterialPng(bytes,hooks);
 if(bytes.readUInt32BE(16)!==descriptor.width||bytes.readUInt32BE(20)!==descriptor.height)throw new ApiError(422,'MATERIAL_MAP_DIMENSIONS');
 if(role!=='color'){
  // Existing decoder has already checked every chunk boundary and CRC.
  for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);if(kind==='sRGB')throw new ApiError(422,'MATERIAL_MAP_COLOR_SPACE');offset+=12+size;}
 }
}
