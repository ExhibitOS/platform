// SPDX-License-Identifier: AGPL-3.0-or-later
import {traceNativeOexSelected,type NativeOexDiagnostic} from './native-oex-diagnostic.ts';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import {spaceStillFor} from '@exhibitos/spec';
import type {Session} from './auth.ts';
import {FileOperationLifecycle} from './file-operation-lifecycle.ts';
import {PublicationAttempts,pinPublicationFileStore,publicationDiskOwner,type ResourceClaimRequest} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {Oex,type OexImportAttachmentJob} from './oex.ts';
import {allowedRights} from './rights.ts';
import {bindOexOwnerClaim,requestSelectedSettlement,sendSelectedSettlementReceipt} from './oex-owner-claim.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
import {prepareBoundedOexFromOwner} from './oex-bounded-owner-prepare.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type Selection={jobId:string;requestId:string;bytes:number;sha256:string};
type CommittedOwner={jobId:string;attemptId:string;generation:string;stageId:string;reservationId:string;reservationGeneration:string;assertCommitted:()=>Promise<void>};
/** Selected native-personal operation only. Its issuer must hold the actual
 * Manager Session/root guard, prevent competing workspace writers, validate
 * the exact queued upload and admit the pinned worker artifact. This function
 * uses the existing PG lifecycle fence and journal/provider; no HTTP route or
 * public request can supply these trusted objects. Uncertain outcomes retain
 * claims, reservations and all bytes. */
