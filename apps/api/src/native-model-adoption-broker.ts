// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn} from 'node:child_process';
import {fstatSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {ApiError} from './api-error.ts';
import {parseNativeModelAdoptionGrant,readNativeModelAdoptionBlob,type NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';

interface NativeAdoptionBroker {
 helper:string;
 rootFd:number;
 rootDevice:string;
 rootInode:string;
}

/** Launch values must come from the authenticated native bootstrap. Never
 * construct this descriptor from an HTTP payload or the source grant. */
export async function readNativeAdoptionBrokerBlob(
 broker:NativeAdoptionBroker,input:NativeModelAdoptionGrant,role:'original'|'display',signal:AbortSignal,
){
 const invalid=()=>new ApiError(409,'NATIVE_MODEL_ADOPTION_STAGE_INVALID');
 const grant=parseNativeModelAdoptionGrant(input);
 signal.throwIfAborted();
 try{
  if(!isAbsolute(broker.helper)||realpathSync(broker.helper)!==broker.helper||
     !Number.isSafeInteger(broker.rootFd)||broker.rootFd<4||broker.rootFd>1023)throw invalid();
  const root=fstatSync(broker.rootFd,{bigint:true});
  if(!root.isDirectory()||String(root.dev)!==broker.rootDevice||String(root.ino)!==broker.rootInode)throw invalid();
 }catch{throw invalid();}
 const request=JSON.stringify({
  version:1,rootDevice:broker.rootDevice,rootInode:broker.rootInode,operationId:grant.operationId,role,
  bytes:grant[role].bytes,sha256:grant[role].sha256,
 });
 if(Buffer.byteLength(request)>1024)throw invalid();
 const timeout=AbortSignal.timeout(Math.max(1,Math.min(30_000,grant.expiresAt-Date.now())));
 const active=AbortSignal.any([signal,timeout]);
 let child;
 try{child=spawn(broker.helper,['--model-adoption-stage-read-v1'],{env:{},stdio:['pipe','pipe','pipe',broker.rootFd]});}
 catch{throw invalid();}
 const kill=()=>{
  child.stdout!.destroy();
  try{child.kill('SIGKILL');}catch{/* Wait for the close event. */}
 };
 const closed=new Promise<boolean>(resolve=>{
  let ioFailed=false;
  child.once('error',()=>{ioFailed=true;});
  child.stdin!.once('error',()=>{ioFailed=true;kill();});
  child.stderr!.resume();
  child.once('close',(code,exitSignal)=>resolve(!ioFailed&&code===0&&exitSignal===null));
 });
 active.addEventListener('abort',kill,{once:true});
 let bytes:Buffer|undefined;
 try{
  active.throwIfAborted();
  child.stdin!.end(request);
  bytes=await readNativeModelAdoptionBlob(grant,role,child.stdout!,active);
  if(!await closed||active.aborted||Date.now()>=grant.expiresAt)throw invalid();
  return bytes;
 }catch{
  kill();
  await closed;
  bytes?.fill(0);
  signal.throwIfAborted();
  throw invalid();
 }finally{
  active.removeEventListener('abort',kill);
 }
}
