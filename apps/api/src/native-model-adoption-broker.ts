// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fstatSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {ApiError} from './api-error.ts';
import {parseNativeModelAdoptionGrant,readNativeModelAdoptionBlob,type NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';

export interface NativeAdoptionBroker {
 helper:string;
 rootFd:number;
 rootDevice:string;
 rootInode:string;
}

const invalid=()=>new ApiError(409,'NATIVE_MODEL_ADOPTION_STAGE_INVALID');
type Role='original'|'display';

function brokerRequest(broker:NativeAdoptionBroker,grant:NativeModelAdoptionGrant,role:Role){
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
 return request;
}

function brokerSignal(grant:NativeModelAdoptionGrant,signal:AbortSignal){
 const timeout=AbortSignal.timeout(Math.max(1,Math.min(30_000,grant.expiresAt-Date.now())));
 return AbortSignal.any([signal,timeout]);
}

/** Launch values must come from the authenticated native bootstrap. Never
 * construct this descriptor from an HTTP payload or the source grant. */
export async function readNativeAdoptionBrokerBlob(
 broker:NativeAdoptionBroker,input:NativeModelAdoptionGrant,role:Role,signal:AbortSignal,
){
 const grant=parseNativeModelAdoptionGrant(input);
 signal.throwIfAborted();
 const request=brokerRequest(broker,grant,role);
 const active=brokerSignal(grant,signal);
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


const written=Buffer.from('{"version":1,"outcome":"written"}\n');

/** The Manager reserves the role leaf before the authenticated source can
 * write. Completion requires the helper's exact acknowledgment and clean exit. */
export async function writeNativeAdoptionBrokerBlob(
 broker:NativeAdoptionBroker,input:NativeModelAdoptionGrant,role:Role,bytes:Buffer,signal:AbortSignal,
){
 const grant=parseNativeModelAdoptionGrant(input);
 signal.throwIfAborted();
 if(bytes.length!==grant[role].bytes||createHash('sha256').update(bytes).digest('hex')!==grant[role].sha256)throw invalid();
 const request=Buffer.from(brokerRequest(broker,grant,role)),header=Buffer.alloc(4);
 header.writeUInt32BE(request.length);
 const active=brokerSignal(grant,signal);
 let child;
 try{child=spawn(broker.helper,['--model-adoption-stage-write-v1'],{env:{},stdio:['pipe','pipe','pipe',broker.rootFd]});}
 catch{throw invalid();}
 const stop=()=>{
  child.stdout!.destroy();
  try{child.kill('SIGKILL');}catch{/* Wait for the close event. */}
 };
 const closed=new Promise<boolean>(resolve=>{
  let failed=false;
  child.once('error',()=>{failed=true;});
  child.stdin!.once('error',()=>{failed=true;stop();});
  child.stderr!.resume();
  child.once('close',(code,exitSignal)=>resolve(!failed&&code===0&&exitSignal===null));
 });
 active.addEventListener('abort',stop,{once:true});
 const ack=Buffer.alloc(written.length);
 let size=0;
 try{
  active.throwIfAborted();
  child.stdin!.write(Buffer.concat([header,request]));
  child.stdin!.end(bytes);
  for await(const chunk of child.stdout!){
   if(size+chunk.length>ack.length)throw invalid();
   size+=chunk.copy(ack,size);
  }
  if(size!==ack.length||!ack.equals(written)||!await closed||active.aborted||Date.now()>=grant.expiresAt)throw invalid();
 }catch{
  stop();
  await closed;
  signal.throwIfAborted();
  throw invalid();
 }finally{
  active.removeEventListener('abort',stop);
 }
}
