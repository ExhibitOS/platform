// SPDX-License-Identifier: AGPL-3.0-or-later
import {isNativeOexFileFormat,type NativeOexFileFormat} from './oex-file-format.ts';
import {PublicationAttempts,consumeSelectedV3RetirementPermit,type SelectedV3RetirementPermit,type ResourceClaimRequest} from './publication-attempt.ts';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseOexPreflightReportV3} from './oex-preflight-report-v3.ts';
import {PublicationDiskBudget,diskReservationReceiptDigest,type DiskReservationBinding} from './publication-disk-budget.ts';
import {matchesNativeOwnerBinding,nativeOwnerBindingDigest} from './native-owner-binding.ts';
import {parseNativeOwnerOperation} from './native-owner-protocol.ts';
import {sendOexReservationReceipt} from './oex-reservation-wire.ts';
import type {NativeOexDiagnostic} from './native-oex-diagnostic.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type CommittedLease={archiveFormat?:NativeOexFileFormat|'1.0.0-draft.12';jobId:string;requestId:string;userId:string;leaseId:string;archiveBytes:number;archiveSha256:string};
type PackedFacts={correlationId:string;attemptId:string;runtimeGeneration:string;stageId:string;reportSha256:string;inputReservationId:string;inputReservationGeneration:string;inputReceiptDigest:string;outputReservationId:string|null;outputReservationGeneration:string|null;outputReceiptDigest:string|null;archiveBytes:number;archiveSha256:string;inputDevice:string;inputInode:string;packedBytes:number;manifestSha256:string};
type ClaimState={channel:Channel;journal:PublicationAttempts;provider:PublicationDiskBudget;workspaceId:string;principalId:string;jobId:string;verifyLive:()=>Promise<void>;signal:AbortSignal;variant:'v2'|'v3';readySent?:boolean;lease?:Readonly<CommittedLease>;preflightStarted?:boolean;verifyPreflight?:()=>Promise<void>;verifyCommittedPreflight?:()=>Promise<void>;packedFacts?:Readonly<PackedFacts>;packedStarted?:boolean;packedAccepted?:boolean;drainStarted?:boolean;drainGuard?:()=>Promise<void>;settlementStarted?:boolean};
const issued=new WeakMap<object,ClaimState>();
/** Only the original live channel/session context may continue this claim. */
export function assertOexOwnerClaimContext(bound:object,channel:Channel,signal:AbortSignal,workspaceId:string,principalId:string,jobId:string,verifyLive:()=>Promise<void>,journal:PublicationAttempts,provider:PublicationDiskBudget,variant?:'v2'|'v3'){
 const state=issued.get(bound);if(!state||state.channel!==channel||state.signal!==signal||state.workspaceId!==workspaceId||state.principalId!==principalId||state.jobId!==jobId||state.verifyLive!==verifyLive||state.journal!==journal||state.provider!==provider||variant!==undefined&&state.variant!==variant)throw Error('OEX_OWNER_CLAIM');
}
/** Persists the existing resource claim and provider reservation and binds
 * both to one authenticated Manager session. Caller must already hold the
 * actual workspace/PG operation fence, authorize the exact queued personal
 * job and independently validate the pinned stage root and its plan. Failures
 * deliberately retain any created claim/reservation; no recovery is implied. */
