// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Pool,PoolClient} from 'pg';
import {uuid} from './auth.ts';

/** Inactive recovery building block. This acquires the same session lock as
 * FileOperationLifecycle; it does not establish owner identity, process drain,
 * durable settlement or permission to disclose any data. The callback must
 * verify all of those independently and never retain work past its return. */
export async function withWorkspaceOexRecoveryFence<T>(pool:Pool,identity:{tenantId:string;workspaceId:string},signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 if(!pool||!identity||typeof work!=='function'||!signal||typeof signal.throwIfAborted!=='function'||!Number.isSafeInteger(pool.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1||!Number.isSafeInteger(pool.options.query_timeout)||!pool.options.query_timeout||pool.options.query_timeout<1||pool.options.query_timeout>30000)throw Error('OEX_RECOVERY_FENCE');
 for(const value of [identity.tenantId,identity.workspaceId]){uuid(value);if(value!==value.toLowerCase())throw Error('OEX_RECOVERY_FENCE');}
 const key=`exhibitos:file-operation:${identity.tenantId}:${identity.workspaceId}`,lost=new AbortController(),combined=AbortSignal.any([signal,lost.signal]);let client:PoolClient|undefined,locked=false,broken=false,result:T|undefined,finished=false;
 const disconnected=()=>{broken=true;lost.abort();};
 try{
  combined.throwIfAborted();client=await pool.connect();client.on('error',disconnected);combined.throwIfAborted();
  let acquired;try{acquired=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key]);}catch(error){broken=true;throw error;}if(acquired.rows[0]?.locked!==true){if(acquired.rows[0]?.locked!==false)broken=true;throw Error('OEX_RECOVERY_FENCE_BUSY');}locked=true;combined.throwIfAborted();
  result=await work(combined);combined.throwIfAborted();try{await client.query('SELECT 1');}catch(error){broken=true;throw error;}combined.throwIfAborted();finished=true;
 }finally{
  if(client){if(locked&&!broken){try{const released=await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked',[key]);if(released.rows[0]?.unlocked!==true)broken=true;}catch{broken=true;}}client.removeListener('error',disconnected);client.release(broken);}
 }
 if(broken||!finished)throw Error('OEX_RECOVERY_FENCE_UNCERTAIN');combined.throwIfAborted();return result as T;
}
