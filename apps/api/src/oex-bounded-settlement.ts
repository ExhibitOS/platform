// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {FileBlobStore,transaction} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {PublicationAttempts,publicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {readWorkspaceOexTerminalProof} from './workspace-oex-terminal-proof.ts';
import {verifyWorkspaceOexCommitted} from './workspace-oex-terminal-committed.ts';

type CommittedOwner=Parameters<typeof verifyWorkspaceOexCommitted>[2];
type Finalized=Parameters<PublicationAttempts['verifySelectedWorkspaceOexFinalization']>[1];
type DiskOwner=Awaited<ReturnType<typeof publicationDiskOwner>>;
/** Trusted native-owner operation, not an HTTP cleanup endpoint. The caller
 * holds the exclusive current workspace fence and proves actual owned drain.
 * Retired journal evidence alone is insufficient. Reuse after a partial delete
 * or lost response with fresh owner/Session checks; never repeat the import.
 * Only the completed draft.12 job's exact upload chunks are removed. Imported
 * assets, source custody, result/proof and both key inventories are retained. */
export async function settleBoundedWorkspaceOexCleanup(input:{pool:Pool;blobs:FileBlobStore;journal:PublicationAttempts;provider:PublicationDiskBudget;session:Session;owner:CommittedOwner;diskOwner:DiskOwner;scope:Finalized['scope'];proofBytes:Uint8Array;resultBytes:Uint8Array;save:Finalized['save'];assertRecovery:()=>Promise<void>}){
 const {pool,blobs,journal,provider,owner,assertRecovery}=input;
 if(!(blobs instanceof FileBlobStore)||!(journal instanceof PublicationAttempts)||!(provider instanceof PublicationDiskBudget)||typeof assertRecovery!=='function'||blobs.root!==input.diskOwner.storeRoot)throw Error('OEX_BOUNDED_CLEANUP');
 const session=structuredClone(input.session),scope=structuredClone(input.scope),save=structuredClone(input.save),diskOwner=structuredClone(input.diskOwner),proofBytes=Buffer.from(input.proofBytes),resultBytes=Buffer.from(input.resultBytes);
 if(session.tenantId!==scope.tenantId||session.userId!==scope.principalId||owner.workspaceId!==scope.workspaceId||owner.tenantId!==scope.tenantId||owner.principalId!==scope.principalId)throw Error('OEX_BOUNDED_CLEANUP');
 readWorkspaceOexTerminalProof(scope,{proofBytes,resultBytes});const expectedResult:unknown=JSON.parse(resultBytes.toString('utf8'));
 const verifyRetired=()=>journal.verifySelectedWorkspaceOexFinalization(provider,{scope,proofBytes,resultBytes,save,assertRecovery,verifyCommitted:value=>verifyWorkspaceOexCommitted(pool,session,owner,{scope,proofBytes:value.proofBytes,resultBytes:value.resultBytes,claimSha256:value.claimSha256,save:value.save})});
 await verifyRetired();
 return transaction(pool,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await assertRecovery();await owner.assertDatabase(c);await owner.assertImportCatalog(c);
  if(!isDeepStrictEqual(await publicationDiskOwner(c,blobs.root),diskOwner))throw Error('OEX_BOUNDED_CLEANUP');
  const found=await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[scope.tenantId,scope.jobId]),row=found.rows[0];
  if(found.rowCount!==1||row.user_id!==scope.principalId||row.request_id!==scope.importRequestId||row.payload_sha256!==scope.sourceArchiveSha256||row.archive_profile!=='bounded-file-v1'||row.oex_format!=='1.0.0-draft.12'||row.state!=='complete'||row.lease_id!==null||row.lease_until!==null||typeof row.cleanup_pending!=='boolean'||!isDeepStrictEqual(row.result,expectedResult))throw Error('OEX_BOUNDED_CLEANUP');
  const bytes=Number(row.expected_bytes);if(!Number.isSafeInteger(bytes)||bytes<1||bytes>512*1024*1024)throw Error('OEX_BOUNDED_CLEANUP');
  const keys=Array.from({length:Math.ceil(bytes/(16*1024*1024))},(_,i)=>`${scope.tenantId}/oex-staging/${scope.jobId}/chunk-${i}`);
  if(!isDeepStrictEqual(row.staging_keys,keys)||!Array.isArray(row.cleanup_keys)||row.cleanup_keys.some((key:unknown)=>typeof key!=='string'||!key.startsWith(`${scope.tenantId}/oex-import/${scope.jobId}/${scope.attemptId}/`)))throw Error('OEX_BOUNDED_CLEANUP');
  // A retry also revalidates authority and durably observes absence. A failed
  // unlink/fsync or uncertain DB commit retains the original evidence and can
  // safely repeat these exact removals after owner recovery.
  for(const key of keys){await assertRecovery();await blobs.removeDurable(key);}
  await verifyRetired();await assertRecovery();await owner.assertDatabase(c);await owner.assertImportCatalog(c);
  if(!isDeepStrictEqual(await publicationDiskOwner(c,blobs.root),diskOwner))throw Error('OEX_BOUNDED_CLEANUP');
  const updated=await c.query('UPDATE oex_import_jobs SET cleanup_pending=false,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND cleanup_pending RETURNING id',[scope.tenantId,scope.jobId]);
  if(updated.rowCount!==(row.cleanup_pending?1:0))throw Error('OEX_BOUNDED_CLEANUP');
  return {id:scope.jobId,state:'complete' as const,cleanupPending:false as const,stagingChunks:keys.length};
 });
}