export async function bindOexOwnerClaim(input:{journal:PublicationAttempts;provider:PublicationDiskBudget;request:ResourceClaimRequest;rawOpen:Uint8Array;workspaceId:string;principalId:string;jobId:string;secret:Uint8Array;channel:Channel;verifyLive:()=>Promise<void>;signal:AbortSignal;diagnostic?:NativeOexDiagnostic;variant?:'v3'}){
 const {journal,provider,channel,signal,workspaceId,principalId,jobId,verifyLive,diagnostic}=input,variant=input.variant==='v3'?'v3':'v2';let secret:Buffer|undefined,abort:undefined|(()=>void);
 const live=async()=>{signal.throwIfAborted();await verifyLive();signal.throwIfAborted();};
 try{
  if(input.variant!==undefined&&input.variant!=='v3'||!(journal instanceof PublicationAttempts)||!(provider instanceof PublicationDiskBudget)||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||typeof verifyLive!=='function'||!signal||!(input.secret instanceof Uint8Array)||input.secret.byteLength!==32)throw Error('OEX_OWNER_CLAIM');
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const request=structuredClone(input.request);secret=Buffer.from(input.secret);
  const open=parseNativeOwnerOperation(input.rawOpen);
  if(open.kind!==(variant==='v3'?'claim-open-v3':'claim-open')||request.operation!=='oex-import'||request.purpose!=='import'||open.workspaceId!==workspaceId||open.tenantId!==request.tenantId||open.jobId!==jobId||open.runtimeGeneration!==request.runtimeGeneration||request.userId!==principalId)throw Error('OEX_OWNER_CLAIM');
  if(variant==='v3'&&(request.plan.length!==1||request.plan[0]!.root===request.owner.storeRoot||request.plan[0]!.root!==join(dirname(request.owner.storeRoot),`native-oex-stage-${request.runtimeGeneration}`)||!Number.isSafeInteger(request.plan[0]!.bytes)||request.plan[0]!.bytes<1||request.plan[0]!.bytes>512*1024*1024))throw Error('OEX_OWNER_CLAIM');
  await live();diagnostic?.step('claim-start');const handle=await journal.beginResourceClaim(provider,request);diagnostic?.step('claim-persisted');await live();
  const reservation=await provider.acquire('oex-import',request.owner,request.reservationId,request.plan);diagnostic?.step('reservation-acquired');await live();
  const binding:DiskReservationBinding={id:reservation.id,generation:reservation.generation,operation:'oex-import',owner:request.owner,plan:request.plan};
  const receipt=await provider.verifiedReceipt(binding),receiptDigest=diskReservationReceiptDigest(receipt);await live();
  const challenge={version:1,kind:variant==='v3'?'claim-challenge-v3':'claim-challenge',correlationId:open.correlationId,workspaceId,tenantId:request.tenantId,principalId,runtimeGeneration:request.runtimeGeneration,jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest};
  await channel.send(Buffer.from(JSON.stringify(challenge)));await sendOexReservationReceipt(channel,receipt,open.correlationId,request.attemptId,receiptDigest);await live();
  const raw=await channel.receive();if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_OWNER_CLAIM');
  let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_OWNER_CLAIM');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_OWNER_CLAIM');const reply=value as Record<string,unknown>;
  const digest=nativeOwnerBindingDigest(secret,{workspaceId,tenantId:request.tenantId,principalId,runtimeGeneration:request.runtimeGeneration,jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest});
  const expected={version:1,kind:variant==='v3'?'claim-binding-v3':'claim-binding',correlationId:open.correlationId,runtimeGeneration:request.runtimeGeneration,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:reservation.generation,claimDigest:handle.digest,receiptDigest,managerBindingDigest:digest};
  if(!matchesNativeOwnerBinding(digest,String(reply.managerBindingDigest))||source!==JSON.stringify(expected))throw Error('OEX_OWNER_CLAIM');
  await live();const record=await journal.bindReservation(provider,handle,binding,digest);diagnostic?.step('binding-persisted');await live();const verified=await journal.verifyResourceClaim(provider,handle);await live();
  if(verified.claimDigest!==handle.digest||verified.binding.receiptDigest!==receiptDigest||verified.binding.managerBindingDigest!==digest)throw Error('OEX_OWNER_CLAIM');
  const result=Object.freeze({handle,binding,receipt:record.receipt,receiptDigest,managerBindingDigest:digest,correlationId:open.correlationId});
  issued.set(result,{channel,journal,provider,workspaceId,principalId,jobId,verifyLive,signal,variant});diagnostic?.step('binding-verified');return result;
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
  if(!isNativeOexFileFormat(data.archiveFormat??'1.0.0-draft.9')||data.jobId!==state.jobId||data.userId!==state.principalId||data.userId!==r.userId||data.requestId!==r.requestId||data.archiveSha256!==r.sourceDigest||!Number.isSafeInteger(data.archiveBytes)||data.archiveBytes<1||data.archiveBytes>512*1024*1024||state.variant==='v3'&&(r.plan.length!==1||r.plan[0]!.bytes!==data.archiveBytes)||typeof data.leaseId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/.test(data.leaseId)||verified.binding.receiptDigest!==bound.receiptDigest||verified.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_OWNER_CLAIM');
  await state.verifyLive();await verifyLease(data);state.signal.throwIfAborted();
  const ready={version:1,kind:state.variant==='v3'?'claim-ready-v3':'claim-ready',correlationId:bound.correlationId,runtimeGeneration:r.runtimeGeneration,workspaceId:state.workspaceId,tenantId:r.tenantId,jobId:data.jobId,userId:data.userId,requestId:data.requestId,leaseId:data.leaseId,attemptId:r.attemptId,generation:r.generation,stageId:r.stageId,reservationId:r.reservationId,reservationGeneration:verified.binding.receipt.generation,archiveBytes:data.archiveBytes,archiveSha256:data.archiveSha256,sourceDigest:r.sourceDigest,reservationDigest:bound.receiptDigest,managerBindingDigest:bound.managerBindingDigest,profile:'bounded-file-v1',format:data.archiveFormat??'1.0.0-draft.9'};
  await state.channel.send(Buffer.from(JSON.stringify(ready)));state.signal.throwIfAborted();state.lease=data;return Object.freeze(ready);
 }catch(error){diagnostic?.fail(error,state.channel);await state.channel.close().catch(()=>{});throw error;}finally{state.signal.removeEventListener('abort',abort);}
}

