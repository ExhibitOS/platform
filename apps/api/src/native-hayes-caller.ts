// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {BlobStore} from '@exhibitos/storage';
import {sha256} from '@exhibitos/storage';
import {ApiError,Auth} from './auth.ts';
import {createHayesOriginalQuarantine,isHayesOriginalContext,openHayesOriginalAttempt,revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
import {prepareHayesOwnerExchange} from './hayes-owner-exchange.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

type Channel={send(frame:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>;isOpen():boolean};
type Credentials={token:string|undefined;csrf:string|undefined};
type Intake={artworkId:string;artworkRevision:number;displayReferenceSha256:string;idempotencyKey:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const claimedChannels=new WeakSet<object>();
const issuedCallers=new WeakMap<object,{owner:NativeOexWorkspaceContext;blobs:BlobStore}>();
export function isIssuedNativeHayesCaller(value:unknown,owner:NativeOexWorkspaceContext|undefined,blobs:BlobStore|undefined):boolean{const issued=value&&typeof value==='object'?issuedCallers.get(value):undefined;return !!issued&&issued.owner===owner&&issued.blobs===blobs;}
/** Internal native bootstrap only: `channel`, pin and assertLive come from the
 * same authenticated Manager session, never a request. This cannot authorize
 * output approval, drain, cleanup or publication. */
export function createNativeHayesCaller(input:{owner:NativeOexWorkspaceContext;auth:Auth;blobs:BlobStore;channel:Channel;runtimeGeneration:string;nativeOwnerId:string;runtimeManifestSha256:string;signal:AbortSignal;assertLive:()=>Promise<void>}){
 const {owner,auth,blobs,channel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal,assertLive}=input;
 if(!isHayesOriginalContext(owner)||!(auth instanceof Auth)||!blobs.getBounded||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof channel.isOpen!=='function'||!uuid.test(runtimeGeneration)||!uuid.test(nativeOwnerId)||!hex.test(runtimeManifestSha256)||!signal||typeof assertLive!=='function'||claimedChannels.has(channel)||!channel.isOpen())throw new ApiError(403,'FORBIDDEN');
 claimedChannels.add(channel);
 let used=false,busy=false,closing:Promise<void>|undefined;const localAbort=new AbortController(),fenceSignal=AbortSignal.any([signal,localAbort.signal]);
 const live=async()=>{fenceSignal.throwIfAborted();if(!channel.isOpen())throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');await assertLive();fenceSignal.throwIfAborted();if(!channel.isOpen())throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
 const close=()=>closing??=(async()=>{localAbort.abort();let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(()=>channel.close()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('HAYES_OWNER_CLOSE_UNCERTAIN')),3000);})]);}finally{if(timer)clearTimeout(timer);}})();
 const sharedChannel:Channel={send:frame=>channel.send(frame),receive:()=>channel.receive(),isOpen:()=>channel.isOpen(),close};
 const caller=Object.freeze({
  async create(credentials:Credentials,intake:Intake,deadlineMs:number){
   if(used||busy)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');busy=true;
   try{return await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>{if(s.userId!==owner.principalId)throw new ApiError(403,'FORBIDDEN');await live();const result=await createHayesOriginalQuarantine(c,s,owner,intake);await live();return result;});}finally{busy=false;}
  },
  async start(credentials:Credentials,selection:{jobId:string;artworkId:string;artworkRevision:number},deadlineMs:number){
   if(used||busy)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');busy=true;let source:Buffer|undefined,authorized=false;
   try{
    const binding=parseHayesOperationBinding({version:1,tenantId:owner.tenantId,workspaceId:owner.workspaceId,principalId:owner.principalId,jobId:selection.jobId,leaseId:randomUUID(),attemptId:randomUUID(),runtimeGeneration,artworkId:selection.artworkId,correlationId:randomUUID(),artworkRevision:selection.artworkRevision,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096});
    await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(_c,s)=>{if(s.userId!==owner.principalId)throw new ApiError(403,'FORBIDDEN');});authorized=true;used=true;
    await live();await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>openHayesOriginalAttempt(c,s,owner,blobs,binding,live));
    await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>{
     await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
     const job=await c.query("SELECT object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND hayes_attempt_id=$4 AND lease_until>clock_timestamp() FOR UPDATE",[binding.tenantId,binding.jobId,binding.leaseId,binding.attemptId]);if(job.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
     source=Buffer.from(await blobs.getBounded!(job.rows[0].object_key,binding.sourceBytes));if(source.length!==binding.sourceBytes||sha256(source)!==binding.sourceSha256)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
     await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
    });
    if(!source)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
    return await prepareHayesOwnerExchange({binding,nativeOwnerId,runtimeManifestSha256,channel:sharedChannel,source,signal:fenceSignal,deadlineMs,revalidateCommitted:()=>auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live))});
   }catch(cause){if(authorized)try{await close();}catch{throw new Error('HAYES_OWNER_CLOSE_UNCERTAIN',{cause});}throw cause;}finally{source?.fill(0);busy=false;}
  },
  close,
 });
 issuedCallers.set(caller,{owner,blobs});return caller;
}

export type NativeHayesCaller=ReturnType<typeof createNativeHayesCaller>;
