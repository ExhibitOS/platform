// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {Auth,uuid} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {PublicationAttempts,publicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {settleBoundedWorkspaceOexCleanup} from './oex-bounded-settlement.ts';

type Selection={jobId:string;importRuntimeGeneration:string};
export function parseNativeOexCleanupSelection(raw:unknown):Selection|undefined{
 if(raw===undefined)return undefined;
 if(typeof raw!=='string'||Buffer.byteLength(raw)>256)throw Error('NATIVE_OEX_CLEANUP_SELECTION');
 let value;try{value=JSON.parse(raw);}catch{throw Error('NATIVE_OEX_CLEANUP_SELECTION');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='importRuntimeGeneration,jobId')throw Error('NATIVE_OEX_CLEANUP_SELECTION');
 for(const field of ['jobId','importRuntimeGeneration']){uuid(value[field]);if(value[field]!==value[field].toLowerCase())throw Error('NATIVE_OEX_CLEANUP_SELECTION');}
 return {jobId:value.jobId,importRuntimeGeneration:value.importRuntimeGeneration};
}
async function privateDirectory(path:string){const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||await realpath(path)!==path)throw Error('NATIVE_OEX_CLEANUP_EVIDENCE');}
async function retained(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const st=await file.stat();if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size<1||st.size>131072)throw Error('NATIVE_OEX_CLEANUP_EVIDENCE');return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
}
/** Startup-only native clean-reopen consumer. The runtime must supply its
 * issued exclusive writer/admission guard, current private-channel credentials
 * and bound context, before exposing readiness or starting ordinary workers.
 * Selection is only two IDs: paths, credentials and proof cannot be supplied
 * by a user/HTTP caller. Never scans or automatically settles other jobs. */
export async function runNativeOexCleanup(input:{pool:Pool;blobs:FileBlobStore;context:NativeOexWorkspaceContext;selection:Selection;sessionToken:string;csrfToken:string;assertRecovery:()=>Promise<void>}){
 const {pool,blobs,context,assertRecovery}=input,selection=parseNativeOexCleanupSelection(JSON.stringify(input.selection))!;
 if(!(blobs instanceof FileBlobStore)||!context.workspaceImport||typeof context.matchesBlobRoot!=='function'||!context.matchesBlobRoot(blobs.root)||typeof context.assertImportCatalog!=='function'||typeof assertRecovery!=='function')throw Error('NATIVE_OEX_CLEANUP_OWNER');
 await assertRecovery();
 const selected=await new Auth(pool).requestForNativeWorkspaceMutation(input.sessionToken,context.tenantId,input.csrfToken,async(c,session)=>{
  if(session.userId!==context.principalId||session.role!=='admin')throw Error('NATIVE_OEX_CLEANUP_OWNER');
  await assertRecovery();await context.assertDatabase(c);await context.assertImportCatalog!(c);
  const found=await c.query(`SELECT t.attempt_id,t.import_request_id,t.source_archive_sha256,t.proof_bytes,t.result_bytes
   FROM workspace_oex_import_terminal_proof t JOIN oex_import_jobs j ON (j.tenant_id,j.id)=(t.tenant_id,t.import_job_id)
   WHERE t.workspace_id=$1 AND t.tenant_id=$2 AND t.principal_id=$3 AND t.import_job_id=$4
    AND j.user_id=t.principal_id AND j.request_id=t.import_request_id AND j.payload_sha256=t.source_archive_sha256
    AND j.state='complete' AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'`,[context.workspaceId,context.tenantId,context.principalId,selection.jobId]);
  if(found.rowCount!==1)throw Error('NATIVE_OEX_CLEANUP_EVIDENCE');const row=found.rows[0];uuid(row.attempt_id);
  const scope={workspaceId:context.workspaceId,tenantId:context.tenantId,principalId:context.principalId,jobId:selection.jobId,attemptId:row.attempt_id as string,importRequestId:row.import_request_id as string,sourceArchiveSha256:row.source_archive_sha256 as string};
  return {session,scope,proofBytes:row.proof_bytes as Buffer,resultBytes:row.result_bytes as Buffer,diskOwner:await publicationDiskOwner(c,blobs.root)};
 });
 const root=dirname(blobs.root),journalRoot=join(root,`native-oex-journal-${selection.importRuntimeGeneration}`),budgetRoot=join(root,`native-oex-budget-${selection.importRuntimeGeneration}`);
 await privateDirectory(root);await privateDirectory(journalRoot);await privateDirectory(budgetRoot);
 // Require existing markers before opening a provider; recovery must not
 // initialize missing evidence or infer an import generation from a scan.
 await retained(join(journalRoot,'journal-protocol.json'));await retained(join(journalRoot,'claim-provider.json'));await retained(join(budgetRoot,'protocol.json'));
 const claim=await retained(join(journalRoot,selected.scope.attemptId+'.claim.json'));
 if(claim.runtimeGeneration!==selection.importRuntimeGeneration||claim.attemptId!==selected.scope.attemptId||claim.resourceId!==context.workspaceId||claim.tenantId!==context.tenantId||claim.userId!==context.principalId)throw Error('NATIVE_OEX_CLEANUP_EVIDENCE');
 const settlement=await retained(join(journalRoot,selected.scope.attemptId+'.settlement-terminal-v3.json'));
 const journal=new PublicationAttempts(journalRoot,{resourceClaims:true}),provider=await PublicationDiskBudget.open(budgetRoot,{claimJournal:await journal.claimJournalIdentity()});
 const result=await settleBoundedWorkspaceOexCleanup({pool,blobs,journal,provider,session:selected.session,owner:{workspaceId:context.workspaceId,tenantId:context.tenantId,principalId:context.principalId,assertDatabase:context.assertDatabase,assertImportCatalog:context.assertImportCatalog,assertRecord:context.assertRecord},diskOwner:selected.diskOwner,scope:selected.scope,proofBytes:selected.proofBytes,resultBytes:selected.resultBytes,save:settlement.save,assertRecovery});
 await assertRecovery();return {version:1 as const,jobId:result.id,importRuntimeGeneration:selection.importRuntimeGeneration,state:result.state,cleanupPending:result.cleanupPending,stagingChunks:result.stagingChunks};
}

/** Preserve the ordinary stop/drain boundary on a recoverable cleanup error.
 * No failed operation is reported as successful, and uncertain commit state
 * stays unknown. Loss of the owner fence still rejects and requires recovery. */
export async function attemptNativeOexCleanup(input:Parameters<typeof runNativeOexCleanup>[0]){
 try{return await runNativeOexCleanup(input);}catch{
  await input.assertRecovery();
  return {version:1 as const,jobId:input.selection.jobId,importRuntimeGeneration:input.selection.importRuntimeGeneration,state:'unresolved' as const,cleanupPending:null,errorCode:'NATIVE_OEX_CLEANUP_FAILED' as const};
 }
}
