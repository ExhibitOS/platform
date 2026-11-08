// SPDX-License-Identifier: AGPL-3.0-or-later
/** Framing wait only. It does not parse a ready message or issue authority.
 * The native frame reader retains its independent five-second partial-frame
 * timeout. Only the caller's trusted absolute operation deadline controls idle.
 * Failure initiates close; the caller must still observe bounded owner closure
 * and retain custody. A rejected wait is not proof of worker drain. */
export async function waitHayesReadyFrame(channel:{receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>},signal:AbortSignal,deadlineMs:number):Promise<Uint8Array>{
 if(!channel||typeof channel.receive!=='function'||typeof channel.close!=='function')throw Error('HAYES_OWNER_UNAVAILABLE');
 let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
 try{
  if(!signal||!Number.isSafeInteger(deadlineMs))throw Error('HAYES_OWNER_UNAVAILABLE');
  signal.throwIfAborted();const remaining=deadlineMs-Date.now();if(remaining<=0||remaining>300000)throw Error('HAYES_OWNER_UNAVAILABLE');
  const cancelled=new Promise<never>((_,reject)=>{
   const stop=()=>reject(Error('HAYES_OWNER_UNAVAILABLE'));
   onAbort=stop;signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(stop,remaining);
  });
  const frame=await Promise.race([channel.receive(remaining),cancelled]);
  signal.throwIfAborted();if(Date.now()>=deadlineMs)throw Error('HAYES_OWNER_UNAVAILABLE');return frame;
 }catch(error){void Promise.resolve().then(()=>channel.close()).catch(()=>{});throw error;}
 finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