export async function runBoundedOexOwnerOperation(input:{lifecycle:FileOperationLifecycle;pool:Pool;blobs:FileBlobStore;oex:Oex;journal:PublicationAttempts;provider:PublicationDiskBudget;session:Session;workspaceId:string;selection:Selection;request:ResourceClaimRequest;rawOpen:Uint8Array;secret:Uint8Array;workerDigest:string;channel:Channel;verifyOwner:()=>Promise<void>;afterCommit:(result:Awaited<ReturnType<Oex['attachPrepared']>>,signal:AbortSignal,owner:Readonly<CommittedOwner>)=>Promise<void>;prepareSettlement:()=>Promise<void>;settlementOutcome:()=>{exhibitionId:string;etag:string;requestId:string};signal:AbortSignal;diagnostic?:NativeOexDiagnostic}){
 const {lifecycle,pool,blobs,oex,journal,provider,workspaceId,channel,verifyOwner,afterCommit,prepareSettlement,settlementOutcome,signal,workerDigest,diagnostic}=input,s=structuredClone(input.session),selection=structuredClone(input.selection),request=structuredClone(input.request),rawOpen=Buffer.from(input.rawOpen),secret=Buffer.from(input.secret);
 try{
 if(!(lifecycle instanceof FileOperationLifecycle)||lifecycle.ownsPool(pool)||!Number.isSafeInteger(pool?.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1||!(blobs instanceof FileBlobStore)||!(oex instanceof Oex)||oex.blobs!==blobs||oex.pool!==pool||!(journal instanceof PublicationAttempts)||!(provider instanceof PublicationDiskBudget)||typeof verifyOwner!=='function'||typeof afterCommit!=='function'||typeof prepareSettlement!=='function'||typeof settlementOutcome!=='function'||!signal||!(input.secret instanceof Uint8Array)||secret.length!==32)throw Error('OEX_OWNER_OPERATION');pinPublicationFileStore(blobs);
 const stageRoot=join(dirname(blobs.root),`native-oex-stage-${request.runtimeGeneration}`);
 if(request.operation!=='oex-import'||request.purpose!=='import'||request.resourceId!==workspaceId||request.tenantId!==s.tenantId||request.userId!==s.userId||request.requestId!==selection.requestId||request.sourceDigest!==selection.sha256||request.owner.storeRoot!==blobs.root||!Number.isSafeInteger(selection.bytes)||selection.bytes<1||selection.bytes>512*1024*1024||request.plan.length!==2||request.plan.filter(p=>p.root===stageRoot&&p.bytes===selection.bytes+512*1024*1024).length!==1||request.plan.filter(p=>p.root===blobs.root&&p.bytes===512*1024*1024).length!==1)throw Error('OEX_OWNER_OPERATION');
 const identity={operation:'oex-import' as const,tenantId:s.tenantId,resourceId:request.resourceId,attemptId:request.attemptId,generation:request.generation};
 let bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>|undefined,lease:Awaited<ReturnType<typeof claimBoundedOexLease>>|undefined,prepared:Awaited<ReturnType<typeof prepareBoundedOexFromOwner>>|undefined,result:Awaited<ReturnType<Oex['attachPrepared']>>|undefined,leaseDeadline:Date|undefined,drained=false;
 const job=():OexImportAttachmentJob=>{if(!lease)throw Error('OEX_OWNER_OPERATION');return {id:lease.jobId,leaseId:lease.leaseId,payloadSha256:lease.archiveSha256};};
 const active=async(c:PoolClient)=>{const row=await c.query("SELECT m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL",[s.id,s.tenantId,s.userId]);if(row.rowCount!==1||row.rows[0]?.role!==s.role||!['admin','artist'].includes(s.role))throw Error('OEX_OWNER_AUTH');};
 return await lifecycle.runOperation(identity,{
  async claimPersistent(_identity,combined){bound=await bindOexOwnerClaim({journal,provider,request,rawOpen,workspaceId,principalId:s.userId,jobId:selection.jobId,secret,channel,verifyLive:verifyOwner,signal:combined,diagnostic});},
  async claim(c){diagnostic?.step('lease-start');const owner=await publicationDiskOwner(c,blobs.root);if(!isDeepStrictEqual(owner,request.owner))throw Error('OEX_OWNER_OPERATION');lease=await claimBoundedOexLease(c,s,{jobId:selection.jobId,requestId:selection.requestId,bytes:selection.bytes,sha256:selection.sha256});diagnostic?.step('lease-returned');},
  async prepare(_identity,combined){diagnostic?.step('lease-committed');if(!bound||!lease)throw Error('OEX_OWNER_OPERATION');prepared=await prepareBoundedOexFromOwner({pool,blobs,journal,provider,bound,lease,session:s,workspaceId,workerDigest,channel,verifyOwner,signal:combined,diagnostic});drained=true;return prepared;},
  async confirmDrained(){if(!drained)throw Error('OEX_OWNER_OPERATION');await verifyOwner();},
  async verifyPersistentClaim(){if(!bound)throw Error('OEX_OWNER_OPERATION');await verifyOwner();const current=await journal.verifyResourceClaim(provider,bound.handle);if(current.binding.receiptDigest!==bound.receiptDigest||current.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_OWNER_OPERATION');},
  async checkFinal(c){diagnostic?.step('final-start');if(!lease||!prepared||!drained)throw Error('OEX_OWNER_OPERATION');await verifyBoundedOexLease(c,s,lease);const row=(await c.query('SELECT lease_until FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,lease.jobId])).rows[0];if(!(row?.lease_until instanceof Date)||!Number.isFinite(row.lease_until.getTime()))throw Error('OEX_OWNER_OPERATION');leaseDeadline=new Date(row.lease_until);},
  async finalize(c,_identity,value){result=await oex.attachPrepared(c,s,job(),value);diagnostic?.step('final-returned');return result;},
  async checkBeforeCommit(c){if(!result||!prepared||!leaseDeadline)throw Error('OEX_OWNER_OPERATION');await oex.checkAttached(c,s,job(),result);await active(c);const valid=(await c.query('SELECT clock_timestamp()<$1::timestamptz AS valid',[leaseDeadline])).rows[0]?.valid;if(valid!==true)throw Error('OEX_OWNER_LEASE_EXPIRED');const still=spaceStillFor(prepared.exhibition),grants=[...prepared.exhibition.artworks.map(a=>a.rights),...prepared.exhibition.mediaAssets.map(m=>m.rights),...(still?[still.rights]:[])];if(grants.some(r=>!allowedRights(r,'export')))throw Error('OEX_OWNER_RIGHTS');},
  async afterCommit(_identity,committed,combined){
   diagnostic?.step('commit-acknowledged');
   if(!bound||!lease)throw Error('OEX_OWNER_OPERATION');const issued=bound,currentLease=lease,baseline=structuredClone(committed),presented=structuredClone(committed);let scopeActive=true;
   const pending:object[]=[presented],seen:object[]=[];while(pending.length){const value=pending.pop()!;seen.push(value);if(seen.length>100000)throw Error('OEX_OWNER_OPERATION');for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);}for(let i=seen.length-1;i>=0;i--)Object.freeze(seen[i]);
   const checkScope=()=>{if(!scopeActive)throw Error('OEX_OWNER_OPERATION');combined.throwIfAborted();};
   const assertCommitted=async()=>{checkScope();await verifyOwner();checkScope();const verified=await journal.verifyResourceClaim(provider,issued.handle);checkScope();if(verified.binding.receiptDigest!==issued.receiptDigest||verified.binding.managerBindingDigest!==issued.managerBindingDigest)throw Error('OEX_OWNER_OPERATION');
    await transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!isDeepStrictEqual(await publicationDiskOwner(c,blobs.root),request.owner))throw Error('OEX_OWNER_OPERATION');await oex.checkAttached(c,s,{id:currentLease.jobId,leaseId:currentLease.leaseId,payloadSha256:currentLease.archiveSha256},baseline);await active(c);});checkScope();};
   const owner=Object.freeze({jobId:currentLease.jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:issued.receipt.generation,assertCommitted});
   try{
    await assertCommitted();await afterCommit(presented,combined,owner);traceNativeOexSelected('postsave-scope-returned');
    await prepareSettlement();await assertCommitted();
    const authority=await requestSelectedSettlement(issued,{correlationId:issued.correlationId,attemptId:request.attemptId,runtimeGeneration:request.runtimeGeneration,generation:request.generation,reservationId:request.reservationId,reservationGeneration:issued.receipt.generation,receiptDigest:issued.receiptDigest});
    await assertCommitted();const save=structuredClone(settlementOutcome());if(save.exhibitionId!==baseline.exhibitionId)throw Error('OEX_OWNER_OPERATION');await journal.settleSelectedOex(provider,issued.handle,authority,save);await sendSelectedSettlementReceipt(authority);
   }finally{scopeActive=false;}
  },
 },signal);}catch(error){diagnostic?.fail(error,channel);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{secret.fill(0);}
}
