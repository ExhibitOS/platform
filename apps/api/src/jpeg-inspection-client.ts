// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {parseStaticJson} from '../../web/src/static-json.mjs';
import {inspectBaselineJpegStructure} from './jpeg-baseline-structure.ts';
import {NativeDetailDrainUncertain} from './native-detail-drain.ts';

// One experimental worker per runtime. The caller must still retain its own
// operation reservation until this promise settles, including on abort. The
// returned owned snapshot is the inspected input; any future consumer must
// fence its digest again at the point of use and must not substitute bytes.
let active=false,drainUncertain=false;
export async function inspectJpegInOwnedWorker(bytes:Buffer,signal:AbortSignal,hooks?:{onSpawn?:(child:ChildProcess)=>void}){
 if(active||drainUncertain||!Buffer.isBuffer(bytes)||types.isSharedArrayBuffer(bytes.buffer)||bytes.length<4||bytes.length>25*1024*1024||signal.aborted)throw Error('JPEG_INSPECTION_UNAVAILABLE');const snapshot=Buffer.from(bytes);active=true;let returned=false;
 try{let structure:ReturnType<typeof inspectBaselineJpegStructure>;try{structure=inspectBaselineJpegStructure(snapshot);}catch{throw Error('JPEG_INSPECTION_UNAVAILABLE');}const digest=createHash('sha256').update(snapshot).digest('hex');const receipt=await new Promise<unknown>((resolve,reject)=>{
  const path=new URL('./jpeg-inspection-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');let spawned=false,exited=false,closed=false,failed=false,settled=false,code:number|null=null,totalOut=0,totalErr=0;const chunks:Buffer[]=[];
  const groupAlive=(pid:number)=>{try{process.kill(-pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
  // Never signal a numeric process group after its leader is reaped.
  const abort=()=>{failed=true;if(spawned&&!exited&&child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')failed=true;}};
  const uncertain=()=>{if(settled)return;settled=true;drainUncertain=true;clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new NativeDetailDrainUncertain());};
  const finish=()=>{if(!closed||settled)return;settled=true;clearTimeout(timer);clearTimeout(hardTimer);signal.removeEventListener('abort',abort);
   try{if(child.pid&&groupAlive(child.pid))throw Error('GROUP_REMAINS');}catch{drainUncertain=true;snapshot.fill(0);reject(new NativeDetailDrainUncertain());return;}
   if(failed||signal.aborted||code!==0){reject(Error('JPEG_INSPECTION_UNAVAILABLE'));return;}try{const result=parseStaticJson(Buffer.concat(chunks,totalOut),2048) as Record<string,unknown>;if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='cpuMicros,decodedSha256,decoder,height,iccBytes,iccSha256,peakRssKiB,sourceBytes,sourceSha256,version,width'||result.version!==1||result.sourceSha256!==digest||result.sourceBytes!==snapshot.length||result.width!==structure.width||result.height!==structure.height||result.iccBytes!==structure.iccBytes||result.iccSha256!==(structure.iccSha256??null)||result.decoder!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'||typeof result.decodedSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.decodedSha256)||!Number.isSafeInteger(result.peakRssKiB)||Number(result.peakRssKiB)<1||!Number.isSafeInteger(result.cpuMicros)||Number(result.cpuMicros)<0)throw Error();resolve(result);}catch{reject(Error('JPEG_INSPECTION_UNAVAILABLE'));}
  };
  const entry=fileURLToPath(path),apiDir=realpathSync(dirname(entry)),root=realpathSync(resolvePath(apiDir,'../../..')),moduleRoot=realpathSync(join(root,'node_modules'));
  // The native package gate pins these six complete package trees. The Node
  // permission model narrows JS file access; native addon code is not sandboxed.
  // Source tests may use a workspace dependency link; packaged JS must resolve
  // the module root inside the Manager-admitted payload itself.
  if(!import.meta.url.endsWith('.ts')&&moduleRoot!==join(root,'node_modules'))throw Error('JPEG_INSPECTION_UNAVAILABLE');
  const names=['sharp','@img/colour','detect-libc','semver','@img/sharp-darwin-arm64','@img/sharp-libvips-darwin-arm64'],packages=names.map(name=>{const expected=join(moduleRoot,name);if(realpathSync(expected)!==expected)throw Error('JPEG_INSPECTION_UNAVAILABLE');return expected;});
  const permitted=[apiDir,join(root,'package.json'),join(root,'apps/api/package.json'),...packages,...(import.meta.url.endsWith('.ts')?names.map(name=>join(root,'node_modules',name)):[])];if(permitted.some(value=>value.includes('*')))throw Error('JPEG_INSPECTION_UNAVAILABLE');
  const child=spawn(process.execPath,['--max-old-space-size=128','--permission','--allow-addons',...permitted.map(value=>`--allow-fs-read=${value}`),entry],{detached:true,stdio:['pipe','pipe','pipe','pipe'],env:{}});
  const timer=setTimeout(abort,10000),hardTimer=setTimeout(uncertain,15000);signal.addEventListener('abort',abort,{once:true});
  child.once('spawn',()=>{spawned=true;if(failed||signal.aborted)abort();});child.once('error',()=>{failed=true;});child.once('exit',()=>{exited=true;});child.once('close',value=>{code=value;closed=true;if(drainUncertain)snapshot.fill(0);finish();});
  child.stdout?.on('data',(chunk:Buffer)=>{totalOut+=chunk.length;if(totalOut>2048){abort();return;}chunks.push(Buffer.from(chunk));});child.stderr?.on('data',(chunk:Buffer)=>{totalErr+=chunk.length;if(totalErr>2048)abort();});child.stdout?.on('error',abort);child.stderr?.on('error',abort);child.stdin?.on('error',()=>{});child.stdio[3]?.on('error',()=>{});
  try{hooks?.onSpawn?.(child);if(signal.aborted)abort();else child.stdin?.end(snapshot);}catch{abort();}
 });returned=true;return {receipt,bytes:snapshot};}finally{if(!returned&&!drainUncertain)snapshot.fill(0);active=false;}
}
