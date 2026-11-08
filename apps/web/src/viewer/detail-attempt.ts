// SPDX-License-Identifier: AGPL-3.0-or-later
/** A candidate is either independently owned or only pinned from a scene.
 * The borrowed variant can never be sent to the owned-object disposer. */
export type DetailAttemptValue<T>={ownership:'owned'|'borrowed';value:T};
export interface DetailDrainReceipt {attemptId:string;generation:number;drained:true}
export interface DetailAttemptOptions<T>{
 attemptId:string;generation:number;isCurrent(generation:number):boolean;
 run(signal:AbortSignal):Promise<DetailAttemptValue<T>>;
 disposeOwned(value:T):Promise<void>;
 releaseBorrow(value:T):Promise<void>;
 /** Adapter must actually await reader, decoder and child callback settlement.
  * Resolving this callback is an adapter assertion, not automatic GPU proof. */
 drainChildren():Promise<void>;
 /** Only invoked after actual work and every cleanup callback succeeded. */
 releaseReservation():Promise<void>;
}
/** Scoped single attempt; never used by the current production loader yet.
 * Caller keeps the attempt alive through its visible lifetime, supplies an
 * honest ownership-specific disposal and a real asynchronous child drain,
 * and retains reservation accounting if drain rejects or never settles. */
function createDetailAttempt<T>(options:DetailAttemptOptions<T>){
 const controller=new AbortController();let closing=false,commitAttempted=false,staged=false,drainPromise:Promise<DetailDrainReceipt>|undefined;
 const work=Promise.resolve().then(()=>{controller.signal.throwIfAborted();if(!options.isCurrent(options.generation))throw Error('DETAIL_GENERATION_STALE');return options.run(controller.signal);}).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
 return {
  /** The callback may stage a render but must not publish it. True is only a
   * staging receipt; use canPublish synchronously at every actual exposure. */
  async tryCommit(commit:(value:T)=>boolean):Promise<boolean>{
   const result=await work;if(closing||controller.signal.aborted||commitAttempted||!options.isCurrent(options.generation))return false;
   if(!result.ok)throw result.error;
   if(result.value.ownership!=='owned'&&result.value.ownership!=='borrowed')throw Error('DETAIL_OWNERSHIP_INVALID');
   commitAttempted=true;const prepared=commit(result.value.value)===true;
   if(!prepared||closing||controller.signal.aborted||!options.isCurrent(options.generation))return false;staged=true;return true;
  },
  /** Check immediately before showing or resuming this exact attempt, without
   * an intervening await, task or microtask. This never grants source rights. */
  canPublish():boolean{return staged&&!closing&&!controller.signal.aborted&&options.isCurrent(options.generation);},
  /** Aborts immediately but acknowledges only after the underlying work and
   * all adapter-supplied cleanup have really settled. Repeated calls share the
   * same promise; failed/uncertain cleanup never releases the reservation. */
  drain():Promise<DetailDrainReceipt>{
   if(drainPromise)return drainPromise;closing=true;controller.abort();
   drainPromise=(async()=>{const result=await work;
    try{await options.drainChildren();}catch{throw Error('DETAIL_DRAIN_UNCONFIRMED');}
    try{if(result.ok){if(result.value.ownership==='owned')await options.disposeOwned(result.value.value);else if(result.value.ownership==='borrowed')await options.releaseBorrow(result.value.value);else throw Error('DETAIL_OWNERSHIP_INVALID');}}catch{throw Error('DETAIL_DRAIN_UNCONFIRMED');}
    await options.releaseReservation();return {attemptId:options.attemptId,generation:options.generation,drained:true};
   })();return drainPromise;
  },
 };
}

/** A detail surface uses one slot across close/reopen. A new attempt cannot
 * begin until the previous attempt has actually drained successfully. */
export function createDetailAttemptSlot<T>(){
 let active=false,lastGeneration=0;const identities=new Set<string>();
 return {start(options:DetailAttemptOptions<T>){
  if(active)throw Error('DETAIL_ATTEMPT_ACTIVE');
  if(!/^[\x21-\x7e]{1,128}$/.test(options.attemptId)||!Number.isSafeInteger(options.generation)||options.generation<1||options.generation<lastGeneration||identities.has(options.attemptId)||identities.size>=4096)throw Error('DETAIL_ATTEMPT_INVALID');
  active=true;lastGeneration=options.generation;identities.add(options.attemptId);const attempt=createDetailAttempt(options);let retirement:Promise<DetailDrainReceipt>|undefined;
  return {tryCommit:attempt.tryCommit,canPublish:attempt.canPublish,drain(){
   if(!retirement){let resolve!:(value:DetailDrainReceipt)=>void,reject!:(error:unknown)=>void;retirement=new Promise<DetailDrainReceipt>((ok,fail)=>{resolve=ok;reject=fail;});
    try{void attempt.drain().then(receipt=>{active=false;resolve(receipt);},reject);}catch(error){reject(error);}}
   return retirement;
  }};
 }};
}
