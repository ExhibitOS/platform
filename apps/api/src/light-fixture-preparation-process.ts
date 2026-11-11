// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import {LIGHT_FIXTURE_PREPARATION_POLICY,prepareLightFixtureSource} from './light-fixture-preparation.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {parseStaticJson} from '../../web/src/static-json.mjs';

type Receipt=ReturnType<typeof prepareLightFixtureSource>['receipt'];
type Hooks={writerFd?:number;onSpawn?:(child:ChildProcess)=>void;signal?:AbortSignal;assertCurrent?:()=>Promise<void>};
const limit=8*1024*1024,sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const identity=(bytes:Buffer)=>({sha256:sha(bytes),bytes:bytes.length});

/** Feature eligibility is decided by the product producer, never source hash.
 * Both preparation and ordinary validation must close before any result earns
 * custody. The caller still owns the durable job and current owner checks. */
export async function prepareLightFixtureInWorker(source:Buffer,hooks:Hooks={}):Promise<{bytes:Buffer;receipt:Receipt;workerDrained:true}>{
 if(!Buffer.isBuffer(source)||source.length<28||source.length>limit)throw new ApiError(422,'LIGHT_FIXTURE_PREPARATION_UNSAFE');
 if(hooks.writerFd!==undefined&&(!Number.isSafeInteger(hooks.writerFd)||hooks.writerFd<10||hooks.writerFd>1023))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 hooks.signal?.throwIfAborted();await hooks.assertCurrent?.();
 const frame=await run(source,hooks);
 hooks.signal?.throwIfAborted();await hooks.assertCurrent?.();
 if(frame.length<5)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 const size=frame.readUInt32LE(0);if(size<1||size>65536||4+size>=frame.length)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame.subarray(4,4+size)));}catch{throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');}
 const bytes=Buffer.from(frame.subarray(4+size));
 if(!object(parsed)||!exact(parsed,['version','policy','source','derived','removed','binSHA256'])||parsed.version!==1||parsed.policy!==LIGHT_FIXTURE_PREPARATION_POLICY||!isDeepStrictEqual(parsed.source,identity(source))||!isDeepStrictEqual(parsed.derived,identity(bytes))||!Array.isArray(parsed.removed)||parsed.removed.length<1||parsed.removed.length>4096||parsed.removed.some(item=>!object(item)||!exact(item,['mesh','primitive','accessor'])||Object.values(item).some(value=>!Number.isSafeInteger(value)||(value as number)<0)))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 const bin=(data:Buffer)=>{if(data.length<28)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');const end=20+data.readUInt32LE(12);if(end+8>data.length||end%4!==0||data.readUInt32LE(end+4)!==0x004e4942||end+8+data.readUInt32LE(end)!==data.length)throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');return data.subarray(end);};
 const originalBin=bin(source),derivedBin=bin(bytes);
 if(!originalBin.equals(derivedBin)||parsed.binSHA256!==sha(originalBin.subarray(8)))throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 // Independently restore only the claimed attribute removals. A valid GLB
 // alone would not prove that materials, nodes or other source intent stayed
 // unchanged, even if a malfunctioning worker returned matching byte hashes.
 try{
  const original=parseStaticJson(source.subarray(20,20+source.readUInt32LE(12)),1048576) as {meshes:{primitives:{attributes:Record<string,unknown>}[]}[]};
  const restored=parseStaticJson(bytes.subarray(20,20+bytes.readUInt32LE(12)),1048576) as typeof original;
  const seen=new Set<string>();
  for(const entry of parsed.removed as Receipt['removed']){
   const key=`${entry.mesh}:${entry.primitive}`,before=original.meshes[entry.mesh]?.primitives[entry.primitive]?.attributes,after=restored.meshes[entry.mesh]?.primitives[entry.primitive]?.attributes;
   if(seen.has(key)||!object(before)||!object(after)||before.TANGENT!==entry.accessor||Object.hasOwn(after,'TANGENT'))throw Error('binding');
   seen.add(key);after.TANGENT=entry.accessor;
  }
  if(!isDeepStrictEqual(original,restored))throw Error('source');
 }catch{throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');}
 // This is the same full validator used by ordinary furnishing admission.
 // Passing feature transformation alone never waives format validation.
 await validateWorkspaceFurnishingGlb({mime:'model/gltf-binary',...identity(bytes)},bytes,{writerFd:hooks.writerFd,onSpawn:child=>{if(hooks.signal?.aborted)child.kill('SIGKILL');hooks.onSpawn?.(child);const abort=()=>{try{child.kill('SIGKILL');}catch{/* Await actual close. */}};hooks.signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>hooks.signal?.removeEventListener('abort',abort));}});
 hooks.signal?.throwIfAborted();await hooks.assertCurrent?.();
 return {bytes,receipt:parsed as unknown as Receipt,workerDrained:true};
}

function run(source:Buffer,hooks:Hooks):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const path=new URL('./light-fixture-preparation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  const stdio:('pipe'|number)[]=['pipe','pipe','pipe'];if(hooks.writerFd!==undefined)stdio.push(hooks.writerFd);
  let child:ChildProcess;try{child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(path)],{env:{PATH:process.env.PATH},stdio});}catch{reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}
  let unavailable=false,size=0,errorSize=0,error='';const parts:Buffer[]=[];
  const kill=()=>{unavailable=true;try{child.kill('SIGKILL');}catch{/* Do not settle without close. */}};
  const timer=setTimeout(kill,5000);hooks.signal?.addEventListener('abort',kill,{once:true});
  child.once('error',()=>{unavailable=true;});
  child.stdout?.on('data',(part:Buffer)=>{size+=part.length;if(size>limit+65540)kill();else parts.push(part);});
  child.stderr?.on('data',(part:Buffer)=>{errorSize+=part.length;if(errorSize>4096)kill();else error+=part.toString('utf8');});
  child.once('close',(code,signal)=>{clearTimeout(timer);hooks.signal?.removeEventListener('abort',kill);if(unavailable||signal!==null){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}if(code===1&&error.trim()==='LIGHT_FIXTURE_PREPARATION_UNSAFE'){reject(new ApiError(422,'LIGHT_FIXTURE_PREPARATION_UNSAFE'));return;}if(code!==0||errorSize!==0){reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));return;}resolve(Buffer.concat(parts,size));});
  child.stdin?.on('error',()=>{});try{hooks.onSpawn?.(child);if(hooks.signal?.aborted)kill();}catch{kill();}child.stdin?.end(source);
 });
}
