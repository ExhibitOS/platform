// SPDX-License-Identifier: AGPL-3.0-or-later
/** Private in-runtime accounting for one owner's bounded detail exports.
 * Callers must authenticate and recheck native owner/database identity before
 * constructing Scope; this registry is not an authorization mechanism. */
export interface NativeDetailScope {
 runtimeGeneration:string;workspaceId:string;tenantId:string;principalId:string;sessionId:string;
 publicationId:string;revisionSha256:string;jobId:string;
}
type State='pending'|'settled-success'|'settled-failure'|'uncertain';
type Entry={scope:NativeDetailScope;closing:boolean;failed:boolean;uncertain:boolean;prepared:boolean;finalized:boolean;active:Set<Promise<unknown>>;controllers:Set<AbortController>};
const id=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fields=['runtimeGeneration','workspaceId','tenantId','principalId','sessionId','publicationId','revisionSha256','jobId'] as const;
function valid(scope:NativeDetailScope){return !!scope&&Object.keys(scope).length===fields.length&&fields.every(k=>typeof scope[k]==='string'&&(k==='revisionSha256'?digest:id).test(scope[k]));}
function same(a:NativeDetailScope,b:NativeDetailScope){return fields.every(k=>a[k]===b[k]);}

export class NativeDetailOperations {
 private readonly entries=new Map<string,Entry>();
 private shuttingDown=false;
 private entry(scope:NativeDetailScope,create:boolean):Entry {
  if(!valid(scope)||this.shuttingDown)throw Error('NATIVE_DETAIL_UNAVAILABLE');
  let entry=this.entries.get(scope.jobId);
  if(entry&&!same(entry.scope,scope))throw Error('NATIVE_DETAIL_UNAVAILABLE');
  if(!entry){if(!create||this.entries.size>=128)throw Error('NATIVE_DETAIL_UNAVAILABLE');entry={scope:{...scope},closing:false,failed:false,uncertain:false,prepared:false,finalized:false,active:new Set(),controllers:new Set()};this.entries.set(scope.jobId,entry);}
  return entry;
 }
 /** Close-before-prepare creates a non-evicting tombstone under the same key. */
 close(scope:NativeDetailScope){const entry=this.entry(scope,true);if(entry.finalized&&!entry.active.size)return;entry.closing=true;entry.failed=true;for(const controller of entry.controllers)controller.abort();}
 status(scope:NativeDetailScope):State {
  const entry=this.entry(scope,false);
  if(entry.uncertain)return 'uncertain';
  if(!entry.closing||entry.active.size)return 'pending';
  return !entry.failed&&entry.finalized?'settled-success':'settled-failure';
 }
 /** work and its cleanup both remain charged until cleanup actually settles. */
 async run<T>(scope:NativeDetailScope,phase:'prepare'|'bytes'|'final',work:(signal:AbortSignal)=>Promise<T>,cleanup:()=>Promise<void>):Promise<T>{
  const entry=this.entry(scope,phase==='prepare');
  if(entry.closing||entry.failed||entry.active.size!==0||(phase==='prepare'?entry.prepared:!entry.prepared))throw Error('NATIVE_DETAIL_UNAVAILABLE');
  if(phase==='final')entry.closing=true;
  const controller=new AbortController();entry.controllers.add(controller);
  // Install the promise in active before any caller-controlled callback can
  // reenter the registry or start runtime shutdown.
  const task=Promise.resolve().then(async()=>{
   let result:T|undefined,failure:unknown,failed=false;
   try{controller.signal.throwIfAborted();result=await work(controller.signal);controller.signal.throwIfAborted();}
   catch(error){failed=true;failure=error;entry.failed=true;for(const other of entry.controllers)other.abort();}
   try{await cleanup();}catch(error){entry.uncertain=true;entry.failed=true;failed=true;failure=error;}finally{entry.controllers.delete(controller);}
   if(!failed&&controller.signal.aborted){failed=true;failure=controller.signal.reason;entry.failed=true;}
   if(failed)throw failure;
   if(phase==='prepare')entry.prepared=true;if(phase==='final')entry.finalized=true;
   return result as T;
  });
  entry.active.add(task);
  try{const result=await task;if(entry.failed)throw Error('NATIVE_DETAIL_UNAVAILABLE');return result;}finally{entry.active.delete(task);}
 }
 /** Runtime close refuses new work, requests cancellation and awaits real
  * settlement; caller must preserve ownership if any scope cannot settle. */
 async closeRuntime(){this.shuttingDown=true;for(const entry of this.entries.values()){entry.closing=true;entry.failed=true;for(const controller of entry.controllers)controller.abort();}await Promise.allSettled([...this.entries.values()].flatMap(entry=>[...entry.active]));return [...this.entries.values()].every(entry=>!entry.uncertain&&entry.active.size===0);}
}
