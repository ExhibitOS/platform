// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '@exhibitos/storage';
import {ApiError} from './auth.ts';
import {framePreparationPair} from './frame-preparation.ts';
import {MAX_INFO_STAND_SOURCE_BYTES} from './info-stand-preparation.ts';
type WorkerHooks={onSpawn?:(child:ChildProcess)=>void;writerFd?:number};

/** Child holds the writer FD until close; timeout or unknown outcome is never
 * classified as an unsafe input and must remain retryable. */
export async function prepareFrameInWorker(source:Buffer,hooks?:WorkerHooks):Promise<Buffer>{
 const pair=framePreparationPair({bytes:source.length,sha256:sha256(source)});if(!pair)throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');
 const result=await prepareInWorker(source,pair.renderable.bytes,'FRAME_PREPARATION_UNSAFE',[],hooks);
 if(result.length!==pair.renderable.bytes||sha256(result)!==pair.renderable.sha256)throw new ApiError(422,'FRAME_PREPARATION_UNSAFE');
 return result;
}

export async function prepareInfoStandInWorker(source:Buffer,hooks?:WorkerHooks):Promise<Buffer>{
 if(source.length<28||source.length>MAX_INFO_STAND_SOURCE_BYTES)throw new ApiError(422,'INFO_STAND_PREPARATION_UNSAFE');
 const result=await prepareInWorker(source,source.length,'INFO_STAND_PREPARATION_UNSAFE',['info-stand'],hooks);
 if(result.length<28||result.length>=source.length)throw new ApiError(422,'INFO_STAND_PREPARATION_UNSAFE');
 return result;
}

async function prepareInWorker(source:Buffer,maxOutput:number,unsafeCode:string,args:string[],hooks?:WorkerHooks):Promise<Buffer>{
 if(hooks?.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 return new Promise<Buffer>((resolve,reject)=>{
  const path=new URL('./frame-preparation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe'];if(hooks?.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(path),...args],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
  let unavailable=false,size=0,errBytes=0,stderr='';const output:Buffer[]=[];
  const kill=()=>{unavailable=true;try{child.kill('SIGKILL');}catch{/* Await close. */}};
  const timer=setTimeout(kill,5000);child.once('error',()=>{unavailable=true;});
  child.stdout?.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxOutput)kill();else output.push(chunk);});
  child.stderr?.on('data',(chunk:Buffer)=>{errBytes+=chunk.length;if(errBytes>4096)kill();else stderr+=chunk.toString('utf8');});
  child.once('close',(code,signal)=>{clearTimeout(timer);if(unavailable||signal!==null){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
   if(code===1&&stderr.trim()===unsafeCode){reject(new ApiError(422,unsafeCode));return;}
   if(code!==0){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}resolve(Buffer.concat(output,size));
  });
  child.stdin?.on('error',()=>{});try{hooks?.onSpawn?.(child);}catch{kill();}child.stdin?.end(source);
 });
}
