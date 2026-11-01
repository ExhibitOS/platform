// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive, single-flight transport only; it supplies no operation authority.
// The owner waits for hello ACK and a separate operation-ready signal. The
// latter is not implemented: an unread frame is discarded after five seconds.
export function attachNativeOwnerFrames(socket,closed){
 let buffer=Buffer.alloc(0),expected,ready,waiter,readTimer,writing=false,writeFinish,failed=false;
 const err=()=>Error('NATIVE_OWNER_UNAVAILABLE');
 const fail=()=>{if(failed)return;failed=true;clearTimeout(readTimer);buffer.fill(0);buffer=Buffer.alloc(0);ready?.fill(0);ready=undefined;const pending=waiter;waiter=undefined;pending?.reject(err());writeFinish?.(err());socket.destroy();};
 const startTimer=(delay=5000)=>{if(!readTimer)readTimer=setTimeout(fail,delay);};
 const clearRead=()=>{clearTimeout(readTimer);readTimer=undefined;};
 socket.on('error',fail);socket.on('end',fail);socket.on('close',fail);
 socket.on('data',part=>{
  if(failed||ready||buffer.length+part.length>8196){fail();return;}if(buffer.length===0&&waiter)clearRead();startTimer();buffer=Buffer.concat([buffer,part]);
  if(expected===undefined&&buffer.length>=4){expected=buffer.readUInt32BE(0);if(expected<1||expected>8192){fail();return;}}
  if(expected===undefined||buffer.length<expected+4)return;
  if(buffer.length!==expected+4){fail();return;}ready=Buffer.from(buffer.subarray(4));buffer.fill(0);buffer=Buffer.alloc(0);expected=undefined;
  if(waiter){const pending=waiter;waiter=undefined;const value=ready;ready=undefined;clearRead();pending.resolve(value);}
 });
 return Object.freeze({
  isOpen:()=>!failed&&!socket.destroyed,
  whenClosed:()=>closed.then(()=>{}),
  close:async()=>{fail();await closed;},
  // Trusted initial-selection caller may use zero for no idle deadline;
  // owner/socket loss still rejects. Once bytes arrive the five-second frame
  // deadline always applies; operational calls use their bounded waits.
  receive:(waitMs=5000)=>{
   if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>28800000){fail();return Promise.reject(err());}
   if(failed||socket.destroyed)return Promise.reject(err());if(waiter){fail();return Promise.reject(err());}
   if(ready){const value=ready;ready=undefined;clearRead();return Promise.resolve(value);}
   if(waitMs>0)startTimer(waitMs);return new Promise((resolve,reject)=>{waiter={resolve,reject};});
  },
  send:payload=>{
   if(failed||socket.destroyed||writing||!(payload instanceof Uint8Array)||payload.byteLength<1||payload.byteLength>8192){fail();return Promise.reject(err());}
   writing=true;const body=Buffer.from(payload),header=Buffer.alloc(4);header.writeUInt32BE(body.length);
   return new Promise((resolve,reject)=>{
    let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);writing=false;writeFinish=undefined;if(error||failed){fail();reject(err());}else resolve();};
    const timer=setTimeout(()=>finish(err()),5000);writeFinish=finish;try{socket.write(Buffer.concat([header,body]),finish);}catch(error){finish(error);}
   });
  },
 });
}
