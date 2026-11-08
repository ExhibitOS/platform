// SPDX-License-Identifier: AGPL-3.0-or-later
import {nativeDetailPipe} from './native-detail-pipe.mjs';
import {nativeDetailControl} from './native-detail-control.mjs';
import {isAbsolute} from 'node:path';
import {exportNativeDetailStage} from './export-static-publication.mjs';

/** Owner-bound protocol orchestration; the server remains source authority. */
export async function runNativeDetailExport({origin,publicationId,runtimeRoot,output,privateEditor,input=process.stdin,stdout=process.stdout,controlFactory=nativeDetailControl,exporter=exportNativeDetailStage,overallSignal=AbortSignal.timeout(120000)}){
 if(output!=='.'||typeof runtimeRoot!=='string'||!isAbsolute(runtimeRoot))throw Error('NATIVE_DETAIL_STAGE');
 const pipe=nativeDetailPipe(input,{origin,publicationId}),outputAbort=new AbortController(),signal=AbortSignal.any([pipe.signal,outputAbort.signal,overallSignal]);let startup,control,finished=false;
 // A Writable may emit error after its write callback, including after abort.
 // Keep this sink for the stream lifetime; it never captures credentials.
 stdout.on('error',()=>outputAbort.abort());
 const send=async value=>{
  signal.throwIfAborted();const bytes=Buffer.from(JSON.stringify(value));if(!bytes.length||bytes.length>1024)throw Error('NATIVE_DETAIL_FRAME');const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32BE(bytes.length);bytes.copy(frame,4);
  await new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;signal.removeEventListener('abort',abort);error?reject(error):resolve();},abort=()=>finish(Error('NATIVE_DETAIL_CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}stdout.write(frame,error=>{if(error)outputAbort.abort();finish(error);});});signal.throwIfAborted();
 };
 try{
  startup=await pipe.takeStartup();signal.throwIfAborted();control=controlFactory(startup,signal);const descriptors=await control.prepare();if(!Array.isArray(descriptors))throw Error('NATIVE_DETAIL_UNAVAILABLE');signal.throwIfAborted();
  const receipt=await exporter({origin,publicationId,runtimeRoot,output,privateEditor,signal,detail:{descriptors,readCandidate:entry=>control.readCandidate(entry)}});signal.throwIfAborted();
  if(receipt.publicationId!==publicationId||receipt.revisionSha256!==startup.revisionSha256||!/^[a-f0-9]{64}$/.test(receipt.manifestSha256))throw Error('NATIVE_DETAIL_RECEIPT');
  if(descriptors.length&&(!Array.isArray(receipt.detailPlan?.entries)||receipt.detailPlan.entries.length!==descriptors.length||descriptors.some(item=>!receipt.detailPlan.entries.some(entry=>entry.assetId===item.assetId&&entry.mime===item.mime))))throw Error('NATIVE_DETAIL_RECEIPT');
  // The exporter has awaited all writes and closes before returning. Manager
  // verifies and fsyncs through its pinned descriptors after this boundary.
  const ack=pipe.expectAck(startup.jobId,receipt.manifestSha256);
  await send({version:1,kind:'staged',jobId:startup.jobId,manifestSha256:receipt.manifestSha256});
  await new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('NATIVE_DETAIL_CANCELLED'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}ack.then(()=>{signal.removeEventListener('abort',abort);resolve();},error=>{signal.removeEventListener('abort',abort);reject(error);});});signal.throwIfAborted();
  await control.finalCheck(receipt.detailPlan);await control.settled();signal.throwIfAborted();
  await send({version:1,kind:'ready',jobId:startup.jobId,manifestSha256:receipt.manifestSha256});signal.throwIfAborted();pipe.finish();finished=true;
 }finally{
  if(!finished&&control){try{await control.close(AbortSignal.timeout(5000));}catch{/* Manager must retain the reservation until cleanup is proved. */}}
  if(startup){startup.sessionToken='';startup.csrfToken='';}input.destroy();
 }
}
