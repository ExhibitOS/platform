// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {FileBlobStore,type BlobStore} from '@exhibitos/storage';
import {sha256} from '@exhibitos/storage';
import {ApiError,Auth} from './auth.ts';
import {createHayesOriginalQuarantine,isHayesOriginalContext,isHayesDispositionContext,openHayesOriginalAttempt,revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';
import {prepareHayesOwnerExchange} from './hayes-owner-exchange.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import type {HayesReadyScope} from './hayes-ready-authority.ts';
import {decodeHayesReadyFrame} from './hayes-ready-frame.ts';
import {waitHayesReadyFrame} from './hayes-ready-wait.ts';
import {hayesReservationFrame} from './hayes-output-reservation-frame.ts';
import {reserveHayesOutput} from './hayes-output-reservation.ts';
import {storeHayesOutput} from './hayes-output-storage.ts';
import {commitHayesDisposition} from './hayes-disposition-transaction.ts';
import {decodeHayesDispositionChallenge,encodeHayesDispositionNotice} from './hayes-disposition-notice-frame.ts';

type Channel={send(frame:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>;isOpen():boolean};
type Credentials={token:string|undefined;csrf:string|undefined};
type Intake={artworkId:string;artworkRevision:number;displayReferenceSha256:string;idempotencyKey:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const claimedChannels=new WeakSet<object>();
const issuedCallers=new WeakMap<object,{owner:NativeOexWorkspaceContext;blobs:BlobStore}>();
// Identities are minted only inside the selected authenticated caller below;
// raw frames, request data, or exported constructors cannot register one.
const readyIdentities=new WeakMap<object,{owner:NativeOexWorkspaceContext;blobs:BlobStore;scope:HayesReadyScope;valid:()=>boolean}>();
export function resolveHayesReady(admission:unknown,owner:NativeOexWorkspaceContext,blobs:BlobStore):HayesReadyScope{
 const state=admission&&typeof admission==='object'?readyIdentities.get(admission):undefined;
 if(!state||state.owner!==owner||state.blobs!==blobs||!state.valid()||state.scope.signal.aborted||Date.now()>=state.scope.deadlineMs)throw Error('HAYES_READY_NOT_ADMITTED');
 return state.scope;
}
export function isIssuedNativeHayesCaller(value:unknown,owner:NativeOexWorkspaceContext|undefined,blobs:BlobStore|undefined):boolean{const issued=value&&typeof value==='object'?issuedCallers.get(value):undefined;return !!issued&&issued.owner===owner&&issued.blobs===blobs;}
/** Internal native bootstrap only: `channel`, pin and assertLive come from the
 * same authenticated Manager session, never a request. This cannot authorize
 * output approval, drain, cleanup or publication. */
export function createNativeHayesCaller(input:{owner:NativeOexWorkspaceContext;auth:Auth;blobs:BlobStore;channel:Channel;runtimeGeneration:string;nativeOwnerId:string;runtimeManifestSha256:string;signal:AbortSignal;assertLive:()=>Promise<void>;onClaimCommitted?:(binding:HayesOperationBinding,monotonicNs:string)=>void;onProbePhase?:(phase:string,monotonicNs:string,code?:string)=>void}){
 const {owner,auth,blobs,channel,runtimeGeneration,nativeOwnerId,runtimeManifestSha256,signal,assertLive}=input;
 if(!isHayesOriginalContext(owner)||!(auth instanceof Auth)||!blobs.getBounded||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof channel.isOpen!=='function'||!uuid.test(runtimeGeneration)||!uuid.test(nativeOwnerId)||!hex.test(runtimeManifestSha256)||!signal||typeof assertLive!=='function'||claimedChannels.has(channel)||!channel.isOpen())throw new ApiError(403,'FORBIDDEN');
 claimedChannels.add(channel);
 let used=false,busy=false,closing:Promise<void>|undefined;const localAbort=new AbortController(),fenceSignal=AbortSignal.any([signal,localAbort.signal]);
 const report=(phase:string,code?:string)=>{try{input.onProbePhase?.(phase,process.hrtime.bigint().toString(),code);}catch{/* Diagnostics cannot change authority or protocol. */}};
 const category=(cause:unknown)=>{try{const value=cause&&typeof cause==='object'?(cause as {code?:unknown;message?:unknown}).code??(cause as {message?:unknown}).message:undefined;return typeof value==='string'&&['HAYES_OWNER_UNAVAILABLE','HAYES_SOURCE_CHANGED','HAYES_CONTROL_INVALID','HAYES_CONTROL_CLOSE_UNCERTAIN','HAYES_EXCHANGE_CLOSE_UNCERTAIN','HAYES_OWNER_CLOSE_UNCERTAIN','NATIVE_OWNER_UNAVAILABLE','AUTH_REQUIRED','FORBIDDEN','ABORT_ERR'].includes(value)?value:'OTHER';}catch{return 'OTHER';}};
 signal.addEventListener('abort',()=>report('owner-signal-aborted'),{once:true});
 localAbort.signal.addEventListener('abort',()=>report('local-close-aborted'),{once:true});
 const live=async()=>{fenceSignal.throwIfAborted();if(!channel.isOpen())throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');await assertLive();fenceSignal.throwIfAborted();if(!channel.isOpen())throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
 const close=()=>closing??=(async()=>{report('close-start');localAbort.abort();let timer:ReturnType<typeof setTimeout>|undefined,ok=false;try{await Promise.race([Promise.resolve().then(()=>channel.close()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('HAYES_OWNER_CLOSE_UNCERTAIN')),3000);})]);ok=true;}finally{if(timer)clearTimeout(timer);report('close-settled',ok?'OK':'FAILED');}})();
 let awaitingOpen=false,observedOpen=false;
 const sharedChannel:Channel={send:async frame=>{let kind='';if(input.onProbePhase&&!observedOpen)try{kind=JSON.parse(Buffer.from(frame).toString()).kind;}catch{/* Protocol validator owns errors. */}if(kind==='hayes-operation-open'){report('open-send-start');awaitingOpen=true;observedOpen=true;}await channel.send(frame);if(kind==='hayes-operation-open')report('open-send-finished');},receive:async(waitMs)=>{if(awaitingOpen)report('open-receive-start');try{const frame=await channel.receive(waitMs);if(awaitingOpen){report('open-receive-finished');awaitingOpen=false;}return frame;}catch(error){if(awaitingOpen)report('open-receive-failed',category(error));throw error;}},isOpen:()=>channel.isOpen(),close};
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
    await live();await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>openHayesOriginalAttempt(c,s,owner,blobs,binding,live,deadlineMs));input.onClaimCommitted?.(binding,process.hrtime.bigint().toString());
    report('source-recheck-start');await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>{
     await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
     const job=await c.query("SELECT object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND hayes_attempt_id=$4 AND lease_until>clock_timestamp() FOR UPDATE",[binding.tenantId,binding.jobId,binding.leaseId,binding.attemptId]);if(job.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
     source=Buffer.from(await blobs.getBounded!(job.rows[0].object_key,binding.sourceBytes));if(source.length!==binding.sourceBytes||sha256(source)!==binding.sourceSha256)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
     await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
    });
    report('source-recheck-committed');if(!source)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
    report('exchange-start');const exchange=await prepareHayesOwnerExchange({binding,nativeOwnerId,runtimeManifestSha256,channel:sharedChannel,source,signal:fenceSignal,deadlineMs,revalidateCommitted:()=>auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live))});
    if(!isHayesDispositionContext(owner))return exchange;
    // The selected path owns the channel exclusively. The opaque identity is
    // never returned to a caller, and each phase is replaced only after the
    // previous operation has completed unambiguously.
    if(!(blobs instanceof FileBlobStore))throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
    let phase:'new'|'running'|'copied'|'committing'|'committed'|'failed'='new',valid=true;
    let challengeExpected:{binding:HayesOperationBinding;nativeOwnerId:string;runtimeManifestSha256:string;readyFrameSha256:string;dbStageId:string}|undefined;
    let selectedIds:Readonly<{receiptId:string;originalAssetId:string;displayAssetId:string;derivativeId:string;rightsId:string}>|undefined;
    const admission=Object.freeze({}),invalidate=async(cause:unknown):Promise<never>=>{valid=false;phase='failed';try{await close();}catch{throw new Error('HAYES_OWNER_CLOSE_UNCERTAIN',{cause});}throw cause;};
    return Object.freeze({
     receiveOutput:async():Promise<{bytes:Buffer;sha256:string}>=>{throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');},
     async stageOutput(){
      if(phase!=='new')return await invalidate(new ApiError(409,'HAYES_OWNER_UNAVAILABLE'));phase='running';let output:Buffer|undefined;
      try{
       await live();const database=await auth.requestForHayesNativeMutation(credentials.token,owner.tenantId,credentials.csrf,{signal:fenceSignal,deadlineMs},async(c,s)=>{
        await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
        const rows=(await c.query("SELECT (pg_control_system()).system_identifier::text AS system_identifier,oid::text AS database_oid FROM pg_database WHERE datname=current_database()")).rows;
        if(rows.length!==1)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');return {systemIdentifier:String(rows[0].system_identifier),databaseOid:String(rows[0].database_oid)};
       });
       const expected={binding,nativeOwnerId,runtimeManifestSha256,database},raw=Buffer.from(await waitHayesReadyFrame(sharedChannel,fenceSignal,deadlineMs));
       await live();const ready=decodeHayesReadyFrame(raw,expected),dbStageId=randomUUID();
       const scope:HayesReadyScope=Object.freeze({binding,signal:fenceSignal,deadlineMs,phase:'ready',nativeOwnerId,runtimeManifestSha256,workerManifestSha256:String(ready.workerManifestSha256),nativeEvidenceSha256:String(ready.nativeEvidenceSha256),attestation:ready.attestation as Readonly<Record<string,unknown>>,database:Object.freeze(database),dbStageId,assertLive:live});
       const state={owner,blobs,scope,valid:()=>valid&&channel.isOpen()&&!fenceSignal.aborted};readyIdentities.set(admission,state);
       const reserved=await reserveHayesOutput({admission,auth,owner,blobs,token:credentials.token,csrf:credentials.csrf});
       await live();if(resolveHayesReady(admission,owner,blobs)!==scope)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
       state.scope=Object.freeze({...scope,phase:'reserved'});const frame=hayesReservationFrame(raw,expected,dbStageId);
       let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
       try{await Promise.race([sharedChannel.send(frame),new Promise<never>((_,reject)=>{onAbort=()=>reject(new ApiError(409,'HAYES_OWNER_UNAVAILABLE'));fenceSignal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(onAbort,Math.max(0,deadlineMs-Date.now()));})]);}finally{if(timer)clearTimeout(timer);fenceSignal.removeEventListener('abort',onAbort);}await live();
       const expectedOutput=scope.attestation.output as {bytes:number;sha256:string};const received=await exchange.receiveOutput(expectedOutput);output=received.bytes;
       await storeHayesOutput({admission,auth,owner,blobs,token:credentials.token,csrf:credentials.csrf,bytes:output});
       await live();state.scope=Object.freeze({...state.scope,phase:'copied'});challengeExpected={binding,nativeOwnerId,runtimeManifestSha256,readyFrameSha256:createHash('sha256').update(raw).digest('hex'),dbStageId};phase='copied';return reserved;
      }catch(cause){return await invalidate(cause);}finally{output?.fill(0);}
     },
     async commit(){
      if(phase!=='copied'||!challengeExpected)return await invalidate(new ApiError(409,'HAYES_OWNER_UNAVAILABLE'));phase='committing';
      try{
       const rawChallenge=await waitHayesReadyFrame(sharedChannel,fenceSignal,deadlineMs);await live();
       const challenge=decodeHayesDispositionChallenge(rawChallenge,challengeExpected);
       selectedIds=Object.freeze({receiptId:randomUUID(),originalAssetId:randomUUID(),displayAssetId:randomUUID(),derivativeId:randomUUID(),rightsId:randomUUID()});
       const result=await commitHayesDisposition({admission,auth,owner,blobs,token:credentials.token,csrf:credentials.csrf,...selectedIds});
       const checkDeadline=()=>{fenceSignal.throwIfAborted();if(Date.now()>=deadlineMs||!sharedChannel.isOpen())throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
       const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{checkDeadline();let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};try{
        const interrupted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new ApiError(409,'HAYES_OWNER_UNAVAILABLE'));fenceSignal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(onAbort,Math.max(0,deadlineMs-Date.now()));});
        const value=await Promise.race([Promise.resolve().then(()=>{checkDeadline();return operation();}),interrupted]);checkDeadline();return value;
       }finally{if(timer)clearTimeout(timer);fenceSignal.removeEventListener('abort',onAbort);}};
       await bounded(live);const frame=encodeHayesDispositionNotice(challenge,result);
       checkDeadline();await bounded(()=>sharedChannel.send(frame));checkDeadline();
       await bounded(live);checkDeadline();phase='committed';return result;
      }catch(cause){return await invalidate(cause);}
     },
     close:async()=>{valid=false;await close();},
    });
   }catch(cause){report('start-failed',category(cause));if(authorized)try{await close();}catch{throw new Error('HAYES_OWNER_CLOSE_UNCERTAIN',{cause});}throw cause;}finally{source?.fill(0);busy=false;}
  },
  close,
 });
 issuedCallers.set(caller,{owner,blobs});return caller;
}

export type NativeHayesCaller=ReturnType<typeof createNativeHayesCaller>;