/** v3-only same-channel preflight report and E reservation. Caller owns the
 * stage acceptance, Manager session/fence and actual child reap. A report is
 * Manager's assertion, not a provider lease, FD proof or cancellation proof.
 * On every error the channel closes and all claimed reservations are retained. */
export async function bindOexPreflightV3(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,input:{stage:Readonly<{stageDevice:string;stageInode:string}>;verifyStage:()=>Promise<void>;verifyLease:(lease:Readonly<CommittedLease>)=>Promise<void>}){
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.readySent||!state.lease||state.preflightStarted||!input||typeof input.verifyStage!=='function'||typeof input.verifyLease!=='function')throw Error('OEX_PREFLIGHT_BINDING');
 state.preflightStarted=true;const {channel,signal,journal,provider}=state,lease=state.lease,verifyStage=input.verifyStage,verifyLease=input.verifyLease;
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  if(!input.stage||typeof input.stage!=='object'||Reflect.ownKeys(input.stage).length!==2||['stageDevice','stageInode'].some(key=>{const d=Object.getOwnPropertyDescriptor(input.stage,key);return !d||!d.enumerable||!Object.hasOwn(d,'value');}))throw Error('OEX_PREFLIGHT_BINDING');
  const stage=Object.freeze({stageDevice:input.stage.stageDevice,stageInode:input.stage.stageInode});
  const ownerLive=async()=>{signal.throwIfAborted();await state.verifyLive();await verifyStage();const now=await journal.verifyResourceClaim(provider,bound.handle);if(now.claimDigest!==bound.handle.digest||now.binding.receiptDigest!==bound.receiptDigest||now.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_PREFLIGHT_BINDING');signal.throwIfAborted();return now;};
  const live=async()=>{await verifyLease(lease);return ownerLive();};
  const initial=await live(),r=initial.claim,stagePlan=initial.binding.receipt.plan[0];
  if(r.plan.length!==1||!stagePlan||stage.stageDevice!==stagePlan.device||typeof stage.stageInode!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(stage.stageInode)||lease.archiveBytes!==r.plan[0]!.bytes||lease.archiveSha256!==r.sourceDigest)throw Error('OEX_PREFLIGHT_BINDING');
  if(lease.archiveFormat!==undefined&&!isNativeOexFileFormat(lease.archiveFormat))throw Error('OEX_PREFLIGHT_BINDING');
  const raw=await channel.receive(300000);const report=parseOexPreflightReportV3(raw,{correlationId:bound.correlationId,attemptId:r.attemptId,runtimeGeneration:r.runtimeGeneration,stageId:r.stageId,reservationId:r.reservationId,reservationGeneration:initial.binding.receipt.generation,reservationDigest:bound.receiptDigest,archiveBytes:lease.archiveBytes,archiveSha256:lease.archiveSha256,inputDevice:stage.stageDevice,inputInode:stage.stageInode,...(lease.archiveFormat!==undefined?{archiveFormat:lease.archiveFormat}:{})});
  await live();const evidence=report.evidence;let output:DiskReservationBinding|null=null;
  if(evidence.packedBytes>0){const plan=[{root:r.plan[0]!.root,bytes:evidence.packedBytes},{root:r.owner.storeRoot,bytes:evidence.packedBytes}],reserved=await provider.acquire('oex-import',r.owner,randomUUID(),plan);output={id:reserved.id,generation:reserved.generation,operation:'oex-import',owner:r.owner,plan};}
  await live();const record=await journal.bindOexPreflightReservation(provider,bound.handle,evidence,output);await live();await journal.verifyOexPreflightReservation(provider,bound.handle);
  const response={version:1,kind:'preflight-bound-v3',correlationId:bound.correlationId,attemptId:r.attemptId,runtimeGeneration:r.runtimeGeneration,stageId:r.stageId,reportSha256:report.reportSha256,inputReceiptDigest:bound.receiptDigest,outputReservationId:record.outputReceipt?.id??null,outputReservationGeneration:record.outputReceipt?.generation??null,outputReceiptDigest:record.outputReceiptDigest,archiveBytes:evidence.archiveBytes,archiveSha256:evidence.archiveSha256,inputDevice:evidence.inputDevice,inputInode:evidence.inputInode,expandedBytes:evidence.expandedBytes,packedBytes:evidence.packedBytes,manifestSha256:evidence.manifestSha256,entryCount:evidence.entryCount};
  await channel.send(Buffer.from(JSON.stringify(response)));if(record.outputReceipt)await sendOexReservationReceipt(channel,record.outputReceipt,bound.correlationId,r.attemptId,record.outputReceiptDigest!);
  const expected={version:1,kind:'preflight-confirm-v3',correlationId:bound.correlationId,attemptId:r.attemptId,runtimeGeneration:r.runtimeGeneration,stageId:r.stageId,reportSha256:report.reportSha256,inputReceiptDigest:bound.receiptDigest,outputReceiptDigest:record.outputReceiptDigest};
  const confirmation=await channel.receive(30000);if(!(confirmation instanceof Uint8Array)||confirmation.byteLength<1||confirmation.byteLength>8192||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(confirmation)!==JSON.stringify(expected))throw Error('OEX_PREFLIGHT_BINDING');
  await live();const verified=await journal.verifyOexPreflightReservation(provider,bound.handle);if(verified.outputReceiptDigest!==record.outputReceiptDigest)throw Error('OEX_PREFLIGHT_BINDING');
  const snapshot=canonicalSettlement({evidence:record.evidence,outputReceiptDigest:record.outputReceiptDigest});
  state.verifyPreflight=async()=>{await live();const current=await journal.verifyOexPreflightReservation(provider,bound.handle);if(canonicalSettlement({evidence:current.evidence,outputReceiptDigest:current.outputReceiptDigest})!==snapshot)throw Error('OEX_PREFLIGHT_BINDING');await live();};
  state.verifyCommittedPreflight=async()=>{await ownerLive();const current=await journal.verifyOexPreflightReservation(provider,bound.handle);if(canonicalSettlement({evidence:current.evidence,outputReceiptDigest:current.outputReceiptDigest})!==snapshot)throw Error('OEX_PREFLIGHT_BINDING');await ownerLive();};
  state.packedFacts=Object.freeze({correlationId:bound.correlationId,attemptId:r.attemptId,runtimeGeneration:r.runtimeGeneration,stageId:r.stageId,reportSha256:report.reportSha256,inputReservationId:r.reservationId,inputReservationGeneration:initial.binding.receipt.generation,inputReceiptDigest:bound.receiptDigest,outputReservationId:record.outputReceipt?.id??null,outputReservationGeneration:record.outputReceipt?.generation??null,outputReceiptDigest:record.outputReceiptDigest,archiveBytes:evidence.archiveBytes,archiveSha256:evidence.archiveSha256,inputDevice:evidence.inputDevice,inputInode:evidence.inputInode,packedBytes:evidence.packedBytes,manifestSha256:evidence.manifestSha256});
  return Object.freeze({evidence:record.evidence,outputReceipt:record.outputReceipt,outputReceiptDigest:record.outputReceiptDigest,reportSha256:report.reportSha256});
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}

/** Only a confirmed preflight on the original issued channel can be reused.
 * This checks both provider reservations and the caller's retained owner,
 * lease and stage guards; a report or a copied object is not a capability. */
export async function verifyOexPreflightV3(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>){
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.verifyPreflight)throw Error('OEX_PREFLIGHT_BINDING');
 await state.verifyPreflight();
}
/** After DB commit, the processing lease is terminal. Caller must separately
 * verify the exact committed DB result and retained Session/fence. */
