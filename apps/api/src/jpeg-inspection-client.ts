// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFile,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {parseStaticJson} from '../../web/src/static-json.mjs';
import {inspectBaselineJpegStructure} from './jpeg-baseline-structure.ts';

// One experimental worker per runtime. The caller must still retain its own
// operation reservation until this promise settles, including on abort. The
// returned owned snapshot is the inspected input; any future consumer must
// fence its digest again at the point of use and must not substitute bytes.
let active=false,drainUncertain=false;
export async function inspectJpegInOwnedWorker(bytes:Buffer,signal:AbortSignal,hooks?:{onSpawn?:(child:ChildProcess)=>void}){
 if(active||drainUncertain||!Buffer.isBuffer(bytes)||types.isSharedArrayBuffer(bytes.buffer)||bytes.length<4||bytes.length>25*1024*1024||signal.aborted)throw Error('JPEG_INSPECTION_UNAVAILABLE');const snapshot=Buffer.from(bytes);active=true;let returned=false;
 try{let structure:ReturnType<typeof inspectBaselineJpegStructure>;try{structure=inspectBaselineJpegStructure(snapshot);}catch{throw Error('JPEG_INSPECTION_UNAVAILABLE');}const digest=createHash('sha256').update(snapshot).digest('hex');const receipt=await new Promise<unknown>((resolve,reject)=>{
  const path=new URL('./jpeg-inspection-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');let callbackDone=false,closed=false,failed=false,settling=false,code:number|null=null,output=Buffer.alloc(0);
  const groupAlive=(pid:number)=>{try{process.kill(-pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
  const killGroup=()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')failed=true;}}else try{child.kill('SIGKILL');}catch{failed=true;}};
  const finish=()=>{if(!callbackDone||!closed||settling)return;settling=true;void(async()=>{
   clearTimeout(timer);signal.removeEventListener('abort',abort);
   try{if(child.pid&&groupAlive(child.pid)){failed=true;killGroup();const deadline=Date.now()+5000;while(groupAlive(child.pid)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(groupAlive(child.pid))throw Error('GROUP_ALIVE');}}catch{drainUncertain=true;reject(Error('JPEG_INSPECTION_DRAIN_UNCERTAIN'));return;}
   if(failed||signal.aborted||code!==0){reject(Error('JPEG_INSPECTION_UNAVAILABLE'));return;}try{const result=parseStaticJson(output,2048) as Record<string,unknown>;if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='decodedSha256,decoder,height,iccBytes,iccSha256,sourceBytes,sourceSha256,version,width'||result.version!==1||result.sourceSha256!==digest||result.sourceBytes!==snapshot.length||result.width!==structure.width||result.height!==structure.height||result.iccBytes!==structure.iccBytes||result.iccSha256!==(structure.iccSha256??null)||result.decoder!=='sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'||typeof result.decodedSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.decodedSha256))throw Error();resolve(result);}catch{reject(Error('JPEG_INSPECTION_UNAVAILABLE'));}
  })();};
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path)],{encoding:'buffer',detached:true,maxBuffer:2048,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,stdout)=>{callbackDone=true;if(error)failed=true;output=stdout;finish();});
  const abort=()=>{failed=true;if(!closed)killGroup();},timer=setTimeout(abort,10000);signal.addEventListener('abort',abort,{once:true});child.once('close',value=>{code=value;closed=true;finish();});child.stdin?.on('error',()=>{});
  try{hooks?.onSpawn?.(child);if(signal.aborted)abort();else child.stdin?.end(snapshot);}catch{abort();}
 });returned=true;return {receipt,bytes:snapshot};}finally{if(!returned)snapshot.fill(0);active=false;}
}
