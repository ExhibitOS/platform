// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ApiError} from './api-error.ts';
import {furnishingThumbnailPngDescriptor} from './workspace-furnishing-thumbnail-contract.ts';
export interface FurnishingThumbnailValidationHooks {writerFd?:number;onSpawn?:(child:ChildProcess)=>void;signal?:AbortSignal}
/** Decode existing PNG bytes in the ordinary bounded validator; no rendering or
 * authority is inferred. A kill/error never earns drainage before actual close. */
export async function validateFurnishingThumbnailPng(bytes:Buffer,hooks:FurnishingThumbnailValidationHooks={}):Promise<void>{
 furnishingThumbnailPngDescriptor(bytes);if(hooks.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');if(hooks.signal?.aborted)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 return new Promise((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');const stdio:('pipe'|number)[]=['pipe','pipe','pipe'];if(hooks.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(path),'image/png','workspace-furnishing-thumbnail-v1'],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
  let unavailable=false,out='',outBytes=0,errBytes=0;const kill=()=>{unavailable=true;try{child.kill('SIGKILL');}catch{/* Await close. */}};const timer=setTimeout(kill,5000);hooks.signal?.addEventListener('abort',kill,{once:true});child.once('error',()=>{unavailable=true;});
  child.stdout?.on('data',(part:Buffer)=>{outBytes+=part.length;if(outBytes>4096)kill();else out+=part.toString('utf8');});child.stderr?.on('data',(part:Buffer)=>{errBytes+=part.length;if(errBytes>4096)kill();});
  child.once('close',(code:number|null,signal:NodeJS.Signals|null)=>{clearTimeout(timer);hooks.signal?.removeEventListener('abort',kill);if(!unavailable&&signal===null&&errBytes===0){if(code===0&&out.trim()==='VALID'){resolve();return;}if(code===1&&out.trim()==='FORMAT_REJECTED'){reject(new ApiError(422,'WORKSPACE_FURNISHING_THUMBNAIL_INVALID'));return;}}reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));});
  child.stdin?.on('error',kill);try{hooks.onSpawn?.(child);if(hooks.signal?.aborted)kill();child.stdin?.end(bytes);}catch{kill();}
 });
}
