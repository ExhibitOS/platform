// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Pool,PoolClient} from 'pg';
import {uuid} from './auth.ts';
import type {FileOperationIdentity,FileOperationHooks,FileOperationRunner} from './file-operation-contract.ts';
import {traceNativeOexSelected} from './native-oex-diagnostic.ts';
export type {FileOperationIdentity,FileOperationHooks} from './file-operation-contract.ts';

/** Internal prototype only. No route may enable this until a single shared
 * runtime owner implements durable claim, no-respawn, actual process/write
 * drain, reservation binding and crash reconciliation. Callbacks are trusted
 * component code, never request data; they must not control transactions or
 * leave asynchronous writes running after they resolve. */
function identitySnapshot(value:FileOperationIdentity):Readonly<FileOperationIdentity>{
 const keys=['operation','tenantId','resourceId','attemptId','generation'] as const;
 if(!value||typeof value!=='object'||Object.keys(value).length!==keys.length)throw Error('FILE_OPERATION_IDENTITY');
 const copy:Record<string,unknown>={};
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value' in d))throw Error('FILE_OPERATION_IDENTITY');copy[key]=d.value;}
 if(!['publication','oex-import','oex-export','oex-freeze'].includes(copy.operation as string))throw Error('FILE_OPERATION_IDENTITY');
 for(const key of keys.slice(1)){uuid(copy[key]);copy[key]=(copy[key] as string).toLowerCase();}
 return Object.freeze(copy) as unknown as Readonly<FileOperationIdentity>;
}
const ownedPools=new WeakSet<Pool>();

/** Owns a bounded, dedicated, session-affine pool. It never retires durable
 * receipts, stages or reservations: a separate recovery owner must reconcile
 * actual outcome and independently established drain. */
export class FileOperationLifecycle implements FileOperationRunner {
 private active=0;
 private readonly pool:Pool;
 private readonly capacity:number;
 private readonly finalTimeoutMs:number;
 constructor(pool:Pool,capacity:number,finalTimeoutMs:number){
  if(!Number.isSafeInteger(capacity)||capacity<1||pool.options.max!==capacity||!Number.isSafeInteger(pool.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1||!Number.isSafeInteger(finalTimeoutMs)||finalTimeoutMs<1||finalTimeoutMs>30000)throw Error('FILE_OPERATION_POOL');
  if(ownedPools.has(pool))throw Error('FILE_OPERATION_POOL_OWNED');ownedPools.add(pool);
  this.pool=pool;this.capacity=capacity;this.finalTimeoutMs=finalTimeoutMs;
 }
 /** Preparation that needs its own DB transactions must use a distinct pool. */
 ownsPool(pool:Pool){return this.pool===pool;}
 async runOperation<TPrepared,TResult>(input:FileOperationIdentity,hooks:FileOperationHooks<TPrepared,TResult>,signal:AbortSignal):Promise<TResult>{
  const identity=identitySnapshot(input);signal.throwIfAborted();
  if(this.active>=this.capacity)throw Error('FILE_OPERATION_BUSY');
  this.active++;
  let client:PoolClient|undefined,locked=false,broken=false,inTransaction=false,committing=false,completed=false;
  const lost=new AbortController(),combined=AbortSignal.any([signal,lost.signal]);
  const disconnected=()=>{broken=true;lost.abort();};
  const transaction=async<T>(work:()=>Promise<T>):Promise<T>=>{
   try{await client!.query('BEGIN');inTransaction=true;}catch(error){broken=true;throw error;}
   try{
    await client!.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$1,true)",[`${this.finalTimeoutMs}ms`]);
    const result=await work();combined.throwIfAborted();committing=true;
    await client!.query('COMMIT');committing=false;inTransaction=false;return result;
   }catch(error){
    // A COMMIT error can have an unknown outcome. Never infer rollback or
    // retire durable evidence; destroy the session and leave reconciliation.
    if(committing){broken=true;throw Error('FILE_OPERATION_COMMIT_UNCERTAIN',{cause:error});}
    if(inTransaction){try{await client!.query('ROLLBACK');inTransaction=false;}catch{broken=true;}}
    throw error;
   }
  };
  try{
   client=await this.pool.connect();client.on('error',disconnected);combined.throwIfAborted();
   // Different operation kinds on the same canonical resource must contend.
   const key=`exhibitos:file-operation:${identity.tenantId}:${identity.resourceId}`;
   let result;try{result=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key]);}catch(error){broken=true;throw error;}
   if(result.rows[0]?.locked!==true){if(result.rows[0]?.locked!==false)broken=true;throw Error('FILE_OPERATION_BUSY');}locked=true;
   await hooks.claimPersistent(identity,combined);combined.throwIfAborted();
   await transaction(async()=>{
    await client!.query('SELECT pg_advisory_xact_lock_shared(82003)');
    await client!.query('SELECT pg_advisory_xact_lock_shared(82002)');
    await hooks.claim(client!,identity);
   });
   combined.throwIfAborted();const prepared=await hooks.prepare(identity,combined);
   combined.throwIfAborted();await hooks.confirmDrained(identity);combined.throwIfAborted();await hooks.verifyPersistentClaim(identity,combined);combined.throwIfAborted();
   const output=await transaction(async()=>{
    await client!.query('SELECT pg_advisory_xact_lock_shared(82003)');
    await client!.query('SELECT pg_advisory_xact_lock_shared(82002)');
    await hooks.checkFinal(client!,identity);combined.throwIfAborted();
    const output=await hooks.finalize(client!,identity,prepared);
    await hooks.checkBeforeCommit(client!,identity);combined.throwIfAborted();return output;
   });
   if(hooks.afterCommit)try{combined.throwIfAborted();await hooks.afterCommit(identity,output,combined);}catch(error){throw Error('FILE_OPERATION_POSTCOMMIT_FAILED',{cause:error});}
   completed=true;return output;
  }finally{
   if(client){
    if(locked&&!broken){if(identity.operation==='oex-import')traceNativeOexSelected('unlock-start');try{const r=await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked',[`exhibitos:file-operation:${identity.tenantId}:${identity.resourceId}`]);if(r.rows[0]?.unlocked!==true){broken=true;if(identity.operation==='oex-import')traceNativeOexSelected('unlock-failed');}else if(identity.operation==='oex-import')traceNativeOexSelected('unlock-returned');}catch{broken=true;if(identity.operation==='oex-import')traceNativeOexSelected('unlock-failed');}}else if(identity.operation==='oex-import')traceNativeOexSelected('unlock-skipped');
    client.removeListener('error',disconnected);client.release(broken);
   }
   this.active--;
   if(completed&&broken)throw Error('FILE_OPERATION_FENCE_RELEASE_UNCERTAIN');
  }
 }
}
