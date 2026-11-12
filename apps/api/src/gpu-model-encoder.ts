// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {constants,type Stats} from 'node:fs';
import {lstat,mkdir,open,readdir,readlink,realpath,rmdir,unlink} from 'node:fs/promises';
import {arch,platform} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {ApiError} from './api-error.ts';
import {GPU_MODEL_PREPARATION_RECIPE} from './gpu-model-preparation-contract.ts';

type Code='GPU_MODEL_ENCODER_INPUT_INVALID'|'GPU_MODEL_ENCODER_IDENTITY_INVALID'|'GPU_MODEL_ENCODER_DIRECTORY_INVALID'|
 'GPU_MODEL_ENCODER_CANCELLED'|'GPU_MODEL_ENCODER_WRITER_INVALID'|'GPU_MODEL_ENCODER_AUTHORITY_LOST'|
 'GPU_MODEL_ENCODER_UNAVAILABLE'|'GPU_MODEL_ENCODER_FAILED'|'GPU_MODEL_ENCODER_DEADLINE'|
 'GPU_MODEL_ENCODER_OUTPUT_INVALID'|'GPU_MODEL_ENCODER_CLEANUP_FAILED';
export class GpuModelEncoderError extends ApiError {
 readonly workerDrained:boolean;readonly cleanupComplete:boolean;
 constructor(code:Code,workerDrained:boolean,cleanupComplete:boolean){super(code==='GPU_MODEL_ENCODER_CANCELLED'?409:code==='GPU_MODEL_ENCODER_INPUT_INVALID'?422:503,code);this.workerDrained=workerDrained;this.cleanupComplete=cleanupComplete;}
}
export interface GpuModelEncoderContext {
 managedPrefix:string;jobDirectory:string;signal?:AbortSignal;writerFd?:number;
 assertCurrent:()=>Promise<void>;onSpawn?:(child:ChildProcess)=>void;
}
const MAX_BYTES=8*1024*1024,MAX_DIAGNOSTIC_BYTES=4096;
const identity=GPU_MODEL_PREPARATION_RECIPE.encoder;
const fail=(code:Code):never=>{throw new GpuModelEncoderError(code,true,true);};
const same=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino;
const within=(root:string,path:string)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);};
async function directoryRaw(path:string,privateMode=false):Promise<Stats>{
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||await realpath(path)!==path)fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');
 const uid=process.getuid?.();if(uid===undefined)fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');
 // Ancestors may belong to root (e.g. /Volumes); the selected server directory
 // itself must belong to this user. No path component may be a symlink.
 let current=path;
 while(true){const s=await lstat(current);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==uid&&s.uid!==0))fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');if(current===dirname(current))break;current=dirname(current);}
 const s=await lstat(path);
 if(s.uid!==uid||(s.mode&0o022)!==0||privateMode&&(s.mode&0o777)!==0o700)fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');return s;
}
async function directory(path:string,privateMode=false):Promise<Stats>{try{return await directoryRaw(path,privateMode);}catch{return fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');}}
async function checkedFile(path:string,size:number,sha256?:string,mode?:number):Promise<{bytes:Buffer;stat:Stats}>{
 const prior=await lstat(path);if(!prior.isFile()||prior.isSymbolicLink()||prior.uid!==process.getuid?.()||prior.nlink!==1||prior.size!==size||mode!==undefined&&(prior.mode&0o777)!==mode)fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();if(!same(prior,stat)||!stat.isFile()||stat.size!==size||stat.uid!==process.getuid?.()||stat.nlink!==1||mode!==undefined&&(stat.mode&0o777)!==mode)fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  const bounded=Buffer.alloc(size+1);let count=0;
  while(count<bounded.length){const read=await fd.read(bounded,count,bounded.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
  const bytes=bounded.subarray(0,count),after=await fd.stat(),pathAfter=await lstat(path);
  if(bytes.length!==size||!same(stat,after)||!same(after,pathAfter)||pathAfter.isSymbolicLink()||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs||sha256&&createHash('sha256').update(bytes).digest('hex')!==sha256)fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  return {bytes,stat};
 }finally{await fd.close();}
}
/** Verify existing signed input bytes only; never executes, installs or signs a tool. */
export async function assertGpuModelEncoderReady(managedPrefix:string):Promise<void>{
 try{
  if(platform()!=='darwin'||arch()!=='arm64')fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  await directory(managedPrefix);await directory(join(managedPrefix,'bin'));await directory(join(managedPrefix,'lib'));
  if((await readdir(join(managedPrefix,'bin'))).sort().join('|')!=='toktx'||
    (await readdir(join(managedPrefix,'lib'))).sort().join('|')!=='libktx.4.4.2.dylib|libktx.4.dylib|libktx.dylib')fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  for(const [name,target] of [['libktx.4.dylib','libktx.4.4.2.dylib'],['libktx.dylib','libktx.4.dylib']]){
   const path=join(managedPrefix,'lib',name!);const s=await lstat(path);
   if(!s.isSymbolicLink()||s.uid!==process.getuid?.()||await readlink(path)!==target||await realpath(path)!==join(managedPrefix,'lib','libktx.4.4.2.dylib'))fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  }
  await checkedFile(join(managedPrefix,'bin','toktx'),identity.bytes,identity.sha256,0o755);
  await checkedFile(join(managedPrefix,'lib','libktx.4.4.2.dylib'),identity.libraryBytes,identity.librarySHA256,0o755);
 }catch{fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');}
}
function pngInput(png:Buffer):Buffer{
 if(!Buffer.isBuffer(png)||png.length<33||png.length>MAX_BYTES||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
  png.readUInt32BE(8)!==13||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==512||png.readUInt32BE(20)!==512||
  png[24]!==8||png[25]!==2||png[26]!==0||png[27]!==0||png[28]!==0)fail('GPU_MODEL_ENCODER_INPUT_INVALID');
 // Full PNG decoding/opacity/role validation belongs to the producer, not this
 // process adapter. Keep an immutable byte snapshot during asynchronous use.
 return Buffer.from(png);
}
async function authority(context:GpuModelEncoderContext){try{await context.assertCurrent();}catch{fail('GPU_MODEL_ENCODER_AUTHORITY_LOST');}}
/** Direct, non-detached managed process. Killing is never evidence of drain. */
export async function encodeGpuModelBaseColor(png:Buffer,context:GpuModelEncoderContext):Promise<{ktx:Buffer;workerDrained:true;elapsedMs:number}>{
 const started=performance.now();let owned:string|undefined,ownedStat:Stats|undefined,inputStat:Stats|undefined;
 let spawned=false,closed=false,result:Buffer|undefined,error:unknown;
 const inputName='source.png',outputName='base-color.ktx2';
 try{
  const input=pngInput(png);
  if(context.signal?.aborted)fail('GPU_MODEL_ENCODER_CANCELLED');
  if(context.writerFd!==undefined&&(!Number.isSafeInteger(context.writerFd)||context.writerFd<10||context.writerFd>1023))fail('GPU_MODEL_ENCODER_WRITER_INVALID');
  await authority(context);const jobStat=await directory(context.jobDirectory,true);
  if(context.jobDirectory===context.managedPrefix||within(context.managedPrefix,context.jobDirectory)||within(context.jobDirectory,context.managedPrefix))fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');
  owned=join(context.jobDirectory,'gpu-'+randomUUID());await mkdir(owned,{mode:0o700});ownedStat=await directory(owned,true);
  if(!same(jobStat,await directory(context.jobDirectory,true)))fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');
  const inputPath=join(owned,inputName),outputPath=join(owned,outputName);
  const fd=await open(inputPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{inputStat=await fd.stat();await fd.writeFile(input);}finally{await fd.close();}
  await authority(context);await assertGpuModelEncoderReady(context.managedPrefix);
  if(context.signal?.aborted)fail('GPU_MODEL_ENCODER_CANCELLED');
  await new Promise<void>((resolve,reject)=>{
   let child:ChildProcess;try{
    child=spawn(join(context.managedPrefix,'bin','toktx'),[...identity.options,outputPath,inputPath],{
     cwd:owned,env:{LANG:'C',LC_ALL:'C',TMPDIR:owned},detached:false,shell:false,
     stdio:context.writerFd===undefined?['ignore','pipe','pipe']:['ignore','pipe','pipe',context.writerFd],
    });spawned=true;
   }catch{reject(new GpuModelEncoderError('GPU_MODEL_ENCODER_UNAVAILABLE',true,true));return;}
   let failure:Code|undefined,stdout=0,stderr=0,polling:Promise<void>|undefined,callback=Promise.resolve();
   const stop=(code:Code)=>{failure??=code;try{child.kill('SIGKILL');}catch{/* Only actual close establishes drain. */}};
   const abort=()=>stop('GPU_MODEL_ENCODER_CANCELLED');
   const timer=setTimeout(()=>stop('GPU_MODEL_ENCODER_DEADLINE'),20000);
   const poll=async()=>{
    try{const s=await lstat(outputPath);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_BYTES||s.uid!==process.getuid?.()||s.nlink!==1)stop('GPU_MODEL_ENCODER_OUTPUT_INVALID');}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')stop('GPU_MODEL_ENCODER_OUTPUT_INVALID');}
   };
   const monitor=setInterval(()=>{if(!polling)polling=poll().finally(()=>{polling=undefined;});},50);
   context.signal?.addEventListener('abort',abort,{once:true});
   child.once('error',()=>stop('GPU_MODEL_ENCODER_UNAVAILABLE'));
   child.stdout?.once('error',()=>stop('GPU_MODEL_ENCODER_UNAVAILABLE'));child.stderr?.once('error',()=>stop('GPU_MODEL_ENCODER_UNAVAILABLE'));
   child.stdout?.on('data',(part:Buffer)=>{stdout+=part.length;if(stdout>MAX_DIAGNOSTIC_BYTES)stop('GPU_MODEL_ENCODER_FAILED');});
   child.stderr?.on('data',(part:Buffer)=>{stderr+=part.length;if(stderr>MAX_DIAGNOSTIC_BYTES)stop('GPU_MODEL_ENCODER_FAILED');});
   child.once('close',(code,signal)=>{
    closed=true;clearTimeout(timer);clearInterval(monitor);context.signal?.removeEventListener('abort',abort);
    void (async()=>{
     // Yield past a synchronously emitted close inside onSpawn, then wait for
     // the complete owner callback and any in-flight filesystem observation.
     await Promise.resolve();await polling;await callback;
     if(context.signal?.aborted)failure='GPU_MODEL_ENCODER_CANCELLED';
     if(failure){reject(new GpuModelEncoderError(failure,true,true));return;}
     if(code!==0||signal!==null){reject(new GpuModelEncoderError('GPU_MODEL_ENCODER_FAILED',true,true));return;}
     resolve();
    })().catch(()=>reject(new GpuModelEncoderError('GPU_MODEL_ENCODER_FAILED',true,true)));
   });
   try{callback=Promise.resolve(context.onSpawn?.(child)).catch(()=>{stop('GPU_MODEL_ENCODER_FAILED');});}catch{stop('GPU_MODEL_ENCODER_FAILED');}
   if(context.signal?.aborted)abort();
  });
  await authority(context);await assertGpuModelEncoderReady(context.managedPrefix);
  if(context.signal?.aborted)fail('GPU_MODEL_ENCODER_CANCELLED');
  if(!same(jobStat,await directory(context.jobDirectory,true))||!same(ownedStat,await directory(owned,true)))fail('GPU_MODEL_ENCODER_DIRECTORY_INVALID');
  const source=await checkedFile(inputPath,input.length,createHash('sha256').update(input).digest('hex'),0o600);
  if(!same(inputStat!,source.stat))fail('GPU_MODEL_ENCODER_IDENTITY_INVALID');
  try{const output=await lstat(outputPath);if(!output.isFile()||output.isSymbolicLink()||output.size<1||output.size>MAX_BYTES)fail('GPU_MODEL_ENCODER_OUTPUT_INVALID');
   result=(await checkedFile(outputPath,output.size)).bytes;}catch{fail('GPU_MODEL_ENCODER_OUTPUT_INVALID');}
 }catch(e){error=e;}
 // No close means the process Promise above remains pending. This cleanup cannot
 // run on an abort/timeout/error notification alone, nor erase a foreign surface.
 let cleanupComplete=true;
 if(owned){
  try{
   if(!ownedStat||spawned&&!closed||!same(ownedStat,await directory(owned,true)))throw Error();
   const names=await readdir(owned);if(names.some(name=>name!==inputName&&name!==outputName))throw Error();
   for(const name of names){const path=join(owned,name),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.nlink!==1||name===inputName&&inputStat&&!same(s,inputStat))throw Error();}
   for(const name of names)await unlink(join(owned,name));await rmdir(owned);
  }catch{cleanupComplete=false;}
 }
 if(!cleanupComplete)throw new GpuModelEncoderError('GPU_MODEL_ENCODER_CLEANUP_FAILED',!spawned||closed,false);
 if(error)throw new GpuModelEncoderError(error instanceof GpuModelEncoderError?error.code as Code:'GPU_MODEL_ENCODER_FAILED',!spawned||closed,true);
 if(!result)throw new GpuModelEncoderError('GPU_MODEL_ENCODER_FAILED',!spawned||closed,true);
 return {ktx:result,workerDrained:true,elapsedMs:performance.now()-started};
}