export async function verifyCommittedOexPreflightV3(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>){
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.verifyCommittedPreflight)throw Error('OEX_PREFLIGHT_BINDING');await state.verifyCommittedPreflight();
}
/** Retained correlation for the selected save exchange; not save or release
 * authority. It is available only after the original v3 report was confirmed. */
export function selectedV3Correlation(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>){
 const state=issued.get(bound),f=state?.packedFacts;if(!state||state.variant!=='v3'||!f)throw Error('OEX_OWNER_CLAIM');return Object.freeze({operationCorrelationId:f.correlationId,runtimeGeneration:f.runtimeGeneration,stageId:f.stageId,reportSha256:f.reportSha256});
}

/** Accept the Manager's pinned, empty output identity only after both actual
 * reservations and the retained owner are live. The identity is correlation,
 * not independent proof of an FD; Manager owns and checks that FD. */
export async function acceptOexPackedReadyV3(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>){
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.verifyPreflight||!state.packedFacts||state.packedStarted)throw Error('OEX_PACKED_READY');
 state.packedStarted=true;const {channel,signal}=state,f=state.packedFacts;
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  if(f.packedBytes===0?(f.outputReservationId!==null||f.outputReservationGeneration!==null||f.outputReceiptDigest!==null):(!f.outputReservationId||!f.outputReservationGeneration||!f.outputReceiptDigest))throw Error('OEX_PACKED_READY');
  await verifyOexPreflightV3(bound);const raw=await channel.receive(30000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_PACKED_READY');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PACKED_READY');
  const v=value as Record<string,unknown>,decimal=/^(0|[1-9][0-9]{0,23})$/;
  if(typeof v.outputDevice!=='string'||typeof v.outputInode!=='string'||!decimal.test(v.outputDevice)||!decimal.test(v.outputInode)||v.outputDevice!==f.inputDevice||v.outputInode===f.inputInode)throw Error('OEX_PACKED_READY');
  const expected={version:1,kind:'packed-ready-v3',correlationId:f.correlationId,attemptId:f.attemptId,runtimeGeneration:f.runtimeGeneration,stageId:f.stageId,reportSha256:f.reportSha256,inputReceiptDigest:f.inputReceiptDigest,outputReservationId:f.outputReservationId,outputReservationGeneration:f.outputReservationGeneration,outputReceiptDigest:f.outputReceiptDigest,archiveBytes:f.archiveBytes,archiveSha256:f.archiveSha256,inputDevice:f.inputDevice,inputInode:f.inputInode,outputDevice:v.outputDevice,outputInode:v.outputInode,packedBytes:f.packedBytes,manifestSha256:f.manifestSha256};
  if(text!==JSON.stringify(expected))throw Error('OEX_PACKED_READY');await verifyOexPreflightV3(bound);signal.throwIfAborted();await channel.send(Buffer.from(JSON.stringify({...expected,kind:'packed-accepted-v3'})));signal.throwIfAborted();state.packedAccepted=true;return Object.freeze({outputDevice:v.outputDevice,outputInode:v.outputInode});
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}

