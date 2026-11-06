// SPDX-License-Identifier: AGPL-3.0-or-later
import {fileURLToPath} from 'node:url';
import {execFile,type ChildProcess} from 'node:child_process';
import {ApiError} from './api-error.ts';
export function decode(bytes:Buffer,mime:string,options?:{classifyPngPixelLimit?:boolean;onSpawn?:(child:ChildProcess)=>void}) {
 return new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  let callbackDone=false,closed=false,valid=false,pixelLimit=false,hookFailed=false,closeCode:number|null=null;
  const classify=options?.classifyPngPixelLimit===true&&mime==='image/png';
  const settle=()=>{if(callbackDone&&closed){if(hookFailed)reject(new ApiError(503,'VALIDATION_UNAVAILABLE'));else if(valid&&closeCode===0)resolve();else reject(new ApiError(422,pixelLimit&&closeCode===1?'PNG_PIXEL_LIMIT_EXCEEDED':'FORMAT_REJECTED'));}};
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path),mime,...(classify?['png-original']:[])],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,stdout)=>{
   callbackDone=true;valid=!error&&stdout.trim()==='VALID';pixelLimit=classify&&!!error&&typeof error==='object'&&'code' in error&&error.code===1&&!('signal' in error&&error.signal)&&!('killed' in error&&error.killed)&&stdout.trim()==='PNG_PIXEL_LIMIT_EXCEEDED';settle();
  });
  // execFile may report a kill error before a live child has closed. A result
  // is safe to release only after both its callback and the actual close event.
  child.once('close',(code:number|null)=>{closeCode=code;closed=true;settle();});
  child.stdin?.on('error',()=>{});try{options?.onSpawn?.(child);}catch{hookFailed=true;try{child.kill('SIGKILL');}catch{/* Wait for the actual child close. */}}child.stdin?.end(bytes);
 });
}
