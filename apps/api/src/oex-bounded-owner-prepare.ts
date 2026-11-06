// SPDX-License-Identifier: AGPL-3.0-or-later
import type {NativeOexDiagnostic} from './native-oex-diagnostic.ts';
import {lstat,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import type {ChildProcess} from 'node:child_process';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import {validateExhibition} from '@exhibitos/spec';
import type {Session} from './auth.ts';
import {PublicationAttempts,pinPublicationFileStore,publicationDiskOwner,samePublicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {assertOexOwnerClaimContext,bindOexOwnerClaim,sendOexClaimReady,bindOexPreflightV3,verifyOexPreflightV3,acceptOexPackedReadyV3,requestOexOwnerDrainV3} from './oex-owner-claim.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
import {acceptOexOwnerStage} from './oex-owner-stage.ts';
import {parsePackedOexControlV2} from './oex-packed-control-v2.ts';
import {receivePackedOexMetadataV2} from './oex-packed-metadata-v2.ts';
import {parsePackedOexAckV2,parsePackedWorkspaceOexAck} from './oex-packed-ack-v2.ts';
import {createPackedOexStreamReceiver,createPackedWorkspaceOexStreamReceiver} from './oex-packed-stream-v2.ts';
import {recordBoundedOexDestinations} from './oex-bounded-inventory.ts';
import {consumeBoundedOex,consumeBoundedWorkspaceOex} from './oex-bounded-consume.ts';
import {recordWorkspaceMaterialImportInventory} from './workspace-material-import-inventory.ts';
import {isDeepStrictEqual} from 'node:util';
import {requestOexOwnerDrain} from './oex-owner-drain.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type Bound=Awaited<ReturnType<typeof bindOexOwnerClaim>>;
type Lease=Awaited<ReturnType<typeof claimBoundedOexLease>>;
/** Single selected native test path, called only after the issued resource
 * claim and exact personal lease are committed under the same operation fence.
 * Caller owns the real Manager Session, writer exclusion and runtime lifecycle.
 * Failure keeps claim, reservation, journal and all partial bytes. Returned
 * metadata is not itself a DB attachment or release capability. */
export async function prepareBoundedOexFromOwner(input:{pool:Pool;blobs:FileBlobStore;journal:PublicationAttempts;provider:PublicationDiskBudget;bound:Bound;lease:Lease;session:Session;workspaceId:string;workerDigest:string;channel:Channel;verifyOwner:()=>Promise<void>;signal:AbortSignal;diagnostic?:NativeOexDiagnostic;nativeOexWorkspace?:import('./native-oex-provenance.ts').NativeOexWorkspaceContext;variant?:'v3';verifyNodeDrain?:()=>Promise<void>;workspaceImport?:{assertCatalog:(c:PoolClient)=>Promise<void>}}){
 const {pool,journal,provider,bound,channel,signal,verifyOwner,workspaceId,workerDigest,diagnostic}=input,s=structuredClone(input.session),lease=structuredClone(input.lease),blobs=pinPublicationFileStore(input.blobs);
 let abort:undefined|(()=>void);
 try{
  diagnostic?.step('prepare-start');
  if(typeof verifyOwner!=='function'||!signal||!channel||typeof channel.receive!=='function'||typeof channel.send!=='function'||typeof channel.close!=='function'||!/^[a-f0-9]{64}$/.test(workerDigest))throw Error('OEX_BOUNDED_PREPARE');
  if(input.variant!==undefined&&input.variant!=='v3')throw Error('OEX_BOUNDED_PREPARE');const variant=input.variant,v3=variant==='v3',verifyNodeDrain=input.verifyNodeDrain;if(v3&&typeof verifyNodeDrain!=='function')throw Error('OEX_BOUNDED_PREPARE');const workspaceSelected=(lease.archiveFormat as string|undefined)==='1.0.0-draft.12',workspaceImport=input.workspaceImport;if(workspaceSelected!==!!workspaceImport||workspaceSelected&&(!v3||typeof workspaceImport?.assertCatalog!=='function'||!input.nativeOexWorkspace?.workspaceMaterials))throw Error('OEX_BOUNDED_PREPARE');
  assertOexOwnerClaimContext(bound,channel,signal,workspaceId,s.userId,lease.jobId,verifyOwner,journal,provider,v3?'v3':'v2');
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const initial=await journal.verifyResourceClaim(provider,bound.handle),claim=initial.claim,receipt=initial.binding.receipt,stageRoot=join(dirname(blobs.root),`native-oex-stage-${claim.runtimeGeneration}`);
  if(claim.operation!=='oex-import'||claim.purpose!=='import'||claim.tenantId!==s.tenantId||claim.userId!==s.userId||lease.userId!==s.userId||claim.requestId!==lease.requestId||claim.sourceDigest!==lease.archiveSha256||claim.owner.storeRoot!==blobs.root||claim.plan.length!==(v3?1:2)||receipt.plan.length!==(v3?1:2)||receipt.id!==claim.reservationId||initial.binding.receiptDigest!==bound.receiptDigest||initial.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_BOUNDED_PREPARE');
  const stagePlans=receipt.plan.filter(p=>p.root===stageRoot),storePlans=receipt.plan.filter(p=>p.root===blobs.root);if(stagePlans.length!==1||storePlans.length!==(v3?0:1)||stageRoot===blobs.root||stagePlans[0]!.bytes!==lease.archiveBytes+(v3?0:512*1024*1024)||!v3&&storePlans[0]!.bytes!==512*1024*1024)throw Error('OEX_BOUNDED_PREPARE');
  const baseline=await lstat(stageRoot,{bigint:true});if(!baseline.isDirectory()||baseline.isSymbolicLink()||await realpath(stageRoot)!==stageRoot||String(baseline.dev)!==stagePlans[0]!.device||(baseline.mode&0o077n)!==0n||baseline.uid!==BigInt(process.getuid?.()??-1))throw Error('OEX_BOUNDED_PREPARE');
  const rootLive=async()=>{const now=await lstat(stageRoot,{bigint:true});if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==baseline.dev||now.ino!==baseline.ino||(now.mode&0o077n)!==0n||now.uid!==baseline.uid||await realpath(stageRoot)!==stageRoot)throw Error('OEX_BOUNDED_PREPARE');};
  const verifyLease=async()=>transaction(pool,async c=>{if(workspaceSelected)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!samePublicationDiskOwner(await publicationDiskOwner(c,blobs.root),claim.owner))throw Error('OEX_BOUNDED_PREPARE');await verifyBoundedOexLease(c,s,lease,workspaceSelected?{context:input.nativeOexWorkspace!,workspaceId,owner:claim.owner}:undefined);});
  let preflightBound=false;const live=async()=>{signal.throwIfAborted();await verifyOwner();await rootLive();const current=await journal.verifyResourceClaim(provider,bound.handle);if(current.claimDigest!==initial.claimDigest||current.binding.receiptDigest!==bound.receiptDigest||current.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_BOUNDED_PREPARE');if(preflightBound)await verifyOexPreflightV3(bound);signal.throwIfAborted();};
  await live();diagnostic?.step('prepare-verified');diagnostic?.step('claim-ready-start');await sendOexClaimReady(bound,lease,verifyLease,diagnostic,workspaceSelected?input.nativeOexWorkspace:undefined);diagnostic?.step('claim-ready-sent');
  const stage=await acceptOexOwnerStage(channel,await channel.receive(30000),{correlationId:bound.correlationId,runtimeGeneration:claim.runtimeGeneration,workspaceId,tenantId:s.tenantId,jobId:lease.jobId,attemptId:claim.attemptId,generation:claim.generation,stageId:claim.stageId,reservationId:claim.reservationId,reservationGeneration:receipt.generation,stageDevice:stagePlans[0]!.device},live,signal,variant);
  diagnostic?.step('stage-received');
  const preflight=v3?await bindOexPreflightV3(bound,{stage,verifyStage:rootLive,verifyLease}):undefined;if(preflight)preflightBound=true;
  const output=v3?await acceptOexPackedReadyV3(bound):undefined;
  const capacity=preflight?.evidence.packedBytes??512*1024*1024,outputReceipt=preflight?.outputReceipt;
  if(v3&&(!preflight||!output||capacity===0&&(outputReceipt!==null||preflight.outputReceiptDigest!==null)||capacity>0&&(!outputReceipt||!preflight.outputReceiptDigest)))throw Error('OEX_BOUNDED_PREPARE');
  const outputId=outputReceipt?.id??claim.reservationId,outputGeneration=outputReceipt?.generation??receipt.generation,outputDigest=preflight?.outputReceiptDigest??bound.receiptDigest;
  await live();const control=parsePackedOexControlV2(await channel.receive(300000),{correlationId:bound.correlationId,tenantId:s.tenantId,resourceId:claim.resourceId,jobId:lease.jobId,userId:s.userId,requestId:lease.requestId,leaseId:lease.leaseId,attemptId:claim.attemptId,runtimeGeneration:claim.runtimeGeneration,stageId:claim.stageId,reservationId:outputId,reservationGeneration:outputGeneration,archiveBytes:lease.archiveBytes,archiveSha256:lease.archiveSha256,capacity,archiveFormat:workspaceSelected?'1.0.0-draft.12':lease.archiveFormat,inputDevice:stage.stageDevice,inputInode:stage.stageInode,outputDevice:stage.stageDevice,reservationDigest:outputDigest,sourceDigest:claim.sourceDigest,workerDigest},variant,workspaceSelected);if(output&&(control.outputDevice!==output.outputDevice||control.outputInode!==output.outputInode))throw Error('OEX_BOUNDED_PREPARE');
  diagnostic?.step('control-received');
  const raw=await receivePackedOexMetadataV2(channel,await channel.receive(),bound.correlationId,claim.attemptId),ackExpected={attemptId:claim.attemptId,runtimeGeneration:claim.runtimeGeneration,reservationId:outputId,reservationGeneration:outputGeneration,controlSha256:control.controlSha256,archiveSha256:lease.archiveSha256,outputDevice:control.outputDevice,outputInode:control.outputInode,capacity};
  const ack=workspaceSelected?parsePackedWorkspaceOexAck(raw,{...ackExpected,archiveFormat:'1.0.0-draft.12',preflight:preflight!.evidence}):parsePackedOexAckV2(raw,{...ackExpected,archiveFormat:lease.archiveFormat as import('./oex-file-format.ts').NativeOexFileFormat|undefined,...(preflight?{preflight:preflight.evidence}:{})});
  diagnostic?.step('metadata-received');
  // This one representative path must remain readable by the existing Studio
  // create/get/put validators. Full 256–512 MiB scene support is separate.
  diagnostic?.step('scene-validation-start');if(!validateExhibition(ack.exhibition,input.nativeOexWorkspace?{archiveProfile:'bounded-file-v1'}:undefined).valid)throw Error('OEX_TEST_SCENE_UNSUPPORTED');diagnostic?.step('scene-validation-passed');
  diagnostic?.step('inventory-live-start');await live();diagnostic?.step('inventory-transaction-start');const empty=v3&&capacity===0;if(empty&&ack.entries.length!==0)throw Error('OEX_BOUNDED_PREPARE');const inventory=await transaction(pool,async c=>{if(workspaceSelected)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!samePublicationDiskOwner(await publicationDiskOwner(c,blobs.root),claim.owner))throw Error('OEX_BOUNDED_PREPARE');await verifyBoundedOexLease(c,s,lease,workspaceSelected?{context:input.nativeOexWorkspace!,workspaceId,owner:claim.owner}:undefined);if(workspaceSelected){await workspaceImport!.assertCatalog(c);const value=await recordWorkspaceMaterialImportInventory(c,s,{jobId:lease.jobId,leaseId:lease.leaseId,attemptId:claim.attemptId,manifest:ack.manifest as import('@exhibitos/spec').OexWorkspaceMaterialManifest,scene:ack.exhibition,packedPaths:ack.entries.map(e=>e.path)});signal.throwIfAborted();return value;}const sourceKeys=empty?new Map<string,string>():await recordBoundedOexDestinations(c,s,lease.jobId,lease.leaseId,claim.attemptId,ack.entries.map(e=>e.path));signal.throwIfAborted();return {sourceKeys};});diagnostic?.step('inventory-transaction-returned');
  diagnostic?.step('receiver-live-start');await live();diagnostic?.step('receiver-start');const reader=await (workspaceSelected?createPackedWorkspaceOexStreamReceiver:createPackedOexStreamReceiver)(ack.manifest,ack.entries,claim.attemptId,capacity,channel);diagnostic?.step('receiver-returned');
  diagnostic?.step('consume-start');
  let consumerDone=false,childFailed=false;const children=new Set<ChildProcess>(),onSpawn=(child:ChildProcess)=>{if(consumerDone||children.has(child))throw Error('OEX_BOUNDED_PREPARE');children.add(child);child.once('close',(code,signal)=>{children.delete(child);if(code!==0||signal)childFailed=true;});};const common={exhibition:ack.exhibition,sourceKeys:inventory.sourceKeys,reader,blobs,verifyLive:async()=>{await live();await verifyLease();},signal};
  const prepared=workspaceSelected?await consumeBoundedWorkspaceOex({...common,manifest:ack.manifest as import('@exhibitos/spec').OexWorkspaceMaterialManifest,tenantId:s.tenantId,jobId:lease.jobId,attemptId:claim.attemptId,onSpawn}):await consumeBoundedOex({...common,manifest:ack.manifest as import('@exhibitos/spec').OexBoundedFileManifest|import('@exhibitos/spec').OexMaterialCatalogueManifest,...(empty?{allowEmpty:true as const}:{})});if(workspaceSelected&&(!('stage' in inventory)||!isDeepStrictEqual(inventory.stage,prepared.workspaceMaterialStage)))throw Error('OEX_BOUNDED_PREPARE');consumerDone=true;
  // consumeBoundedOex is called exactly once and sequentially awaits every
  // decoder close and blob write. The owner must additionally stop and drain
  // its upload/admission scope so no new work can be admitted hereafter.
  const nodeDrained=async()=>{if(!consumerDone||children.size||childFailed)throw Error('OEX_BOUNDED_PREPARE');await verifyNodeDrain!();if(children.size||childFailed)throw Error('OEX_BOUNDED_PREPARE');};
  diagnostic?.step('consume-complete');if(v3)await requestOexOwnerDrainV3(bound,nodeDrained);else await requestOexOwnerDrain(channel,claim.attemptId,live,signal);await verifyLease();await live();diagnostic?.step('drain-complete');return prepared;
 }catch(error){diagnostic?.fail(error,channel);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(abort)signal.removeEventListener('abort',abort);}
}
