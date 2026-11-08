// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFile,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectBaselineJpegStructure} from './jpeg-baseline-structure.ts';

// One experimental worker per runtime. The caller must still retain its own
// operation reservation until this promise settles, including on abort.
let active=false;
export async function inspectJpegInOwnedWorker(bytes:Buffer,signal:AbortSignal,hooks?:{onSpawn?:(child:ChildProcess)=>void}){
 if(active||!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>25*1024*1024||signal.aborted)throw Error('JPEG_INSPECTION_UNAVAILABLE');active=true;
 try{let structure:ReturnType<typeof inspectBaselineJpegStructure>;try{structure=inspectBaselineJpegStructure(bytes);}catch{throw Error('JPEG_INSPECTION_UNAVAILABLE');}const digest=createHash('sha256').update(bytes).digest('hex');return await new Promise<unknown>((resolve,reject)=>{
  const path=new URL('./jpeg-inspection-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');let callbackDone=false,closed=false,failed=false,code:number|null=null,output='';
  const finish=()=>{if(!callbackDone||!closed)return;if(failed||signal.aborted||code!==0){reject(Error('JPEG_INSPECTION_UNAVAILABLE'));return;}try{const result=JSON.parse(output) as Record<string,unknown>;if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='decodedSha256,decoder,height,iccBytes,iccSha256,sourceBytes,sourceSha256,version,width'||result.version!==1||result.sourceSha256!==digest||result.sourceBytes!==bytes.length||result.width!==structure.width||result.height!==structure.height||result.iccBytes!==structure.iccBytes||result.iccSha256!==(structure.iccSha256??null)||result.decoder!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'||typeof result.decodedSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.decodedSha256))throw Error();resolve(result);}catch{reject(Error('JPEG_INSPECTION_UNAVAILABLE'));}};
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path)],{timeout:10000,maxBuffer:2048,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,stdout)=>{callbackDone=true;if(error)failed=true;output=stdout;finish();});
  const abort=()=>{failed=true;try{child.kill('SIGKILL');}catch{/* Actual close remains required. */}};signal.addEventListener('abort',abort,{once:true});child.once('close',value=>{code=value;closed=true;signal.removeEventListener('abort',abort);finish();});child.stdin?.on('error',()=>{});
  try{hooks?.onSpawn?.(child);if(signal.aborted)abort();else child.stdin?.end(bytes);}catch{abort();}
 });}finally{active=false;}
}
