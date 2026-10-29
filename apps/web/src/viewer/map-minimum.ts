// SPDX-License-Identifier: AGPL-3.0-or-later
/** Borrow the existing scheduler's minimum. Pins prevent eviction only; they
 * never reserve extra bytes or bypass the scheduler's admission checks.
 */
export async function retainMapMinimum(options:{id:string;signal:AbortSignal;pins:Map<string,number>;waiters:Set<()=>void>;ready:()=>boolean;failed:()=>boolean;request:()=>void}) {
 const {id,signal,pins,waiters}=options;signal.throwIfAborted();
 pins.set(id,(pins.get(id)??0)+1);let released=false;
 const release=()=>{if(released)return;released=true;signal.removeEventListener('abort',release);const count=(pins.get(id)??1)-1;if(count>0)pins.set(id,count);else pins.delete(id);};
 signal.addEventListener('abort',release,{once:true});
 try {
  await new Promise<void>((resolve,reject)=>{
   let ended=false;
   const finish=(error?:Error)=>{if(ended)return;ended=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);waiters.delete(check);if(error)reject(error);else resolve();};
   const cancel=()=>finish(Error('MAP_VISIT_CANCELLED'));
   const check=()=>{if(signal.aborted)cancel();else if(options.ready())finish();else if(options.failed())finish(Error('MAP_MINIMUM_UNAVAILABLE'));};
   const timer=setTimeout(()=>finish(Error('MAP_MINIMUM_TIMEOUT')),10000);
   signal.addEventListener('abort',cancel,{once:true});waiters.add(check);
   try{options.request();check();}catch{finish(Error('MAP_MINIMUM_UNAVAILABLE'));}
  });
  signal.throwIfAborted();return release;
 }catch(error){release();throw error;}
}
