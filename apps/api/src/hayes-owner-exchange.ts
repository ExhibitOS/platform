// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHayesOwnerControl} from './hayes-owner-control.ts';
import {createHayesOwnerTransfer} from './hayes-owner-transfer.ts';
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';

type Channel={send(frame:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};
/** Inactive channel sequencing only. The caller must own an authenticated
 * Manager session and a committed DB claim, and the callback must return only
 * after the fresh fenced DB transaction commits. A closed channel is not a
 * drain or disposition receipt. */
export async function prepareHayesOwnerExchange(input:{binding:unknown;nativeOwnerId:string;runtimeManifestSha256:string;channel:Channel;source:Buffer;signal:AbortSignal;deadlineMs:number;revalidateCommitted:(binding:HayesOperationBinding)=>Promise<void>}){
 const binding=parseHayesOperationBinding(input.binding),raw=input.channel;let closing:Promise<void>|undefined;
 const channel:Channel={send:frame=>raw.send(frame),receive:()=>raw.receive(),close:()=>closing??=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(()=>raw.close()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('HAYES_EXCHANGE_CLOSE_UNCERTAIN')),3000);})]);}finally{if(timer)clearTimeout(timer);}})()};
 try{
  const control=createHayesOwnerControl({binding,nativeOwnerId:input.nativeOwnerId,runtimeManifestSha256:input.runtimeManifestSha256,channel,signal:input.signal,deadlineMs:input.deadlineMs,revalidateCommitted:input.revalidateCommitted});
  const transfer=createHayesOwnerTransfer({attemptId:binding.attemptId,correlationId:binding.correlationId,channel,signal:input.signal,deadlineMs:input.deadlineMs});
  await control.open();await transfer.sendSource(input.source);await control.revalidate();
  return Object.freeze({receiveOutput:()=>transfer.receiveOutput(),close:()=>channel.close()});
 }catch(cause){try{await channel.close();}catch{throw new Error('HAYES_EXCHANGE_CLOSE_UNCERTAIN',{cause});}throw cause;}
}
