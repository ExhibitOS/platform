// SPDX-License-Identifier: AGPL-3.0-or-later
import {nativeDetailPipe} from './native-detail-pipe.mjs';
import {nativeDetailControl} from './native-detail-control.mjs';
import {exportStaticPublication} from './export-static-publication.mjs';

/** Candidate-free protocol plumbing only; it is not a source-byte producer. */
export async function runNativeDetailExport({origin,publicationId,runtimeRoot,output,privateEditor,input=process.stdin,stdout=process.stdout,controlFactory=nativeDetailControl,exporter=exportStaticPublication}){
 const pipe=nativeDetailPipe(input,{origin,publicationId}),signal=AbortSignal.any([pipe.signal,AbortSignal.timeout(120000)]);let startup,control,finished=false;
 const send=async value=>{
  signal.throwIfAborted();const bytes=Buffer.from(JSON.stringify(value));if(!bytes.length||bytes.length>1024)throw Error('NATIVE_DETAIL_FRAME');const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32BE(bytes.length);bytes.copy(frame,4);
  await new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;signal.removeEventListener('abort',abort);stdout.removeListener('error',fail);error?reject(error):resolve();},abort=()=>finish(Error('NATIVE_DETAIL_CANCELLED')),fail=()=>finish(Error('NATIVE_DETAIL_OUTPUT'));signal.addEventListener('abort',abort,{once:true});stdout.once('error',fail);if(signal.aborted){abort();return;}stdout.write(frame,error=>finish(error));});signal.throwIfAborted();
 };
 try{
  startup=await pipe.takeStartup();signal.throwIfAborted();control=controlFactory(startup,signal);await control.prepare();signal.throwIfAborted();
  const receipt=await exporter({origin,publicationId,runtimeRoot,output,privateEditor,signal});signal.throwIfAborted();
  if(receipt.publicationId!==publicationId||receipt.revisionSha256!==startup.revisionSha256||!/^[a-f0-9]{64}$/.test(receipt.manifestSha256))throw Error('NATIVE_DETAIL_RECEIPT');
  // The exporter has awaited all writes and closes before returning. Manager
  // verifies and fsyncs through its pinned descriptors after this boundary.
  const ack=pipe.expectAck(startup.jobId,receipt.manifestSha256);
  await send({version:1,kind:'staged',jobId:startup.jobId,manifestSha256:receipt.manifestSha256});await ack;signal.throwIfAborted();
  await control.finalCheck();await control.settled();signal.throwIfAborted();
  await send({version:1,kind:'ready',jobId:startup.jobId,manifestSha256:receipt.manifestSha256});signal.throwIfAborted();pipe.finish();finished=true;
 }finally{
  if(!finished&&control){try{await control.close(AbortSignal.timeout(5000));}catch{/* Manager must retain the reservation until cleanup is proved. */}}
  if(startup){startup.sessionToken='';startup.csrfToken='';}input.destroy();
 }
}
