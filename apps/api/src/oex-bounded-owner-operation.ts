// SPDX-License-Identifier: AGPL-3.0-or-later
import type {NativeOexFileFormat} from './oex-file-format.ts';
import {traceNativeOexSelected,type NativeOexDiagnostic} from './native-oex-diagnostic.ts';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import {spaceStillFor} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import type {Session} from './auth.ts';
import {FileOperationLifecycle} from './file-operation-lifecycle.ts';
import {PublicationAttempts,pinPublicationFileStore,publicationDiskOwner,type ResourceClaimRequest} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {Oex,type OexImportAttachmentJob} from './oex.ts';
import {allowedRights} from './rights.ts';
import {assertOexOwnerClaimContext,bindOexOwnerClaim,requestSelectedSettlement,sendSelectedSettlementReceipt,verifyOexPreflightV3,verifyCommittedOexPreflightV3,selectedV3Correlation,requestSelectedV3Settlement,finishSelectedV3Settlement} from './oex-owner-claim.ts';
import {issueNativeSelectedDraftGrant,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
import {prepareBoundedOexFromOwner} from './oex-bounded-owner-prepare.ts';
import {attachWorkspaceMaterialImportVersions} from './workspace-material-import-attachment.ts';
import {storeWorkspaceOexTerminalProof} from './workspace-oex-terminal-storage.ts';
import {prepareWorkspaceOexTerminalProof} from './workspace-oex-terminal-proof.ts';
import {verifyWorkspaceOexCommitted} from './workspace-oex-terminal-committed.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type Selection={archiveFormat?:NativeOexFileFormat|'1.0.0-draft.12';jobId:string;requestId:string;bytes:number;sha256:string};
type CommittedOwner={jobId:string;attemptId:string;generation:string;stageId:string;reservationId:string;reservationGeneration:string;assertCommitted:()=>Promise<void>;v3?:ReturnType<typeof selectedV3Correlation>};
/** Selected native-personal operation only. Its issuer must hold the actual
 * Manager Session/root guard, prevent competing workspace writers, validate
 * the exact queued upload and admit the pinned worker artifact. This function
 * uses the existing PG lifecycle fence and journal/provider; no HTTP route or
 * public request can supply these trusted objects. Uncertain outcomes retain
 * claims, reservations and all bytes. */
export async function runBoundedOexOwnerOperation(input:{lifecycle:FileOperationLifecycle;pool:Pool;blobs:FileBlobStore;oex:Oex;journal:PublicationAttempts;provider:PublicationDiskBudget;session:Session;workspaceId:string;selection:Selection;request:ResourceClaimRequest;rawOpen:Uint8Array;secret:Uint8Array;workerDigest:string;channel:Channel;verifyOwner:()=>Promise<void>;afterCommit:(result:Awaited<ReturnType<Oex['attachPrepared']>>,signal:AbortSignal,owner:Readonly<CommittedOwner>)=>Promise<void>;prepareSettlement:()=>Promise<void>;settlementOutcome:()=>{exhibitionId:string;etag:string;requestId:string};signal:AbortSignal;diagnostic?:NativeOexDiagnostic;nativeOexWorkspace?:NativeOexWorkspaceContext;selectedWorkspaceMaterial?:WorkspaceMaterialIntakes;variant?:'v3';verifyNodeDrain?:()=>Promise<void>}){
 const {lifecycle,pool,blobs,oex,journal,provider,workspaceId,channel,verifyOwner,afterCommit,prepareSettlement,settlementOutcome,signal,workerDigest,diagnostic}=input;let secret=Buffer.alloc(0);
 try{
 const s=structuredClone(input.session),selection=structuredClone(input.selection),request=structuredClone(input.request),rawOpen=Buffer.from(input.rawOpen);secret=Buffer.from(input.secret);
 if(!(lifecycle instanceof FileOperationLifecycle)||lifecycle.ownsPool(pool)||!Number.isSafeInteger(pool?.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1||!(blobs instanceof FileBlobStore)||!(oex instanceof Oex)||oex.blobs!==blobs||oex.pool!==pool||!(journal instanceof PublicationAttempts)||!(provider instanceof PublicationDiskBudget)||typeof verifyOwner!=='function'||typeof afterCommit!=='function'||typeof prepareSettlement!=='function'||typeof settlementOutcome!=='function'||!signal||!(input.secret instanceof Uint8Array)||secret.length!==32)throw Error('OEX_OWNER_OPERATION');pinPublicationFileStore(blobs);
 const variant=input.variant,verifyNodeDrain=input.verifyNodeDrain,v3=variant==='v3';if(variant!==undefined&&variant!=='v3'||v3&&typeof verifyNodeDrain!=='function')throw Error('OEX_OWNER_OPERATION');
 const stageRoot=join(dirname(blobs.root),`native-oex-stage-${request.runtimeGeneration}`);
 if(request.operation!=='oex-import'||request.purpose!=='import'||request.resourceId!==workspaceId||request.tenantId!==s.tenantId||request.userId!==s.userId||request.requestId!==selection.requestId||request.sourceDigest!==selection.sha256||request.owner.storeRoot!==blobs.root||!Number.isSafeInteger(selection.bytes)||selection.bytes<1||selection.bytes>512*1024*1024||request.plan.length!==(v3?1:2)||request.plan.filter(p=>p.root===stageRoot&&p.bytes===selection.bytes+(v3?0:512*1024*1024)).length!==1||!v3&&request.plan.filter(p=>p.root===blobs.root&&p.bytes===512*1024*1024).length!==1)throw Error('OEX_OWNER_OPERATION');
 const workspaceSelected=(selection.archiveFormat as string|undefined)==='1.0.0-draft.12';
 const identity={operation:'oex-import' as const,tenantId:s.tenantId,resourceId:request.resourceId,attemptId:request.attemptId,generation:request.generation};
 const terminalScope={workspaceId,tenantId:s.tenantId,principalId:s.userId,jobId:selection.jobId,attemptId:request.attemptId,importRequestId:selection.requestId,sourceArchiveSha256:selection.sha256};
 const assertWorkspaceImportCatalog=async(c:PoolClient)=>{if(!input.nativeOexWorkspace?.workspaceMaterials||!input.selectedWorkspaceMaterial?.matchesBinding(input.nativeOexWorkspace,blobs)||!v3)throw Error('OEX_WORKSPACE_CATALOG');if(typeof input.nativeOexWorkspace.assertImportCatalog!=='function')throw Error('OEX_WORKSPACE_CATALOG');await input.nativeOexWorkspace.assertImportCatalog(c);};

 let bound:Awaited<ReturnType<typeof bindOexOwnerClaim>>|undefined,lease:Awaited<ReturnType<typeof claimBoundedOexLease>>|undefined,prepared:Awaited<ReturnType<typeof prepareBoundedOexFromOwner>>|undefined,result:Awaited<ReturnType<Oex['attachPrepared']>>|undefined,leaseDeadline:Date|undefined,operationSignal:AbortSignal|undefined,drained=false;
 const job=():OexImportAttachmentJob=>{if(!lease)throw Error('OEX_OWNER_OPERATION');return {id:lease.jobId,leaseId:lease.leaseId,payloadSha256:lease.archiveSha256};};
 const active=async(c:PoolClient,lock=false)=>{const row=await c.query("SELECT m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL"+(lock?" FOR SHARE OF a,u,m,t":""),[s.id,s.tenantId,s.userId]);if(row.rowCount!==1||row.rows[0]?.role!==s.role||!['admin','artist'].includes(s.role))throw Error('OEX_OWNER_AUTH');};
 return await lifecycle.runOperation(identity,{
  async claimPersistent(_identity,combined){operationSignal=combined;bound=await bindOexOwnerClaim({journal,provider,request,rawOpen,workspaceId,principalId:s.userId,jobId:selection.jobId,secret,channel,verifyLive:verifyOwner,signal:combined,diagnostic,...(v3?{variant:'v3' as const}:{})});},
  async claim(c){diagnostic?.step('lease-start');const owner=await publicationDiskOwner(c,blobs.root);if(!isDeepStrictEqual(owner,request.owner))throw Error('OEX_OWNER_OPERATION');if(input.nativeOexWorkspace)await input.nativeOexWorkspace.assertCatalog(c);lease=await claimBoundedOexLease(c,s,{jobId:selection.jobId,requestId:selection.requestId,bytes:selection.bytes,sha256:selection.sha256,...(selection.archiveFormat?{archiveFormat:selection.archiveFormat}:{})},workspaceSelected?{context:input.nativeOexWorkspace!,workspaceId,owner:request.owner}:undefined);diagnostic?.step('lease-returned');},
  async prepare(_identity,combined){diagnostic?.step('lease-committed');if(!bound||!lease)throw Error('OEX_OWNER_OPERATION');prepared=await prepareBoundedOexFromOwner({pool,blobs,journal,provider,bound,lease,session:s,workspaceId,workerDigest,channel,verifyOwner,signal:combined,diagnostic,...(input.nativeOexWorkspace?{nativeOexWorkspace:input.nativeOexWorkspace}:{}),...(workspaceSelected?{workspaceImport:{assertCatalog:assertWorkspaceImportCatalog}}:{}),...(v3?{variant:'v3' as const,verifyNodeDrain:verifyNodeDrain!}:{})});drained=true;return prepared;},
  async confirmDrained(){if(!drained)throw Error('OEX_OWNER_OPERATION');await verifyOwner();},
  async verifyPersistentClaim(){if(!bound)throw Error('OEX_OWNER_OPERATION');await verifyOwner();const current=await journal.verifyResourceClaim(provider,bound.handle);if(current.binding.receiptDigest!==bound.receiptDigest||current.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_OWNER_OPERATION');if(v3)await verifyOexPreflightV3(bound);},
  async checkFinal(c){diagnostic?.step('final-start');if(!lease||!prepared||!drained)throw Error('OEX_OWNER_OPERATION');if(input.nativeOexWorkspace)await input.nativeOexWorkspace.assertCatalog(c);await verifyBoundedOexLease(c,s,lease,workspaceSelected?{context:input.nativeOexWorkspace!,workspaceId,owner:request.owner}:undefined);const row=(await c.query('SELECT lease_until FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,lease.jobId])).rows[0];if(!(row?.lease_until instanceof Date)||!Number.isFinite(row.lease_until.getTime()))throw Error('OEX_OWNER_OPERATION');leaseDeadline=new Date(row.lease_until);},
  async finalize(c,_identity,value){
   const context=input.nativeOexWorkspace;
   const selected=context?async(draft:import('./studio.ts').Draft)=>{
    if(!bound||!operationSignal||!lease||context.workspaceId!==workspaceId||context.tenantId!==s.tenantId||context.principalId!==s.userId)throw Error('OEX_OWNER_OPERATION');
    // Verify the issued claim and cancellation scope inside the fenced transaction.
    const issued=bound,activeSignal=operationSignal;const live=async()=>{assertOexOwnerClaimContext(issued,channel,activeSignal,workspaceId,s.userId,selection.jobId,verifyOwner,journal,provider,v3?'v3':'v2');activeSignal.throwIfAborted();};
    return issueNativeSelectedDraftGrant(c,s,draft,{workspaceId,tenantId:s.tenantId,principalId:s.userId,jobId:lease.jobId,attemptId:request.attemptId,sourceSha256:lease.archiveSha256,claimSha256:issued.handle.digest,payloadManifestSha256:workerDigest,sourceDatabaseSystemId:request.owner.databaseSystemId,sourceDatabaseOid:request.owner.databaseOid,exhibitionId:draft.exhibitionId},live,workspaceSelected?{context,owner:request.owner}:undefined);
   }:undefined;
   if(workspaceSelected!==!!value.workspaceMaterialStage)throw Error('OEX_OWNER_OPERATION');if(value.workspaceMaterialStage){if(!lease||!bound||!drained)throw Error('OEX_OWNER_OPERATION');await assertWorkspaceImportCatalog(c);await attachWorkspaceMaterialImportVersions(c,s,{workspaceId,jobId:lease.jobId,attemptId:request.attemptId,leaseId:lease.leaseId,scene:value.exhibition,idMap:value.idMap,stage:value.workspaceMaterialStage});}
   result=await oex.attachPrepared(c,s,job(),value,selected);if(value.workspaceMaterialStage)await storeWorkspaceOexTerminalProof(c,s,terminalScope,result);diagnostic?.step('final-returned');return result;
  },
  async checkBeforeCommit(c){if(!result||!prepared||!leaseDeadline)throw Error('OEX_OWNER_OPERATION');if(workspaceSelected)await active(c,true);await oex.checkAttached(c,s,job(),result);if(!workspaceSelected)await active(c);const valid=(await c.query('SELECT clock_timestamp()<$1::timestamptz AS valid',[leaseDeadline])).rows[0]?.valid;if(valid!==true)throw Error('OEX_OWNER_LEASE_EXPIRED');const still=spaceStillFor(prepared.exhibition),grants=[...prepared.exhibition.artworks.map(a=>a.rights),...prepared.exhibition.mediaAssets.map(m=>m.rights),...(still?[still.rights]:[])];if(grants.some(r=>!allowedRights(r,'export')))throw Error('OEX_OWNER_RIGHTS');if(prepared.workspaceMaterialStage){const materials=(prepared.exhibition.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as unknown as WorkspaceMaterialBindings|undefined)?.materials;if(!materials||materials.some(m=>!allowedRights(m.rights,'display')||!allowedRights(m.rights,'export')))throw Error('OEX_OWNER_RIGHTS');}if(workspaceSelected)await active(c);},
  async afterCommit(_identity,committed,combined){
   diagnostic?.step('commit-acknowledged');
   if(!bound||!lease)throw Error('OEX_OWNER_OPERATION');const issued=bound,currentLease=lease,baseline=structuredClone(committed),presented=structuredClone(committed);let scopeActive=true;
   const pending:object[]=[presented],seen:object[]=[];while(pending.length){const value=pending.pop()!;seen.push(value);if(seen.length>100000)throw Error('OEX_OWNER_OPERATION');for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);}for(let i=seen.length-1;i>=0;i--)Object.freeze(seen[i]);
   const checkScope=()=>{if(!scopeActive)throw Error('OEX_OWNER_OPERATION');combined.throwIfAborted();};
   const assertCommitted=async()=>{checkScope();await verifyOwner();checkScope();const verified=await journal.verifyResourceClaim(provider,issued.handle);checkScope();if(verified.binding.receiptDigest!==issued.receiptDigest||verified.binding.managerBindingDigest!==issued.managerBindingDigest)throw Error('OEX_OWNER_OPERATION');if(v3)await verifyCommittedOexPreflightV3(issued);
    await transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!isDeepStrictEqual(await publicationDiskOwner(c,blobs.root),request.owner))throw Error('OEX_OWNER_OPERATION');await oex.checkAttached(c,s,{id:currentLease.jobId,leaseId:currentLease.leaseId,payloadSha256:currentLease.archiveSha256},baseline);await active(c);});checkScope();};
   const owner=Object.freeze({jobId:currentLease.jobId,attemptId:request.attemptId,generation:request.generation,stageId:request.stageId,reservationId:request.reservationId,reservationGeneration:issued.receipt.generation,assertCommitted,...(v3?{v3:selectedV3Correlation(issued)}:{})});
   try{
    await assertCommitted();await afterCommit(presented,combined,owner);traceNativeOexSelected('postsave-scope-returned');
    await prepareSettlement();await assertCommitted();
    const save=structuredClone(settlementOutcome());if(save.exhibitionId!==baseline.exhibitionId)throw Error('OEX_OWNER_OPERATION');
    if(v3){const authority=await requestSelectedV3Settlement(issued,save,assertCommitted);await assertCommitted();await journal.settleSelectedOexV3(provider,issued.handle,authority,save);await finishSelectedV3Settlement(authority);if(prepared?.workspaceMaterialStage){const context=input.nativeOexWorkspace;if(!context)throw Error('OEX_OWNER_OPERATION');const proof=prepareWorkspaceOexTerminalProof(terminalScope,baseline);await journal.finalizeSelectedWorkspaceOexV3(issued.handle,authority,{...proof,scope:terminalScope,verifyCommitted:async value=>{await verifyWorkspaceOexCommitted(pool,s,{workspaceId,tenantId:s.tenantId,principalId:s.userId,assertDatabase:context.assertDatabase,assertImportCatalog:assertWorkspaceImportCatalog,assertRecord:context.assertRecord},{scope:terminalScope,proofBytes:value.proofBytes,resultBytes:value.resultBytes,claimSha256:value.claimSha256,save:value.save});}});}else await journal.finalizeSelectedOexV3(issued.handle,authority);}
    else{const authority=await requestSelectedSettlement(issued,{correlationId:issued.correlationId,attemptId:request.attemptId,runtimeGeneration:request.runtimeGeneration,generation:request.generation,reservationId:request.reservationId,reservationGeneration:issued.receipt.generation,receiptDigest:issued.receiptDigest});await assertCommitted();await journal.settleSelectedOex(provider,issued.handle,authority,save);await sendSelectedSettlementReceipt(authority);}
   }finally{scopeActive=false;}
  },
 },signal,workspaceSelected?{isolation:'read committed'}:undefined);}catch(error){diagnostic?.fail(error,channel);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{secret.fill(0);}
}
