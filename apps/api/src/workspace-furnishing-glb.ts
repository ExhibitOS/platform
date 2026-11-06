// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFile,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '@exhibitos/storage';
import type {WorkspaceFurnishingModel} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';

/** Validate exactly the declared GLB with the existing bounded product worker.
 * Only a normal worker exit can classify invalid input; unknown worker outcome
 * remains retryable and no process is considered drained before close. */
export async function validateWorkspaceFurnishingGlb(model:WorkspaceFurnishingModel,bytes:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void}):Promise<void>{
 if(!model||model.mime!=='model/gltf-binary'||!Number.isSafeInteger(model.bytes)||model.bytes<1||model.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(model.sha256)||!Buffer.isBuffer(bytes)||bytes.length!==model.bytes||sha256(bytes)!==model.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
 await new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  let callbackDone=false,closed=false,hookFailed=false,closeCode:number|null=null,output='',error:Error|null=null;
  const settle=()=>{if(!callbackDone||!closed)return;const normal=!!error&&'code'in error&&error.code===1&&!('signal'in error&&error.signal)&&!('killed'in error&&error.killed)&&closeCode===1;
   if(hookFailed)reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));else if(!error&&closeCode===0&&output==='VALID')resolve();else if(normal&&output==='FORMAT_REJECTED')reject(new ApiError(422,'FORMAT_REJECTED'));else reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));
  };
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path),'model/gltf-binary','workspace-furnishing-glb'],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(err,stdout)=>{callbackDone=true;error=err;output=stdout.trim();settle();});
  child.once('close',(code:number|null)=>{closeCode=code;closed=true;settle();});child.stdin?.on('error',()=>{});try{hooks?.onSpawn?.(child);}catch{hookFailed=true;try{child.kill('SIGKILL');}catch{/* Await actual close. */}}child.stdin?.end(bytes);
 });
}
