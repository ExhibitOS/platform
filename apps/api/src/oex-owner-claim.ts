// SPDX-License-Identifier: AGPL-3.0-or-later
import {PublicationAttempts,type ResourceClaimRequest} from './publication-attempt.ts';
import {PublicationDiskBudget,diskReservationReceiptDigest,type DiskReservationBinding} from './publication-disk-budget.ts';
import {matchesNativeOwnerBinding,nativeOwnerBindingDigest} from './native-owner-binding.ts';
import {parseNativeOwnerOperation} from './native-owner-protocol.ts';
import {sendOexReservationReceipt} from './oex-reservation-wire.ts';
import type {NativeOexDiagnostic} from './native-oex-diagnostic.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type CommittedLease={jobId:string;requestId:string;userId:string;leaseId:string;archiveBytes:number;archiveSha256:string};
type ClaimState={channel:Channel;journal:PublicationAttempts;provider:PublicationDiskBudget;workspaceId:string;principalId:string;jobId:string;verifyLive:()=>Promise<void>;signal:AbortSignal;readySent?:boolean;settlementStarted?:boolean};
const issued=new WeakMap<object,ClaimState>();
/** Only the original live channel/session context may continue this claim. */
export function assertOexOwnerClaimContext(bound:object,channel:Channel,signal:AbortSignal,workspaceId:string,principalId:string,jobId:string,verifyLive:()=>Promise<void>,journal:PublicationAttempts,provider:PublicationDiskBudget){
 const state=issued.get(bound);if(!state||state.channel!==channel||state.signal!==signal||state.workspaceId!==workspaceId||state.principalId!==principalId||state.jobId!==jobId||state.verifyLive!==verifyLive||state.journal!==journal||state.provider!==provider)throw Error('OEX_OWNER_CLAIM');
}
/** Persists the existing resource claim and provider reservation and binds
 * both to one authenticated Manager session. Caller must already hold the
 * actual workspace/PG operation fence, authorize the exact queued personal
 * job and independently validate the pinned stage root and its plan. Failures
 * deliberately retain any created claim/reservation; no recovery is implied. */
export async function bindOexOwnerClaim(input:{journal:PublicationAttempts;provider:PublicationDiskBudget;request:ResourceClaimRequest;rawOpen:Uint8Array;workspaceId:string;principalId:string;jobId:string;secret:Uint8Array;channel:Channel;verifyLive:()=>Promise<void>;signal:AbortSignal;diagnostic?:NativeOexDiagnostic}){
 const {journal,provider,channel,signal,workspaceId,principalId,jobId,verifyLive,diagnostic}=input;let secret:Buffer|undefined,abort:undefined|(()=>void);
 const live=async()=>{signal.throwIfAborted();await verifyLive();signal.throwIfAborted();};
 try{
  if(!(journal instanceof PublicationAttempts)||!(provider instanceof PublicationDiskBudget)||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof verifyLive!=='function'||!signal||!(input.secret instanceof Uint8Array)||input.secret.byteLength!==32)throw Error('OEX_OWNER_CLAIM');
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const request=structuredClone(input.request);secret=Buffer.from(input.secret);
  const open=parseNativeOwnerOperation(input.rawOpen);
  if(open.kind!=='claim-open'||request.operation!=='oex-import'||request.purpose!=='import'||open.workspaceId!==workspaceId||open.tenantId!==request.tenantId||open.jobId!==jobId||open.runtimeGeneration!==request.runtimeGeneration||request.userId!==principalId)throw Error('OEX_OWNER_CLAIM');
  await live();diagnostic?.step('claim-start');const handle=await journal.beginResourceClaim(provider,request);diagnostic?.step('claim-persisted');await live();
  const reservation=await provider.acquire('oex-import',request.owner,request.reservationId,request.plan);diagnostic?.step('reservation-acquired');await live();
  const binding:DiskReservationBinding={id:reservation.id,generation:reservation.generation,operation:'oex-import',owner:request.owner,plan:request.plan};
  const receipt=await provider.verifiedReceipt(binding),receiptDigest=diskReservationReceiptDigest(receipt);await live();
  const challenge={version:1,kind:'claim-challenge',correlationId:open.correlationId,workspaceId,tenantId:request.tenantId,principalId,runtimeGeneration:request.runtimeGeneration,jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest};
  await channel.send(Buffer.from(JSON.stringify(challenge)));await sendOexReservationReceipt(channel,receipt,open.correlationId,request.attemptId,receiptDigest);await live();
  const raw=await channel.receive();if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_OWNER_CLAIM');
  let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_OWNER_CLAIM');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_OWNER_CLAIM');const reply=value as Record<string,unknown>;
  const digest=nativeOwnerBindingDigest(secret,{workspaceId,tenantId:request.tenantId,principalId,runtimeGeneration:request.runtimeGeneration,jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest});
  const expected={version:1,kind:'claim-binding',correlationId:open.correlationId,runtimeGeneration:request.runtimeGeneration,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest,managerBindingDigest:digest};
  if(!matchesNativeOwnerBinding(digest,String(reply.managerBindingDigest))||source!==JSON.stringify(expected))throw Error('OEX_OWNER_CLAIM');
  await live();const record=await journal.bindReservation(provider,handle,binding,digest);diagnostic?.step('binding-persisted');await live();const verified=await journal.verifyResourceClaim(provider,handle);await live();
  if(verified.claimDigest!==handle.digest||verified.binding.receiptDigest!==receiptDigest||verified.binding.managerBindingDigest!==digest)throw Error('OEX_OWNER_CLAIM');
  const result=Object.freeze({handle,binding,receipt:record.receipt,receiptDigest,managerBindingDigest:digest,correlationId:open.correlationId});
  issued.set(result,{channel,journal,provider,workspaceId,principalId,jobId,verifyLive,signal});diagnostic?.step('binding-verified');return result;
 }catch(error){diagnostic?.fail(error,channel);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(abort)signal.removeEventListener('abort',abort);secret?.fill(0);}
}

