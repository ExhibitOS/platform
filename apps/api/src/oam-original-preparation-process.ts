// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import {matchesModelPreparationInput,modelPreparationHash,COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,LARGE_MODEL_RECIPE,LARGE_MODEL_RECIPE_SHA256,compactModelRecipeFor,type CompactModelProfile,type CompactModelPreparation,type ModelPreparationInput} from './oam-original-preparation.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';

type Hooks={profile?:CompactModelProfile;writerFd?:number;signal?:AbortSignal;onSpawn?:(child:ChildProcess,stage:'prepare'|'validate')=>void};
export type CompactModelPreparedResult=CompactModelPreparation&{resourceUsage:{peakRssKiB:number;cpuMicros:number};workerDrained:true};
const cancelled=()=>new ApiError(409,'MODEL_PREPARATION_CANCELLED');
/** Source-only producer seam. No caller-supplied receipt or output hash, and
 * no result becomes usable before actual producer AND strict validator close. */
export async function prepareCompactModelInWorker(source:Buffer,identity:ModelPreparationInput,hooks:Hooks={}):Promise<CompactModelPreparedResult>{
 if(hooks.signal?.aborted)throw cancelled();
 const profile=hooks.profile??COMPACT_MODEL_RECIPE.id,recipe=compactModelRecipeFor(profile);
 const recipeSHA256=profile===LARGE_MODEL_RECIPE.id?LARGE_MODEL_RECIPE_SHA256:COMPACT_MODEL_RECIPE_SHA256;
 if(!matchesModelPreparationInput(source,identity,profile))throw new ApiError(422,'MODEL_PREPARATION_INPUT_INTEGRITY');
 if(hooks.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'MODEL_PREPARATION_WRITER_UNAVAILABLE');
 const result=await new Promise<Omit<CompactModelPreparedResult,'workerDrained'>>((resolve,reject)=>{
  const url=new URL('./oam-original-preparation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))url.pathname=url.pathname.replace(/\.js$/,'.ts');
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe','pipe'];if(hooks.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=256',fileURLToPath(url),JSON.stringify(identity),profile],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'MODEL_PREPARATION_WORKER_UNAVAILABLE'));return;}
  let unavailable=false,size=0,errorBytes=0,errorText='',aborted=false;const output:Buffer[]=[];
  const kill=()=>{try{child.kill('SIGKILL');}catch{/* Await close. */}};
  const abort=()=>{aborted=true;kill();};hooks.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{unavailable=true;kill();},20000);
  child.once('error',()=>{unavailable=true;});child.stdin?.on('error',()=>{});
  child.stdout?.on('data',(part:Buffer)=>{size+=part.length;if(size>recipe.limits.outputBytes+16392){unavailable=true;kill();}else output.push(part);});
  child.stderr?.on('data',(part:Buffer)=>{errorBytes+=part.length;if(errorBytes>4096){unavailable=true;kill();}else errorText+=part.toString();});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);hooks.signal?.removeEventListener('abort',abort);child.stdio[3]?.destroy();
   if(aborted||hooks.signal?.aborted){reject(cancelled());return;}
   if(unavailable||signal!==null){reject(new ApiError(503,'MODEL_PREPARATION_WORKER_UNAVAILABLE'));return;}
   if(code!==0){reject(new ApiError(422,/^MODEL_PREPARATION_[A-Z_]+\n$/.test(errorText)?errorText.trim():'MODEL_PREPARATION_FAILED'));return;}
   try{
    const data=Buffer.concat(output,size);if(data.length<8||data.toString('ascii',0,4)!=='EMCP')throw Error();const n=data.readUInt32LE(4);if(n>16384||n<1||n+8>=data.length)throw Error();
    const metadata=JSON.parse(data.toString('utf8',8,n+8)),receipt=metadata.receipt as CompactModelPreparation['receipt'],bytes=data.subarray(n+8),usage=metadata.resourceUsage;
    if(!receipt||receipt.version!==1||receipt.recipeId!==profile||receipt.recipeSHA256!==recipeSHA256||receipt.source.sha256!==identity.sha256||receipt.source.bytes!==identity.bytes||!Number.isSafeInteger(receipt.source.triangles)||receipt.source.triangles<1||receipt.source.triangles>recipe.limits.triangles||!Number.isSafeInteger(receipt.source.vertices)||receipt.source.vertices<3||receipt.source.vertices>recipe.limits.vertices||receipt.output.sha256!==modelPreparationHash(bytes)||receipt.output.bytes!==bytes.length||!Number.isSafeInteger(receipt.output.triangles)||receipt.output.triangles<1||receipt.output.triangles>20000||!Number.isSafeInteger(receipt.output.vertices)||receipt.output.vertices<3||receipt.output.vertices>receipt.source.vertices||!Number.isSafeInteger(receipt.output.textureEdge)||receipt.output.textureEdge<1||receipt.output.textureEdge>512||typeof receipt.output.reusedOriginal!=='boolean'||receipt.output.reusedOriginal&&!bytes.equals(source)||!isDeepStrictEqual(receipt.output.bounds,receipt.source.bounds)||!Array.isArray(receipt.images)||receipt.images.length<1||receipt.images.length>3||receipt.decoder!==recipe.decoder||!Number.isFinite(usage?.peakRssKiB)||usage.peakRssKiB<=0||!Number.isFinite(usage.cpuMicros)||usage.cpuMicros<0)throw Error();
    resolve({bytes,receipt,resourceUsage:usage});
   }catch{reject(new ApiError(503,'MODEL_PREPARATION_WORKER_OUTPUT_INVALID'));}
  });
  try{hooks.onSpawn?.(child,'prepare');}catch{unavailable=true;kill();}
  if(hooks.signal?.aborted)abort();child.stdin?.end(source);
 });
 if(hooks.signal?.aborted)throw cancelled();
 let validating:ChildProcess|undefined;
 const abort=()=>{try{validating?.kill('SIGKILL');}catch{/* The validator promise still waits for close. */}};
 hooks.signal?.addEventListener('abort',abort,{once:true});
 try{
  // The shared helper runs the same strict ordinary GLB decoder, with a native
  // writer FD and an awaited close; its extra mode only classifies failures.
  await validateWorkspaceFurnishingGlb({mime:'model/gltf-binary',bytes:result.bytes.length,sha256:result.receipt.output.sha256},result.bytes,{writerFd:hooks.writerFd,onSpawn:child=>{validating=child;hooks.onSpawn?.(child,'validate');if(hooks.signal?.aborted)abort();}});
 }catch(error){if(hooks.signal?.aborted)throw cancelled();throw error;}finally{hooks.signal?.removeEventListener('abort',abort);}
 if(hooks.signal?.aborted)throw cancelled();return {...result,workerDrained:true};
}