/** Manager corroboration after the caller's own decoder and write drain. This
 * does not prove that drain or grant a commit/settlement/release capability. */
export async function requestOexOwnerDrainV3(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,verifyNodeDrain:()=>Promise<void>){
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.packedAccepted||!state.packedFacts||state.drainStarted||typeof verifyNodeDrain!=='function')throw Error('OEX_OWNER_DRAIN_V3');
 state.drainStarted=true;const {channel,signal}=state,f=state.packedFacts,checkDrain=verifyNodeDrain;
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  await verifyOexPreflightV3(bound);await checkDrain();signal.throwIfAborted();const correlationId=randomUUID();
  const frame={version:1,kind:'drain-check-v3',correlationId,operationCorrelationId:f.correlationId,attemptId:f.attemptId,runtimeGeneration:f.runtimeGeneration,stageId:f.stageId,reportSha256:f.reportSha256,inputReservationId:f.inputReservationId,inputReservationGeneration:f.inputReservationGeneration,inputReceiptDigest:f.inputReceiptDigest,outputReservationId:f.outputReservationId,outputReservationGeneration:f.outputReservationGeneration,outputReceiptDigest:f.outputReceiptDigest};
  await channel.send(Buffer.from(JSON.stringify(frame)));const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)!==JSON.stringify({...frame,kind:'drain-result-v3',status:'drained'}))throw Error('OEX_OWNER_DRAIN_V3');
  await checkDrain();await verifyOexPreflightV3(bound);signal.throwIfAborted();state.drainGuard=checkDrain;
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}

