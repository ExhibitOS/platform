// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '@exhibitos/storage';
import {ApiError} from './auth.ts';
import {framePreparationPair} from './frame-preparation.ts';

/** Child holds the writer FD until close; timeout or unknown outcome is never
 * classified as an unsafe input and must remain retryable. */
export async function prepareFrameInWorker(source:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void;writerFd?:number}):Promise<Buffer>{
 const pair=framePreparationPair({bytes:source.length,sha256:sha256(source)});if(!pair)throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');
 if(hooks?.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 return new Promise<Buffer>((resolve,reject)=>{
  const path=new URL('./frame-preparation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe'];if(hooks?.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(path)],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
  let unavailable=false,size=0,errBytes=0,stderr='';const output:Buffer[]=[];
  const kill=()=>{unavailable=true;try{child.kill('SIGKILL');}catch{/* Await close. */}};
  const timer=setTimeout(kill,5000);child.once('error',()=>{unavailable=true;});
  child.stdout?.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>pair.renderable.bytes)kill();else output.push(chunk);});
  child.stderr?.on('data',(chunk:Buffer)=>{errBytes+=chunk.length;if(errBytes>4096)kill();else stderr+=chunk.toString('utf8');});
  child.once('close',(code,signal)=>{clearTimeout(timer);if(unavailable||signal!==null){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
   if(code===1&&stderr.trim()==='FRAME_PREPARATION_UNSAFE'){reject(new ApiError(422,'FRAME_PREPARATION_UNSAFE'));return;}
   if(code!==0){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}const result=Buffer.concat(output,size);if(size!==pair.renderable.bytes||sha256(result)!==pair.renderable.sha256){reject(new ApiError(422,'FRAME_PREPARATION_UNSAFE'));return;}resolve(result);
  });
  child.stdin?.on('error',()=>{});try{hooks?.onSpawn?.(child);}catch{kill();}child.stdin?.end(source);
 });
}
