// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
const used=new WeakSet<object>();
/** Corroborating Manager drain check only. Before calling, Node must itself
 * finish and reap every direct decoder and await all blob writes. Caller keeps
 * the same owned Session/fence/claim and rechecks them before COMMIT; this
 * response does not prove crash recovery or permit release. */
export async function requestOexOwnerDrain(channel:Channel,attemptId:string,verifyLive:()=>Promise<void>,signal:AbortSignal){
 let abort:undefined|(()=>void);
 try{
  if(!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof attemptId!=='string'||!uuid.test(attemptId)||typeof verifyLive!=='function'||!signal)throw Error('OEX_OWNER_DRAIN');
  if(used.has(channel))throw Error('OEX_OWNER_DRAIN');used.add(channel);
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  signal.throwIfAborted();await verifyLive();signal.throwIfAborted();const correlationId=randomUUID();
  await channel.send(Buffer.from(JSON.stringify({version:1,kind:'drain-check',correlationId,attemptId})));
  const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_OWNER_DRAIN');
  let source:string;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw Error('OEX_OWNER_DRAIN');}
  if(source!==JSON.stringify({version:1,kind:'drain-result',correlationId,attemptId,status:'drained'}))throw Error('OEX_OWNER_DRAIN');
  signal.throwIfAborted();await verifyLive();signal.throwIfAborted();
 }catch(error){if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(abort)signal.removeEventListener('abort',abort);}
}