type Identity={correlationId:string;attemptId:string;runtimeGeneration:string;generation:string;reservationId:string;reservationGeneration:string;receiptDigest:string};
type SettlementState={binding:DiskReservationBinding;claimDigest:string;verifyLive:()=>Promise<void>;signal:AbortSignal;channel:Channel;identity:Identity;consumed:boolean};
const authorities=new WeakMap<object,SettlementState>();
const canonicalSettlement=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
type V3Save={exhibitionId:string;etag:string;requestId:string};
type V3AuthorityState={bindings:DiskReservationBinding[];claimDigest:string;jobId:string;verifyLive:()=>Promise<void>;assertCommitted:()=>Promise<void>;drainGuard:()=>Promise<void>;signal:AbortSignal;channel:Channel;frame:Record<string,unknown>;consumed:boolean;retirementRecorded:boolean;receiptStarted:boolean;receiptAcknowledged:boolean};
const v3Authorities=new WeakMap<object,V3AuthorityState>();
export type SelectedV3SettlementAuthority=Readonly<{readonly __selectedV3Settlement:unique symbol}>;
/** Issued only on the original confirmed v3 channel after real local drain,
 * a verified committed save, both live receipts and Manager's terminal guard.
 * A reply is corroboration; the caller retains its real operation fence. */
