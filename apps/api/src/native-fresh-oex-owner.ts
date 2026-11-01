// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {Pool,type PoolClient} from 'pg';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {Studio,type StudioResponse} from './studio.ts';
import {Oex} from './oex.ts';
import {FileOperationLifecycle} from './file-operation-lifecycle.ts';
import {PublicationAttempts,publicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {parseNativeOwnerOperation} from './native-owner-protocol.ts';
import {pinNativeOexPayloadManifest} from './native-oex-payload.ts';
import {acceptNativeOexSelection} from './native-oex-selection.ts';
import {installSelectedNativeUpload,closeSelectedNativeUploadSlot,drainSelectedNativeUploadSlot,type NativeBoundedUploadSlot} from './native-bounded-oex-upload.ts';
import {armSelectedStudioPut,awaitSelectedStudioPut,closeSelectedStudioPutSlot,drainSelectedStudioPutSlot,type SelectedStudioPutSlot,type SelectedStudioClaim} from './native-selected-studio-put.ts';
import {runBoundedOexOwnerOperation} from './oex-bounded-owner-operation.ts';
import {createNativeOexDiagnostic,traceNativeOexSelected} from './native-oex-diagnostic.ts';

type Channel={isOpen():boolean;send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
/** Only the fresh personal native runtime calls this after its API listens.
 * Manager retains the exclusive root Session and socket, and has separately
 * admitted the complete payload. No HTTP request supplies any owner object. */
export async function runFreshNativeOexOwner(input:{pool:Pool;databaseUrl:string;blobs:FileBlobStore;workspaceId:string;tenantId:string;principalId:string;ownerUid:number;runtimeGeneration:string;secret:Uint8Array;channel:Channel;payloadManifestPath:string;uploadSlot:NativeBoundedUploadSlot;saveSlot:SelectedStudioPutSlot;signal:AbortSignal}){
 const {pool,databaseUrl,blobs,workspaceId,tenantId,principalId,ownerUid,runtimeGeneration,channel,uploadSlot,saveSlot,signal}=input,root=dirname(blobs.root),secret=Buffer.from(input.secret);
 let rootHandle:Awaited<ReturnType<typeof open>>|undefined,payload:Awaited<ReturnType<typeof pinNativeOexPayloadManifest>>|undefined,ownedPool:Pool|undefined,abort:undefined|(()=>void),expiryTimer:ReturnType<typeof setTimeout>|undefined,cleaned=false;
 const diagnostic=createNativeOexDiagnostic();
 try{
  if(!channel||typeof channel.isOpen!=='function'||typeof channel.close!=='function'||!signal||!(input.secret instanceof Uint8Array)||secret.length!==32||ownerUid!==process.getuid?.()||!Number.isSafeInteger(pool.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1)throw Error('NATIVE_OEX_OWNER');
  abort=()=>{closeSelectedNativeUploadSlot(uploadSlot);closeSelectedStudioPutSlot(saveSlot);void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();signal.throwIfAborted();
  const rootBefore=await lstat(root,{bigint:true});if(!rootBefore.isDirectory()||rootBefore.isSymbolicLink()||(rootBefore.mode&0o077n)!==0n||rootBefore.uid!==BigInt(ownerUid)||await realpath(root)!==root||await realpath(blobs.root)!==blobs.root)throw Error('NATIVE_OEX_OWNER');
  rootHandle=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const rootFd=await rootHandle.stat({bigint:true});if(rootFd.dev!==rootBefore.dev||rootFd.ino!==rootBefore.ino)throw Error('NATIVE_OEX_OWNER');
  payload=await pinNativeOexPayloadManifest(input.payloadManifestPath);
  const assertLive=async()=>{signal.throwIfAborted();if(!channel.isOpen())throw Error('NATIVE_OEX_OWNER');const named=await lstat(root,{bigint:true}),held=await rootHandle!.stat({bigint:true});if(!named.isDirectory()||named.isSymbolicLink()||named.dev!==rootBefore.dev||named.ino!==rootBefore.ino||held.dev!==rootBefore.dev||held.ino!==rootBefore.ino||(named.mode&0o077n)!==0n||named.uid!==BigInt(ownerUid)||await realpath(root)!==root)throw Error('NATIVE_OEX_OWNER');await payload!.verify();signal.throwIfAborted();};
  const databaseOwner=await transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");return publicationDiskOwner(c,blobs.root);});
  const assertDatabase=async(c:PoolClient)=>{if(!isDeepStrictEqual(await publicationDiskOwner(c,blobs.root),databaseOwner))throw Error('NATIVE_OEX_OWNER');};
  const owner={assertLive,assertDatabase,runScoped:async<T>(work:()=>Promise<T>)=>{await assertLive();const result=await work();await assertLive();return result;}};
  const journalRoot=join(root,`native-oex-journal-${runtimeGeneration}`),budgetRoot=join(root,`native-oex-budget-${runtimeGeneration}`);await mkdir(journalRoot,{mode:0o700});await mkdir(budgetRoot,{mode:0o700});
  const journal=new PublicationAttempts(journalRoot,{resourceClaims:true}),provider=await PublicationDiskBudget.open(budgetRoot,{claimJournal:await journal.claimJournalIdentity()});
  ownedPool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:30000});ownedPool.on('error',()=>{});const lifecycle=new FileOperationLifecycle(ownedPool,1,30000);
  const accepted=await acceptNativeOexSelection({pool,channel,workspaceId,tenantId,principalId,runtimeGeneration,ownerUid,verifyOwner:assertLive,assertDatabase,install:chosen=>installSelectedNativeUpload(uploadSlot,owner,chosen),signal}),selection=accepted.selection;
  diagnostic.step('owner-selected');
  const scheduleExpiry=()=>{const remaining=accepted.expiresAt-Date.now();if(!Number.isFinite(remaining)||remaining<=0){closeSelectedNativeUploadSlot(uploadSlot);closeSelectedStudioPutSlot(saveSlot);void channel.close().catch(()=>{});return;}expiryTimer=setTimeout(scheduleExpiry,Math.min(remaining,2147483647));};scheduleExpiry();
  const rawOpen=await channel.receive(0),openFrame=parseNativeOwnerOperation(rawOpen);if(openFrame.kind!=='claim-open'||openFrame.workspaceId!==workspaceId||openFrame.tenantId!==tenantId||openFrame.runtimeGeneration!==runtimeGeneration)throw Error('NATIVE_OEX_OWNER');await assertLive();
  const snapshot=await transaction(pool,async c=>{
   await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
   const user=(await c.query("SELECT a.id,a.expires_at,m.role FROM local_workspaces w JOIN auth_sessions a ON (a.tenant_id,a.user_id)=(w.tenant_id,w.user_id) JOIN users u ON u.id=a.user_id JOIN tenants t ON t.id=a.tenant_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND a.id=$5 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL AND m.role='admin'",[workspaceId,tenantId,principalId,ownerUid,selection.sessionId])).rows[0];
   const job=(await c.query("SELECT id FROM oex_import_jobs WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND request_id=$4 AND expected_bytes=$5 AND payload_sha256=$6 AND state='queued' AND archive_profile='bounded-file-v1' AND oex_format='1.0.0-draft.9' FOR UPDATE",[tenantId,principalId,openFrame.jobId,selection.requestId,selection.bytes,selection.sha256])).rows[0];
   if(!user||user.id!==selection.sessionId||!(user.expires_at instanceof Date)||!job)throw Error('NATIVE_OEX_OWNER');
   const session:Session={id:user.id,tenantId,userId:principalId,role:'admin',csrfToken:'',expiresAt:user.expires_at.toISOString()};return {session,owner:await publicationDiskOwner(c,blobs.root)};
  });
  diagnostic.step('owner-snapshot');
  if(!isDeepStrictEqual(snapshot.owner,databaseOwner))throw Error('NATIVE_OEX_OWNER');await assertLive();const attemptId=randomUUID(),generation=randomUUID(),stageId=randomUUID(),reservationId=randomUUID(),digest=createHash('sha256').update(JSON.stringify({version:1,kind:'native-oex-import',workspaceId,jobId:openFrame.jobId,requestId:selection.requestId,bytes:selection.bytes,sha256:selection.sha256})).digest('hex');
  const request={operation:'oex-import' as const,purpose:'import' as const,tenantId,resourceId:workspaceId,attemptId,generation,runtimeGeneration,userId:principalId,requestId:selection.requestId,requestDigest:digest,sourceDigest:selection.sha256,stageId,reservationId,owner:snapshot.owner,plan:[{root:join(root,`native-oex-stage-${runtimeGeneration}`),bytes:selection.bytes+512*1024*1024},{root:blobs.root,bytes:512*1024*1024}]};
  const oex=new Oex(pool,blobs),completion:{value?:{correlationId:string;attemptId:string;exhibitionId:string;etag:string;requestId:string}}={};
  const result=await runBoundedOexOwnerOperation({lifecycle,pool,blobs,oex,journal,provider,session:snapshot.session,workspaceId,selection:{jobId:openFrame.jobId,requestId:selection.requestId,bytes:selection.bytes,sha256:selection.sha256},request,rawOpen,secret,workerDigest:payload.digest,channel,verifyOwner:assertLive,signal,diagnostic,
   prepareSettlement:async()=>{await drainSelectedNativeUploadSlot(uploadSlot);await drainSelectedStudioPutSlot(saveSlot);await assertLive();},
   settlementOutcome:()=>{const saved=completion.value;if(!saved)throw Error('NATIVE_OEX_OWNER');return {exhibitionId:saved.exhibitionId,etag:saved.etag,requestId:saved.requestId};},
   afterCommit:async(committed,combined,claim)=>{
    let saveRequestId=randomUUID();if(saveRequestId===selection.requestId)saveRequestId=randomUUID();if(saveRequestId===selection.requestId)throw Error('NATIVE_OEX_OWNER');
    const expected:SelectedStudioClaim={sessionId:selection.sessionId,tenantId,principalId,workspaceId,runtimeGeneration,jobId:claim.jobId,attemptId:claim.attemptId,generation:claim.generation,stageId:claim.stageId,reservationId:claim.reservationId,reservationGeneration:claim.reservationGeneration,exhibitionId:committed.exhibitionId,requestId:saveRequestId};
    const saveOwner={assertDatabase,assertLive:async()=>{combined.throwIfAborted();await assertLive();combined.throwIfAborted();},runScoped:async<T>(work:()=>Promise<T>)=>{combined.throwIfAborted();await assertLive();const value=await work();await assertLive();combined.throwIfAborted();return value;},assertCommittedImport:async(value:Readonly<SelectedStudioClaim>)=>{if(!isDeepStrictEqual(value,expected))throw Error('NATIVE_OEX_OWNER');await claim.assertCommitted();}};
    const observed=awaitSelectedStudioPut(saveSlot);void observed.catch(()=>{});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     const initial=await armSelectedStudioPut(saveSlot,saveOwner,expected);if(initial.etag!==committed.etag||!isDeepStrictEqual(initial.draft,committed.draft))throw Error('NATIVE_OEX_OWNER');
     timer=setTimeout(()=>{closeSelectedStudioPutSlot(saveSlot);void channel.close().catch(()=>{});},120000);
     const correlationId=randomUUID();diagnostic.step('save-ready-send-start');await channel.send(Buffer.from(JSON.stringify({version:1,kind:'save-ready',correlationId,attemptId:claim.attemptId,exhibitionId:committed.exhibitionId,etag:initial.etag,requestId:saveRequestId})));
     const raw=await channel.receive(120000);traceNativeOexSelected('save-observed-received');if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('NATIVE_OEX_OWNER');let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('NATIVE_OEX_OWNER');}
     if(!value||typeof value!=='object'||Array.isArray(value))throw Error('NATIVE_OEX_OWNER');const message=value as Record<string,unknown>,keys=['version','kind','correlationId','attemptId','exhibitionId','etag','requestId'];
     if(Object.keys(message).length!==keys.length||keys.some(k=>!Object.hasOwn(message,k))||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,message[k]])))||message.version!==1||message.kind!=='save-observed'||message.correlationId!==correlationId||message.attemptId!==claim.attemptId||message.exhibitionId!==committed.exhibitionId||message.requestId!==saveRequestId||typeof message.etag!=='string')throw Error('NATIVE_OEX_OWNER');
     traceNativeOexSelected('save-observed-frame-validated');
     const saved=await observed;traceNativeOexSelected('put-observer-resolved');await claim.assertCommitted();const reopened=await readFreshStudio(pool,snapshot.session,committed.exhibitionId,assertDatabase);if(saved.etag!==message.etag||saved.revision!==initial.revision+1||!isDeepStrictEqual(saved.draft,initial.draft)||!isDeepStrictEqual(reopened,saved))throw Error('NATIVE_OEX_OWNER');traceNativeOexSelected('independent-reopen-matched');
     combined.throwIfAborted();await claim.assertCommitted();await channel.send(Buffer.from(JSON.stringify({version:1,kind:'save-verified',correlationId,attemptId:claim.attemptId,exhibitionId:committed.exhibitionId,etag:saved.etag,requestId:saveRequestId})));traceNativeOexSelected('save-verified-sent');
     completion.value={correlationId,attemptId:claim.attemptId,exhibitionId:committed.exhibitionId,etag:saved.etag,requestId:saveRequestId};
    }finally{if(timer)clearTimeout(timer);closeSelectedStudioPutSlot(saveSlot);await observed.catch(()=>{});}
   }});
  traceNativeOexSelected('lifecycle-returned');const finished=completion.value;if(!finished)throw Error('NATIVE_OEX_OWNER');traceNativeOexSelected('upload-drain-start');await drainSelectedNativeUploadSlot(uploadSlot);traceNativeOexSelected('upload-drain-returned');traceNativeOexSelected('save-drain-start');await drainSelectedStudioPutSlot(saveSlot);traceNativeOexSelected('save-drain-returned');traceNativeOexSelected('final-live-start');await assertLive();traceNativeOexSelected('final-live-returned');
  // This is selected-flow completion only. It asserts neither journal/space
  // retirement nor successful advisory unlock or native process exit.
  await ownedPool.end();ownedPool=undefined;await payload.close();payload=undefined;await rootHandle.close();rootHandle=undefined;cleaned=true;signal.throwIfAborted();if(!channel.isOpen())throw Error('NATIVE_OEX_OWNER');
  diagnostic.step('completion-send-start');traceNativeOexSelected('complete-send-start');await channel.send(Buffer.from(JSON.stringify({version:1,kind:'operation-complete',correlationId:finished.correlationId,attemptId:finished.attemptId,exhibitionId:finished.exhibitionId,etag:finished.etag,requestId:finished.requestId})));traceNativeOexSelected('complete-send-returned');return result;
 }catch(error){diagnostic.fail(error,channel);try{console.error(diagnostic.report());}catch{}if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(expiryTimer)clearTimeout(expiryTimer);if(abort)signal.removeEventListener('abort',abort);secret.fill(0);if(!cleaned){closeSelectedNativeUploadSlot(uploadSlot);closeSelectedStudioPutSlot(saveSlot);await drainSelectedNativeUploadSlot(uploadSlot);await awaitSelectedStudioPut(saveSlot).catch(()=>{});await ownedPool?.end().catch(()=>{});await payload?.close().catch(()=>{});await rootHandle?.close().catch(()=>{});}}
}
async function readFreshStudio(pool:Pool,s:Session,id:string,assertDatabase:(c:PoolClient)=>Promise<void>):Promise<StudioResponse>{
 return transaction(pool,async c=>{
  await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  const check=async()=>{const r=await c.query("SELECT m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL",[s.id,s.tenantId,s.userId]);if(r.rowCount!==1||r.rows[0]?.role!==s.role)throw Error('NATIVE_OEX_OWNER');};
  await assertDatabase(c);await check();const result=await new Studio().get(c,s,id);await check();await assertDatabase(c);return result;
 });
}
