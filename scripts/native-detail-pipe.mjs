// SPDX-License-Identifier: AGPL-3.0-or-later
import {parseStaticJson} from '../apps/web/src/static-json.mjs';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{64}$/;
const secret=/^[A-Za-z0-9_-]{43}$/;
const closed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const startupKeys=['version','jobId','runtimeGeneration','workspaceId','tenantId','principalId','publicationId','revisionSha256','origin','sessionToken','csrfToken'];

/** Owned native detail protocol only. Unexpected input/EOF aborts the signal;
 * an ACK may be expected only after startup and before sending STAGED. */
export function nativeDetailPipe(input,expected){
 const controller=new AbortController(),buffer=Buffer.alloc(4100);let phase='startup',used=0,done=false,ack,failAck,startupJob;
 let resolveStart,rejectStart,startup=new Promise((resolve,reject)=>{resolveStart=resolve;rejectStart=reject;});startup.catch(()=>{});
 const fail=()=>{if(done)return;done=true;clearTimeout(timer);buffer.fill(0);used=0;controller.abort();rejectStart?.(Error('NATIVE_DETAIL_PIPE'));resolveStart=undefined;rejectStart=undefined;failAck?.(Error('NATIVE_DETAIL_PIPE'));failAck=undefined;ack=undefined;input.destroy();};
 let timer=setTimeout(fail,5000);timer.unref?.();
 function received(chunk){
  if(done){if(Buffer.isBuffer(chunk))chunk.fill(0);return;}
  if(!Buffer.isBuffer(chunk)){fail();return;}
  if(phase==='idle'||phase==='ready'||used+chunk.length>(phase==='startup'?4100:1028)){chunk.fill(0);fail();return;}
  // The native pipe gives this handler exclusive ownership of each chunk.
  chunk.copy(buffer,used);used+=chunk.length;chunk.fill(0);if(used<4)return;
  const length=buffer.readUInt32BE(0),limit=phase==='startup'?4096:1024;
  if(!length||length>limit){fail();return;}if(used<length+4)return;
  if(used!==length+4){fail();return;}
  let value;try{value=parseStaticJson(buffer.subarray(4,used),limit);}catch{fail();return;}buffer.fill(0);used=0;
  if(phase==='startup'){
   let origin;try{origin=new URL(value.origin);}catch{fail();return;}
   if(!closed(value,startupKeys)||value.version!==1||!['jobId','runtimeGeneration','workspaceId','tenantId','principalId','publicationId'].every(k=>typeof value[k]==='string'&&uuid.test(value[k]))||typeof value.revisionSha256!=='string'||!sha.test(value.revisionSha256)||typeof value.sessionToken!=='string'||!secret.test(value.sessionToken)||typeof value.csrfToken!=='string'||!secret.test(value.csrfToken)||typeof value.origin!=='string'||origin.origin!==value.origin||origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||value.origin!==expected.origin||value.publicationId!==expected.publicationId){fail();return;}
   clearTimeout(timer);startupJob=value.jobId;phase='idle';resolveStart(value);resolveStart=undefined;rejectStart=undefined;return;
  }
  if(phase!=='ack'||!closed(value,['version','kind','jobId','manifestSha256'])||value.version!==1||value.kind!=='verified-staging'||value.jobId!==ack.jobId||value.manifestSha256!==ack.manifestSha256){fail();return;}
  clearTimeout(timer);phase='ready';ack.resolve();ack=undefined;failAck=undefined;
 }
 input.on('data',received);input.once('end',fail);input.once('error',fail);input.once('close',fail);input.resume();
 return {takeStartup(){if(!startup)throw Error('NATIVE_DETAIL_PIPE');const result=startup;startup=undefined;return result;},signal:controller.signal,
  expectAck(jobId,manifestSha256){if(done||phase!=='idle'||jobId!==startupJob||!sha.test(manifestSha256))throw Error('NATIVE_DETAIL_PIPE');phase='ack';timer=setTimeout(fail,30000);timer.unref?.();const pending=new Promise((resolve,reject)=>{ack={jobId,manifestSha256,resolve};failAck=reject;});pending.catch(()=>{});return pending;},
  finish(){if(done||phase!=='ready')throw Error('NATIVE_DETAIL_PIPE');done=true;clearTimeout(timer);buffer.fill(0);input.off('data',received);input.off('end',fail);input.off('error',fail);input.off('close',fail);input.destroy();},
 };
}
