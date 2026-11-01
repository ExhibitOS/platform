// SPDX-License-Identifier: AGPL-3.0-or-later
import type {NativeOexDiagnostic} from './native-oex-diagnostic.ts';
import {lstat,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {Pool} from 'pg';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import {validateExhibition} from '@exhibitos/spec';
import type {Session} from './auth.ts';
import {PublicationAttempts,pinPublicationFileStore,publicationDiskOwner,samePublicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {assertOexOwnerClaimContext,bindOexOwnerClaim,sendOexClaimReady} from './oex-owner-claim.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
import {acceptOexOwnerStage} from './oex-owner-stage.ts';
import {parsePackedOexControlV2} from './oex-packed-control-v2.ts';
import {receivePackedOexMetadataV2} from './oex-packed-metadata-v2.ts';
import {parsePackedOexAckV2} from './oex-packed-ack-v2.ts';
import {createPackedOexStreamReceiver} from './oex-packed-stream-v2.ts';
import {recordBoundedOexDestinations} from './oex-bounded-inventory.ts';
import {consumeBoundedOex} from './oex-bounded-consume.ts';
import {requestOexOwnerDrain} from './oex-owner-drain.ts';

type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
type Bound=Awaited<ReturnType<typeof bindOexOwnerClaim>>;
type Lease=Awaited<ReturnType<typeof claimBoundedOexLease>>;
/** Single selected native test path, called only after the issued resource
 * claim and exact personal lease are committed under the same operation fence.
 * Caller owns the real Manager Session, writer exclusion and runtime lifecycle.
 * Failure keeps claim, reservation, journal and all partial bytes. Returned
 * metadata is not itself a DB attachment or release capability. */
export async function prepareBoundedOexFromOwner(input:{pool:Pool;blobs:FileBlobStore;journal:PublicationAttempts;provider:PublicationDiskBudget;bound:Bound;lease:Lease;session:Session;workspaceId:string;workerDigest:string;channel:Channel;verifyOwner:()=>Promise<void>;signal:AbortSignal;diagnostic?:NativeOexDiagnostic}){
 const {pool,journal,provider,bound,channel,signal,verifyOwner,workspaceId,workerDigest,diagnostic}=input,s=structuredClone(input.session),lease=structuredClone(input.lease),blobs=pinPublicationFileStore(input.blobs);
 let abort:undefined|(()=>void);
 try{
  diagnostic?.step('prepare-start');
  if(typeof verifyOwner!=='function'||!signal||!channel||typeof channel.receive!=='function'||typeof channel.send!=='function'||typeof channel.close!=='function'||!/^[a-f0-9]{64}$/.test(workerDigest))throw Error('OEX_BOUNDED_PREPARE');
  assertOexOwnerClaimContext(bound,channel,signal,workspaceId,s.userId,lease.jobId,verifyOwner,journal,provider);
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const initial=await journal.verifyResourceClaim(provider,bound.handle),claim=initial.claim,receipt=initial.binding.receipt,stageRoot=join(dirname(blobs.root),`native-oex-stage-${claim.runtimeGeneration}`);
  if(claim.operation!=='oex-import'||claim.purpose!=='import'||claim.tenantId!==s.tenantId||claim.userId!==s.userId||lease.userId!==s.userId||claim.requestId!==lease.requestId||claim.sourceDigest!==lease.archiveSha256||claim.owner.storeRoot!==blobs.root||claim.plan.length!==2||receipt.plan.length!==2||receipt.id!==claim.reservationId||initial.binding.receiptDigest!==bound.receiptDigest||initial.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_BOUNDED_PREPARE');
  const stagePlans=receipt.plan.filter(p=>p.root===stageRoot),storePlans=receipt.plan.filter(p=>p.root===blobs.root);if(stagePlans.length!==1||storePlans.length!==1||stageRoot===blobs.root||stagePlans[0]!.bytes!==lease.archiveBytes+512*1024*1024||storePlans[0]!.bytes!==512*1024*1024)throw Error('OEX_BOUNDED_PREPARE');
  const baseline=await lstat(stageRoot,{bigint:true});if(!baseline.isDirectory()||baseline.isSymbolicLink()||await realpath(stageRoot)!==stageRoot||String(baseline.dev)!==stagePlans[0]!.device||(baseline.mode&0o077n)!==0n||baseline.uid!==BigInt(process.getuid?.()??-1))throw Error('OEX_BOUNDED_PREPARE');
  const rootLive=async()=>{const now=await lstat(stageRoot,{bigint:true});if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==baseline.dev||now.ino!==baseline.ino||(now.mode&0o077n)!==0n||now.uid!==baseline.uid||await realpath(stageRoot)!==stageRoot)throw Error('OEX_BOUNDED_PREPARE');};
  const verifyLease=async()=>transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!samePublicationDiskOwner(await publicationDiskOwner(c,blobs.root),claim.owner))throw Error('OEX_BOUNDED_PREPARE');await verifyBoundedOexLease(c,s,lease);});
  const live=async()=>{signal.throwIfAborted();await verifyOwner();await rootLive();const current=await journal.verifyResourceClaim(provider,bound.handle);if(current.claimDigest!==initial.claimDigest||current.binding.receiptDigest!==bound.receiptDigest||current.binding.managerBindingDigest!==bound.managerBindingDigest)throw Error('OEX_BOUNDED_PREPARE');signal.throwIfAborted();};
  await live();diagnostic?.step('prepare-verified');diagnostic?.step('claim-ready-start');await sendOexClaimReady(bound,lease,verifyLease,diagnostic);diagnostic?.step('claim-ready-sent');
  const stage=await acceptOexOwnerStage(channel,await channel.receive(30000),{correlationId:bound.correlationId,runtimeGeneration:claim.runtimeGeneration,workspaceId,tenantId:s.tenantId,jobId:lease.jobId,attemptId:claim.attemptId,generation:claim.generation,stageId:claim.stageId,reservationId:claim.reservationId,reservationGeneration:receipt.generation,stageDevice:stagePlans[0]!.device},live,signal);
  diagnostic?.step('stage-received');
  const control=parsePackedOexControlV2(await channel.receive(300000),{correlationId:bound.correlationId,tenantId:s.tenantId,resourceId:claim.resourceId,jobId:lease.jobId,userId:s.userId,requestId:lease.requestId,leaseId:lease.leaseId,attemptId:claim.attemptId,runtimeGeneration:claim.runtimeGeneration,stageId:claim.stageId,reservationId:claim.reservationId,reservationGeneration:receipt.generation,archiveBytes:lease.archiveBytes,archiveSha256:lease.archiveSha256,capacity:512*1024*1024,inputDevice:stage.stageDevice,inputInode:stage.stageInode,outputDevice:stage.stageDevice,reservationDigest:bound.receiptDigest,sourceDigest:claim.sourceDigest,workerDigest});
  diagnostic?.step('control-received');
  const raw=await receivePackedOexMetadataV2(channel,await channel.receive(),bound.correlationId,claim.attemptId),ack=parsePackedOexAckV2(raw,{attemptId:claim.attemptId,runtimeGeneration:claim.runtimeGeneration,reservationId:claim.reservationId,reservationGeneration:receipt.generation,controlSha256:control.controlSha256,archiveSha256:lease.archiveSha256,outputDevice:control.outputDevice,outputInode:control.outputInode,capacity:512*1024*1024});
  diagnostic?.step('metadata-received');
  // This one representative path must remain readable by the existing Studio
  // create/get/put validators. Full 256–512 MiB scene support is separate.
  if(!validateExhibition(ack.exhibition).valid)throw Error('OEX_TEST_SCENE_UNSUPPORTED');
  await live();const sourceKeys=await transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!samePublicationDiskOwner(await publicationDiskOwner(c,blobs.root),claim.owner))throw Error('OEX_BOUNDED_PREPARE');await verifyBoundedOexLease(c,s,lease);const keys=await recordBoundedOexDestinations(c,s,lease.jobId,lease.leaseId,claim.attemptId,ack.entries.map(e=>e.path));signal.throwIfAborted();return keys;});
  await live();const reader=await createPackedOexStreamReceiver(ack.manifest,ack.entries,claim.attemptId,512*1024*1024,channel);
  diagnostic?.step('consume-start');
  const prepared=await consumeBoundedOex({manifest:ack.manifest,exhibition:ack.exhibition,sourceKeys,reader,blobs,verifyLive:async()=>{await live();await verifyLease();},signal});
  diagnostic?.step('consume-complete');await requestOexOwnerDrain(channel,claim.attemptId,live,signal);await verifyLease();await live();diagnostic?.step('drain-complete');return prepared;
 }catch(error){diagnostic?.fail(error,channel);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(abort)signal.removeEventListener('abort',abort);}
}
