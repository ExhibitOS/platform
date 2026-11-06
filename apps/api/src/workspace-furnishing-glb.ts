// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '@exhibitos/storage';
import type {WorkspaceFurnishingModel} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';

/** Validate exactly the declared GLB with the existing bounded product worker.
 * Only a normal worker exit can classify invalid input; unknown worker outcome
 * remains retryable and no process is considered drained before close. */
export async function validateWorkspaceFurnishingGlb(model:WorkspaceFurnishingModel,bytes:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void;writerFd?:number}):Promise<void>{
 if(!model||model.mime!=='model/gltf-binary'||!Number.isSafeInteger(model.bytes)||model.bytes<1||model.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(model.sha256)||!Buffer.isBuffer(bytes)||bytes.length!==model.bytes||sha256(bytes)!==model.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
 if(hooks?.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 await new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  let unavailable=false,output='',outBytes=0,errBytes=0;
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe'];if(hooks?.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(path),'model/gltf-binary','workspace-furnishing-glb'],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
  const kill=()=>{unavailable=true;try{child.kill('SIGKILL');}catch{/* Await actual close. */}};
  const timer=setTimeout(kill,5000);child.once('error',()=>{unavailable=true;});
  child.stdout?.on('data',(part:Buffer)=>{outBytes+=part.length;if(outBytes>4096)kill();else output+=part.toString('utf8');});
  child.stderr?.on('data',(part:Buffer)=>{errBytes+=part.length;if(errBytes>4096)kill();});
  child.once('close',(code:number|null,signal:NodeJS.Signals|null)=>{clearTimeout(timer);const text=output.trim();if(!unavailable&&signal===null&&code===0&&text==='VALID')resolve();else if(!unavailable&&signal===null&&code===1&&text==='FORMAT_REJECTED')reject(new ApiError(422,'FORMAT_REJECTED'));else reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));});
  child.stdin?.on('error',()=>{});try{hooks?.onSpawn?.(child);}catch{kill();}child.stdin?.end(bytes);
 });
}