/** After the lease transaction is known committed, send one claim-ready on
 * the exact channel that established the issued claim. verifyLease must read
 * the current authorized Session and exact processing lease from the DB;
 * unknown commit/lost Session must fail and retain all evidence. */
export async function sendOexClaimReady(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,lease:CommittedLease,verifyLease:(lease:Readonly<CommittedLease>)=>Promise<void>,diagnostic?:NativeOexDiagnostic){
 const state=issued.get(bound);if(!state||state.readySent||typeof verifyLease!=='function')throw Error('OEX_OWNER_CLAIM');state.readySent=true;
 const abort=()=>{void state.channel.close().catch(()=>{});};state.signal.addEventListener('abort',abort,{once:true});if(state.signal.aborted)abort();
 try{
  const data=Object.freeze(structuredClone(lease));state.signal.throwIfAborted();await state.verifyLive();await verifyLease(data);state.signal.throwIfAborted();
  const verified=await state.journal.verifyResourceClaim(state.provider,bound.handle),r=verified.claim;
  if(data.jobId!==state.jobId||data.userId!==state.principalId||data.userId!==r.userId||data.requestId!==r.requestId||data.archiveSha256!==r.sourceDigest||!Number.isSafeInteger(data.archiveBytes)||data.archiveBytes<1||data.archiveBytes>512*1024*1024||typeof data.leaseId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/.test(data.leaseId)||verified.binding.receiptDigest!==bound.receiptDigest||verified.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_OWNER_CLAIM');
  await state.verifyLive();await verifyLease(data);state.signal.throwIfAborted();
  const ready={version:1,kind:'claim-ready',correlationId:bound.correlationId,runtimeGeneration:r.runtimeGeneration,workspaceId:state.workspaceId,tenantId:r.tenantId,jobId:data.jobId,userId:data.userId,requestId:data.requestId,leaseId:data.leaseId,attemptId:r.attemptId,generation:r.generation,stageId:r.stageId,reservationId:r.reservationId,reservationGeneration:verified.binding.receipt.generation,archiveBytes:data.archiveBytes,archiveSha256:data.archiveSha256,sourceDigest:r.sourceDigest,reservationDigest:bound.receiptDigest,managerBindingDigest:bound.managerBindingDigest,profile:'bounded-file-v1',format:'1.0.0-draft.9'};
  await state.channel.send(Buffer.from(JSON.stringify(ready)));state.signal.throwIfAborted();return Object.freeze(ready);
 }catch(error){diagnostic?.fail(error,state.channel);await state.channel.close().catch(()=>{});throw error;}finally{state.signal.removeEventListener('abort',abort);}
}

type Identity={correlationId:string;attemptId:string;runtimeGeneration:string;generation:string;reservationId:string;reservationGeneration:string;receiptDigest:string};
type SettlementState={binding:DiskReservationBinding;claimDigest:string;verifyLive:()=>Promise<void>;signal:AbortSignal;channel:Channel;identity:Identity;consumed:boolean};
const authorities=new WeakMap<object,SettlementState>();
const canonicalSettlement=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
export type SelectedSettlementAuthority=Readonly<{readonly __selectedSettlement:unique symbol}>;
/** A live, one-use capability from the selected native channel, never a frame
 * supplied by an HTTP caller. The real owner holds the operation fence and
 * verifies exact DB/claim state and actual local drain before calling this. */
export async function requestSelectedSettlement(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,identity:Identity):Promise<SelectedSettlementAuthority>{
 const context=issued.get(bound);if(!context||!context.readySent||context.settlementStarted)throw Error('OEX_SELECTED_SETTLEMENT');context.settlementStarted=true;
 const {channel,verifyLive,signal}=context,binding=structuredClone(bound.binding);identity=structuredClone(identity);
 const verified=await context.journal.verifyResourceClaim(context.provider,bound.handle),r=verified.claim;
 if(identity.correlationId!==bound.correlationId||identity.attemptId!==r.attemptId||identity.runtimeGeneration!==r.runtimeGeneration||identity.generation!==r.generation||identity.reservationId!==r.reservationId||identity.reservationGeneration!==verified.binding.receipt.generation||identity.receiptDigest!==bound.receiptDigest||verified.claimDigest!==bound.handle.digest||verified.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_SELECTED_SETTLEMENT');
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/,hash=/^[a-f0-9]{64}$/;
 if(!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof verifyLive!=='function'||!signal||![identity.correlationId,identity.attemptId,identity.runtimeGeneration,identity.generation,identity.reservationId,identity.reservationGeneration].every(x=>uuid.test(x))||!hash.test(identity.receiptDigest)||!hash.test(bound.handle.digest)||binding.operation!=='oex-import'||binding.id!==identity.reservationId||binding.generation!==identity.reservationGeneration)throw Error('OEX_SELECTED_SETTLEMENT');
 const frame=(kind:string)=>({version:1,kind,...identity});
 try{
  signal.throwIfAborted();await verifyLive();signal.throwIfAborted();
  await channel.send(Buffer.from(JSON.stringify(frame('settle-check'))));
  const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_SELECTED_SETTLEMENT');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);if(text!==JSON.stringify(frame('settle-ready')))throw Error('OEX_SELECTED_SETTLEMENT');
  signal.throwIfAborted();await verifyLive();signal.throwIfAborted();
  const authority=Object.freeze({}) as SelectedSettlementAuthority;
  authorities.set(authority,{binding,claimDigest:bound.handle.digest,verifyLive,signal,channel,identity,consumed:false});return authority;
 }catch(error){await channel.close().catch(()=>{});throw error;}
}
export async function verifySelectedSettlement(authority:SelectedSettlementAuthority,binding:DiskReservationBinding,claimDigest:string){
 const state=authorities.get(authority);if(!state||state.consumed||state.claimDigest!==claimDigest||canonicalSettlement(state.binding)!==canonicalSettlement(binding))throw Error('OEX_SELECTED_SETTLEMENT');
 state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();
}
/** Revalidate the original live channel and exact issued binding. Consumption
 * is irreversible even on later error; a lost owner cannot retry this token. */
export async function consumeSelectedSettlement(authority:SelectedSettlementAuthority,binding:DiskReservationBinding,claimDigest:string){
 const state=authorities.get(authority);if(!state||state.consumed||state.claimDigest!==claimDigest||canonicalSettlement(state.binding)!==canonicalSettlement(binding))throw Error('OEX_SELECTED_SETTLEMENT');
 state.consumed=true;const revalidate=async()=>{state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();};await revalidate();return revalidate;
}
export async function revalidateSelectedSettlement(authority:SelectedSettlementAuthority){
 const state=authorities.get(authority);if(!state||!state.consumed)throw Error('OEX_SELECTED_SETTLEMENT');
 state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();
}
export async function sendSelectedSettlementReceipt(authority:SelectedSettlementAuthority){
 const state=authorities.get(authority);if(!state||!state.consumed)throw Error('OEX_SELECTED_SETTLEMENT');
 state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();
 await state.channel.send(Buffer.from(JSON.stringify({version:1,kind:'settle-receipt',...state.identity})));authorities.delete(authority);
}
