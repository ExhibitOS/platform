// SPDX-License-Identifier: AGPL-3.0-or-later
/** One instance per scene. It caps aggregate geometry and coalesces checks only
 * within the same authority scope; an interrupted decoder keeps its byte hold. */
export class OwnerPreviewBudget {
 private draws=0;private triangles=0;private active=0;
 private readonly checks=new Map<string,{controller:AbortController;waiters:Set<{resolve:()=>void;reject:(e:unknown)=>void;signal:AbortSignal;abort:()=>void}>;run:(signal:AbortSignal)=>Promise<void>;started:boolean}>();
 constructor(readonly tenantId:string,readonly fetcher:typeof fetch,private readonly maxDraws:number,private readonly maxTriangles:number,private readonly concurrency=1){if(!Number.isSafeInteger(maxDraws)||maxDraws<1||!Number.isSafeInteger(maxTriangles)||maxTriangles<1||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>2)throw Error('WORKSPACE_SCENE_BUDGET');}
 reserve(draws:number,triangles:number){if(!Number.isSafeInteger(draws)||draws<1||!Number.isSafeInteger(triangles)||triangles<0||this.draws+draws>this.maxDraws||this.triangles+triangles>this.maxTriangles)throw Error('WORKSPACE_SCENE_BUDGET');this.draws+=draws;this.triangles+=triangles;let released=false;return ()=>{if(!released){released=true;this.draws-=draws;this.triangles-=triangles;}};}
 check(key:string,signal:AbortSignal,run:(signal:AbortSignal)=>Promise<void>):Promise<void>{
  signal.throwIfAborted();let entry=this.checks.get(key);if(entry?.controller.signal.aborted)throw Error('WORKSPACE_AUTHORITY_DRAINING');if(!entry){entry={controller:new AbortController(),waiters:new Set(),run,started:false};this.checks.set(key,entry);}const current=entry;
  const promise=new Promise<void>((resolve,reject)=>{const waiter={resolve,reject,signal,abort:()=>{}};waiter.abort=()=>{if(!current.waiters.delete(waiter))return;signal.removeEventListener('abort',waiter.abort);reject(signal.reason);if(!current.waiters.size){current.controller.abort();if(!current.started)this.checks.delete(key);}};current.waiters.add(waiter);signal.addEventListener('abort',waiter.abort,{once:true});if(signal.aborted)waiter.abort();});this.pump();return promise;
 }
 private pump(){for(const [key,entry] of this.checks){if(this.active>=this.concurrency)return;if(entry.started||!entry.waiters.size)continue;entry.started=true;this.active++;void Promise.resolve().then(()=>entry.run(entry.controller.signal)).then(()=>this.finish(key,entry,true),error=>this.finish(key,entry,false,error));}}
 private finish(key:string,entry:{controller:AbortController;waiters:Set<{resolve:()=>void;reject:(e:unknown)=>void;signal:AbortSignal;abort:()=>void}>;run:(signal:AbortSignal)=>Promise<void>;started:boolean},ok:boolean,error?:unknown){if(this.checks.get(key)===entry)this.checks.delete(key);this.active--;for(const waiter of entry.waiters){waiter.signal.removeEventListener('abort',waiter.abort);if(ok)waiter.resolve();else waiter.reject(error);}entry.waiters.clear();this.pump();}
}