export async function requestSelectedV3Settlement(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,saveInput:V3Save,assertCommitted:()=>Promise<void>):Promise<SelectedV3SettlementAuthority>{
 const state=issued.get(bound);if(!state||state.variant!=='v3'||!state.drainGuard||!state.verifyCommittedPreflight||!state.packedFacts||state.settlementStarted||typeof assertCommitted!=='function')throw Error('OEX_V3_SETTLEMENT');
 state.settlementStarted=true;const {channel,signal}=state,f=state.packedFacts,drain=state.drainGuard,checkCommit=assertCommitted;
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  const save=structuredClone(saveInput);
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if(!save||Object.keys(save).sort().join(',')!=='etag,exhibitionId,requestId'||!uuid.test(save.exhibitionId)||!uuid.test(save.requestId)||!/^"studio-r[1-9][0-9]*-[0-9a-f]{64}"$/.test(save.etag))throw Error('OEX_V3_SETTLEMENT');
  await state.verifyCommittedPreflight();await drain();await checkCommit();const current=await state.journal.verifyOexPreflightReservation(state.provider,bound.handle),initial=await state.journal.verifyResourceClaim(state.provider,bound.handle),r=initial.claim;
  const receiptBinding=(receipt:NonNullable<typeof current.outputReceipt>):DiskReservationBinding=>({id:receipt.id,generation:receipt.generation,operation:receipt.operation,owner:structuredClone(receipt.owner),plan:receipt.plan.map(({root,bytes})=>({root,bytes}))});
  const bindings=[receiptBinding(initial.binding.receipt),...(current.outputReceipt?[receiptBinding(current.outputReceipt)]:[])];
  const frame={version:1,kind:'settle-check-v3',correlationId:randomUUID(),operationCorrelationId:f.correlationId,attemptId:f.attemptId,runtimeGeneration:f.runtimeGeneration,generation:r.generation,stageId:f.stageId,reportSha256:f.reportSha256,inputReservationId:f.inputReservationId,inputReservationGeneration:f.inputReservationGeneration,inputReceiptDigest:f.inputReceiptDigest,outputReservationId:f.outputReservationId,outputReservationGeneration:f.outputReservationGeneration,outputReceiptDigest:f.outputReceiptDigest,exhibitionId:save.exhibitionId,etag:save.etag,requestId:save.requestId};
  signal.throwIfAborted();await channel.send(Buffer.from(JSON.stringify(frame)));const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)!==JSON.stringify({...frame,kind:'settle-ready-v3'}))throw Error('OEX_V3_SETTLEMENT');
  await state.verifyCommittedPreflight();await drain();await checkCommit();signal.throwIfAborted();const authority=Object.freeze({}) as SelectedV3SettlementAuthority;
  v3Authorities.set(authority,{bindings:structuredClone(bindings),claimDigest:bound.handle.digest,jobId:state.jobId,verifyLive:state.verifyLive,assertCommitted:checkCommit,drainGuard:drain,signal,channel,frame,consumed:false,retirementRecorded:false,receiptStarted:false,receiptAcknowledged:false});return authority;
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}
export async function verifySelectedV3Settlement(authority:SelectedV3SettlementAuthority,bindings:DiskReservationBinding[],claimDigest:string,save:V3Save){
 const state=v3Authorities.get(authority);if(!state||state.consumed||state.claimDigest!==claimDigest||canonicalSettlement(state.bindings)!==canonicalSettlement(bindings)||state.frame.exhibitionId!==save.exhibitionId||state.frame.etag!==save.etag||state.frame.requestId!==save.requestId)throw Error('OEX_V3_SETTLEMENT');
 state.signal.throwIfAborted();await state.verifyLive();await state.drainGuard();await state.assertCommitted();state.signal.throwIfAborted();
}
export async function consumeSelectedV3Settlement(authority:SelectedV3SettlementAuthority,bindings:DiskReservationBinding[],claimDigest:string){
 const state=v3Authorities.get(authority);if(!state||state.consumed||state.claimDigest!==claimDigest||canonicalSettlement(state.bindings)!==canonicalSettlement(bindings))throw Error('OEX_V3_SETTLEMENT');
 state.consumed=true;const revalidate=async()=>{state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();};await revalidate();return revalidate;
}
export async function revalidateSelectedV3Settlement(authority:SelectedV3SettlementAuthority){
 const state=v3Authorities.get(authority);if(!state||!state.consumed)throw Error('OEX_V3_SETTLEMENT');state.signal.throwIfAborted();await state.verifyLive();state.signal.throwIfAborted();
}
export async function recordSelectedV3Retirement(authority:SelectedV3SettlementAuthority,claimDigest:string,permit:SelectedV3RetirementPermit){
 const state=v3Authorities.get(authority);if(!state||!state.consumed||state.retirementRecorded||state.claimDigest!==claimDigest)throw Error('OEX_V3_SETTLEMENT');consumeSelectedV3RetirementPermit(permit,authority,claimDigest);await revalidateSelectedV3Settlement(authority);state.retirementRecorded=true;
}
export async function finishSelectedV3Settlement(authority:SelectedV3SettlementAuthority){
 const state=v3Authorities.get(authority);if(!state||!state.consumed||!state.retirementRecorded||state.receiptStarted)throw Error('OEX_V3_SETTLEMENT');state.receiptStarted=true;
 const abort=()=>{void state.channel.close().catch(()=>{});};state.signal.addEventListener('abort',abort,{once:true});if(state.signal.aborted)abort();
 try{await revalidateSelectedV3Settlement(authority);await state.channel.send(Buffer.from(JSON.stringify({...state.frame,kind:'settle-receipt-v3'})));const raw=await state.channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)!==JSON.stringify({...state.frame,kind:'settle-receipt-ack-v3'}))throw Error('OEX_V3_SETTLEMENT');await revalidateSelectedV3Settlement(authority);state.receiptAcknowledged=true;}catch(error){await state.channel.close().catch(()=>{});throw error;}finally{state.signal.removeEventListener('abort',abort);}
}
export async function finalizeSelectedV3Authority(authority:SelectedV3SettlementAuthority,claimDigest:string){
 const state=v3Authorities.get(authority);if(!state||!state.receiptAcknowledged||state.claimDigest!==claimDigest)throw Error('OEX_V3_SETTLEMENT');await revalidateSelectedV3Settlement(authority);
}
/** Bind workspace finalization to the original owner-claim job and the exact
 * acknowledged saved outcome; this remains a live, one-use authority. */
export async function verifySelectedWorkspaceV3Authority(authority:SelectedV3SettlementAuthority,claimDigest:string,jobId:string,save:V3Save){
 const state=v3Authorities.get(authority);if(!state||state.jobId!==jobId||state.frame.exhibitionId!==save.exhibitionId||state.frame.etag!==save.etag||state.frame.requestId!==save.requestId)throw Error('OEX_V3_SETTLEMENT');
 await finalizeSelectedV3Authority(authority,claimDigest);
}
export function forgetSelectedV3Authority(authority:SelectedV3SettlementAuthority){v3Authorities.delete(authority);}
export type SelectedSettlementAuthority=Readonly<{readonly __selectedSettlement:unique symbol}>;
/** A live, one-use capability from the selected native channel, never a frame
 * supplied by an HTTP caller. The real owner holds the operation fence and
 * verifies exact DB/claim state and actual local drain before calling this. */
export async function requestSelectedSettlement(bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>,identity:Identity):Promise<SelectedSettlementAuthority>{
 const context=issued.get(bound);if(!context||context.variant==='v3'||!context.readySent||context.settlementStarted)throw Error('OEX_SELECTED_SETTLEMENT');context.settlementStarted=true;
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
