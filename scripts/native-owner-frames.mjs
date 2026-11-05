// SPDX-License-Identifier: AGPL-3.0-or-later
// Framing only; application validators supply operation authority and order.
// Prefetch at most two frames for the owner's bounded request/announcement bursts.
export function attachNativeOwnerFrames(socket,closed){
 const buffer=Buffer.alloc(8196),ready=[];
 let used=0,expected,partialDeadline,waiter,readTimer,paused=false,writing=false,writeFinish,failed=false;
 const err=()=>Error('NATIVE_OWNER_UNAVAILABLE');
 const fail=()=>{if(failed)return;failed=true;clearTimeout(readTimer);buffer.fill(0);for(const frame of ready)frame.body.fill(0);ready.length=0;const pending=waiter;waiter=undefined;pending?.reject(err());writeFinish?.(err());socket.destroy();};
 const deadline=()=>Math.min(...[partialDeadline,ready[0]?.deadline,waiter?.deadline].filter(value=>value!==undefined));
 const expired=()=>deadline()<=Date.now();
 const scheduleRead=()=>{clearTimeout(readTimer);const next=deadline();if(Number.isFinite(next))readTimer=setTimeout(fail,Math.max(0,next-Date.now()));};
 socket.on('error',fail);socket.on('end',fail);socket.on('close',fail);
 socket.on('data',part=>{
  if(failed)return;
  for(let offset=0;offset<part.length;){
   if(expired()){fail();return;}
   if(ready.length===2){fail();return;}
   if(used===0){partialDeadline=Date.now()+5000;if(waiter)waiter.deadline=undefined;}
   const end=expected===undefined?4:expected+4,count=Math.min(end-used,part.length-offset);
   part.copy(buffer,used,offset,offset+count);used+=count;offset+=count;
   if(expected===undefined&&used===4){expected=buffer.readUInt32BE(0);if(expected<1||expected>8192){fail();return;}}
   if(expected===undefined||used<expected+4)continue;
   if(expired()){fail();return;}
   const frame={body:Buffer.from(buffer.subarray(4,used)),deadline:partialDeadline};buffer.fill(0,0,used);used=0;expected=undefined;partialDeadline=undefined;
   if(waiter){const pending=waiter;waiter=undefined;pending.resolve(frame.body);}else ready.push(frame);
   if(ready.length===2){paused=true;socket.pause();}
  }
  scheduleRead();
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
   if(failed||socket.destroyed)return Promise.reject(err());if(waiter||expired()){fail();return Promise.reject(err());}
   if(ready.length){const value=ready.shift().body;scheduleRead();if(paused){paused=false;socket.resume();}return Promise.resolve(value);}
   return new Promise((resolve,reject)=>{waiter={resolve,reject,deadline:used===0&&waitMs>0?Date.now()+waitMs:undefined};scheduleRead();});
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
