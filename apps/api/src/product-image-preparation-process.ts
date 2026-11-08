// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ApiError} from './api-error.ts';
import {imageHash,PRODUCT_IMAGE_LIMITS,validateProductImageOutput,type ProductImageOutput} from './product-image-preparation.ts';
type Hooks={writerFd?:number;signal?:AbortSignal;onSpawn?:(child:ChildProcess,stage:'prepare')=>void};
export type ProductImageWorkerResult=ProductImageOutput&{resourceUsage:{peakRssKiB:number;cpuMicros:number};workerDrained:true};
const cancelled=()=>new ApiError(409,'IMAGE_PREPARATION_CANCELLED');
/** Never returns before actual producer close. FD4 holds the issued writer;
 * FD3 parent-death channel terminates a stranded child. */
export async function prepareProductImageInWorker(source:Buffer,identity:{sha256:string;bytes:number},hooks:Hooks={}):Promise<ProductImageWorkerResult>{
 if(hooks.signal?.aborted)throw cancelled();
 if(source.length!==identity.bytes||source.length>PRODUCT_IMAGE_LIMITS.sourceBytes||imageHash(source)!==identity.sha256)throw new ApiError(422,'IMAGE_PREPARATION_INPUT_INTEGRITY');
 if(hooks.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'IMAGE_PREPARATION_WRITER_UNAVAILABLE');
 const result=await new Promise<ProductImageWorkerResult>((resolve,reject)=>{
  const url=new URL('./product-image-preparation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))url.pathname=url.pathname.replace(/\.js$/,'.ts');
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe','pipe'];if(hooks.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=256',fileURLToPath(url),JSON.stringify(identity)],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'IMAGE_PREPARATION_WORKER_UNAVAILABLE'));return;}
  let unavailable=false,size=0,errorBytes=0,errorText='',aborted=false;const output:Buffer[]=[];
  const kill=()=>{try{child.kill('SIGKILL');}catch{/* Await close. */}};
  const abort=()=>{aborted=true;kill();};hooks.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{unavailable=true;kill();},20000);
  child.once('error',()=>{unavailable=true;});child.stdin?.on('error',()=>{});
  child.stdout?.on('data',(part:Buffer)=>{size+=part.length;if(size>PRODUCT_IMAGE_LIMITS.outputBytes*2+16392){unavailable=true;kill();}else output.push(part);});
  child.stderr?.on('data',(part:Buffer)=>{errorBytes+=part.length;if(errorBytes>4096){unavailable=true;kill();}else errorText+=part.toString();});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);hooks.signal?.removeEventListener('abort',abort);child.stdio[3]?.destroy();
   if(aborted||hooks.signal?.aborted){reject(cancelled());return;}
   if(unavailable||signal!==null){reject(new ApiError(503,'IMAGE_PREPARATION_WORKER_UNAVAILABLE'));return;}
   if(code!==0){reject(new ApiError(422,/^IMAGE_PREPARATION_[A-Z_]+\n$/.test(errorText)?errorText.trim():'IMAGE_PREPARATION_FAILED'));return;}
   try{
    const data=Buffer.concat(output,size);if(data.length<8||data.toString('ascii',0,4)!=='EIPP')throw Error();const n=data.readUInt32LE(4);if(n>16384||n<1||n+8>=data.length)throw Error();
    const metadata=JSON.parse(data.toString('utf8',8,n+8)),receipt=metadata.receipt as ProductImageOutput['receipt'],body=data.subarray(n+8),usage=metadata.resourceUsage;
    if(!receipt?.full||!Number.isSafeInteger(receipt.full.bytes)||receipt.full.bytes<1||receipt.full.bytes>PRODUCT_IMAGE_LIMITS.outputBytes)throw Error();
    const full=body.subarray(0,receipt.full.bytes),coarse=receipt.coarse?body.subarray(receipt.full.bytes):undefined;
    if(body.length!==receipt.full.bytes+(receipt.coarse?.bytes??0))throw Error();
    const output={full,...(coarse?{coarse}:{}),receipt};validateProductImageOutput(output,identity);
    if(!Number.isFinite(usage?.peakRssKiB)||usage.peakRssKiB<=0||!Number.isFinite(usage.cpuMicros)||usage.cpuMicros<0)throw Error();
    resolve({...output,resourceUsage:usage,workerDrained:true});
   }catch{reject(new ApiError(503,'IMAGE_PREPARATION_WORKER_OUTPUT_INVALID'));}
  });
  try{hooks.onSpawn?.(child,'prepare');}catch{unavailable=true;kill();}
  if(hooks.signal?.aborted)abort();child.stdin?.end(source);
 });
 if(hooks.signal?.aborted)throw cancelled();return result;
}
