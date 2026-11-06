// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ApiError} from './api-error.ts';
import {privatePaintingCandidateRecipe,type PrivatePaintingCapability,type PrivatePaintingContext} from './demo-display-policy.ts';

/** Strictly decode an already issued capability. This does not obtain CMS
 * authority, create an asset, or authorize initial import; callers must obtain
 * currentArtwork from the authorized CMS transaction and recheck it there. */
export async function validatePrivatePainting(capability:PrivatePaintingCapability,context:PrivatePaintingContext,signal?:AbortSignal):Promise<void>{
 if(signal?.aborted)throw new ApiError(409,'VALIDATION_CANCELLED');
 privatePaintingCandidateRecipe(capability,context);
 const bytes=Buffer.from(context.bytes),path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
 await new Promise<void>((resolve,reject)=>{
  let callbackDone=false,closed=false,valid=false,formatRejected=false,closeCode:number|null=null;
  const settle=()=>{if(callbackDone&&closed){if(signal?.aborted)reject(new ApiError(409,'VALIDATION_CANCELLED'));else if(valid&&closeCode===0)resolve();else if(formatRejected&&closeCode===1)reject(new ApiError(422,'FORMAT_REJECTED'));else reject(new ApiError(503,'VALIDATION_UNAVAILABLE'));}};
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path),'image/png','private-painting-png',capability.profile],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL',signal},(error,stdout)=>{callbackDone=true;valid=!error&&stdout.trim()==='VALID';formatRejected=!!error&&typeof error==='object'&&'code' in error&&error.code===1&&!('signal' in error&&error.signal)&&!('killed' in error&&error.killed)&&stdout.trim()==='FORMAT_REJECTED';settle();});
  child.once('close',code=>{closeCode=code;closed=true;settle();});child.stdin?.on('error',()=>{});child.stdin?.end(bytes);
 });
 if(signal?.aborted)throw new ApiError(409,'VALIDATION_CANCELLED');
 privatePaintingCandidateRecipe(capability,context);
}
