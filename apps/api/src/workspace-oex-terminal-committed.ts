// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@exhibitos/storage';
import {freezeCanonical} from '@exhibitos/studio-contract';
import type {Session} from './auth.ts';
import {uuid} from './auth.ts';
import {etag,type Draft} from './studio.ts';
import {readWorkspaceOexTerminalProof} from './workspace-oex-terminal-proof.ts';

type Scope=Parameters<typeof readWorkspaceOexTerminalProof>[0];
type Save={exhibitionId:string;etag:string;requestId:string};
type Owner={workspaceId:string;tenantId:string;principalId:string;assertDatabase(c:PoolClient):Promise<void>;assertImportCatalog(c:PoolClient):Promise<void>;assertRecord(c:PoolClient,record:Readonly<{workspaceId:string;tenantId:string;principalId:string;importJobId:string;requestId:string;attemptId:string;claimSha256:string;payloadManifestSha256:string;sourceDatabaseSystemId:string;sourceDatabaseOid:string;sourceSha256:string;exhibitionId:string}>):Promise<void>};
/** Verify committed 034 evidence and exact Studio r2 receipt in a separate DB
 * transaction. Caller must provide the actual private runtime owner context,
 * exclude competing workspace operations, and independently prove complete
 * worker/decoder drain and durable settlement/retirement before replay. This
 * helper alone is not replay authority and is not connected to a route. */
type CommittedInput={scope:Scope;proofBytes:Uint8Array;resultBytes:Uint8Array;claimSha256:string;save:Save};
function committedVerification(s:Session,owner:Owner,input:CommittedInput){
 if(!input||typeof input.claimSha256!=='string'||!/^[0-9a-f]{64}$/.test(input.claimSha256)||!(input.proofBytes instanceof Uint8Array)||input.proofBytes.byteLength<1||input.proofBytes.byteLength>8192||!(input.resultBytes instanceof Uint8Array)||input.resultBytes.byteLength<1||input.resultBytes.byteLength>4*1024*1024)throw Error('OEX_TERMINAL_COMMITTED_INVALID');
 const session=structuredClone(s),scope=structuredClone(input.scope),save=structuredClone(input.save),claimSha256=input.claimSha256,proofBytes=Buffer.from(input.proofBytes),resultBytes=Buffer.from(input.resultBytes);
 if(!owner||typeof owner.assertDatabase!=='function'||typeof owner.assertImportCatalog!=='function'||typeof owner.assertRecord!=='function'||owner.workspaceId!==scope.workspaceId||owner.tenantId!==scope.tenantId||owner.principalId!==scope.principalId||session.tenantId!==scope.tenantId||session.userId!==scope.principalId||!['admin','artist'].includes(session.role))throw Error('OEX_TERMINAL_COMMITTED_INVALID');
 if(!save||Object.keys(save).sort().join(',')!=='etag,exhibitionId,requestId'||typeof save.etag!=='string'||!/^"studio-r2-[a-f0-9]{64}"$/.test(save.etag))throw Error('OEX_TERMINAL_COMMITTED_INVALID');
 for(const id of [session.id,save.exhibitionId,save.requestId]){try{uuid(id);}catch{throw Error('OEX_TERMINAL_COMMITTED_INVALID');}if(id!==id.toLowerCase())throw Error('OEX_TERMINAL_COMMITTED_INVALID');}
 const {proof}=readWorkspaceOexTerminalProof(scope,{proofBytes,resultBytes});if(proof.exhibitionId!==save.exhibitionId)throw Error('OEX_TERMINAL_COMMITTED_INVALID');
 const result=JSON.parse(resultBytes.toString('utf8')) as {draft:Draft;etag:string};
 const expectedPayload=createHash('sha256').update(freezeCanonical({method:'PUT',id:save.exhibitionId,match:proof.studioETag,input:{draft:result.draft,requestId:save.requestId}})).digest('hex');
 return async(c:PoolClient)=>{
  const requireActive=()=>lockWorkspaceOexSession(c,session);
  await requireActive();await owner.assertDatabase(c);await owner.assertImportCatalog(c);
  const found=await c.query(`SELECT t.proof_bytes,t.result_bytes,t.result_sha256,p.claim_sha256,p.payload_manifest_sha256,p.source_database_system_id,p.source_database_oid,
   j.result AS job_result,first.snapshot AS initial_snapshot,last.snapshot AS saved_snapshot,r.payload_sha256 AS save_payload,r.response AS save_response
   FROM workspace_oex_import_terminal_proof t
   JOIN native_oex_exhibition_provenance p ON (p.tenant_id,p.import_job_id)=(t.tenant_id,t.import_job_id)
   JOIN oex_import_jobs j ON (j.tenant_id,j.id)=(t.tenant_id,t.import_job_id)
   JOIN exhibition_revisions first ON (first.tenant_id,first.exhibition_id,first.revision)=(t.tenant_id,t.exhibition_id,1)
   JOIN exhibition_revisions last ON (last.tenant_id,last.exhibition_id,last.revision)=(t.tenant_id,t.exhibition_id,2)
   JOIN studio_requests r ON (r.tenant_id,r.user_id,r.request_id,r.exhibition_id)=(t.tenant_id,t.principal_id,$8::uuid,t.exhibition_id)
   WHERE t.workspace_id=$1 AND t.tenant_id=$2 AND t.principal_id=$3 AND t.import_job_id=$4 AND t.attempt_id=$5
    AND t.import_request_id=$6 AND t.source_archive_sha256=$7 AND t.exhibition_id=$9 AND t.immutable_revision_id=$10
    AND p.workspace_id=t.workspace_id AND p.principal_id=t.principal_id AND p.attempt_id=t.attempt_id AND p.exhibition_id=t.exhibition_id AND p.source_sha256=t.source_archive_sha256
    AND j.user_id=t.principal_id AND j.request_id=t.import_request_id AND j.payload_sha256=t.source_archive_sha256 AND j.state='complete' AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'`,[scope.workspaceId,scope.tenantId,scope.principalId,scope.jobId,scope.attemptId,scope.importRequestId,scope.sourceArchiveSha256,save.requestId,proof.exhibitionId,proof.immutableRevisionId]);
  if(found.rowCount!==1)throw Error('OEX_TERMINAL_COMMITTED_INVALID');const row=found.rows[0],response=row.save_response;
  if(!Buffer.isBuffer(row.proof_bytes)||!row.proof_bytes.equals(proofBytes)||!Buffer.isBuffer(row.result_bytes)||!row.result_bytes.equals(resultBytes)||row.result_sha256!==proof.resultSha256||row.claim_sha256!==claimSha256||!isDeepStrictEqual(row.job_result,JSON.parse(resultBytes.toString('utf8')))||!isDeepStrictEqual(row.initial_snapshot,result.draft)||!isDeepStrictEqual(row.saved_snapshot,result.draft)||row.save_payload!==expectedPayload||!response||Object.keys(response).sort().join(',')!=='draft,etag,revision'||response.revision!==2||response.etag!==save.etag||!isDeepStrictEqual(response.draft,row.saved_snapshot)||etag(2,response.draft)!==save.etag)throw Error('OEX_TERMINAL_COMMITTED_INVALID');
  await owner.assertRecord(c,Object.freeze({workspaceId:scope.workspaceId,tenantId:scope.tenantId,principalId:scope.principalId,importJobId:scope.jobId,requestId:scope.importRequestId,attemptId:scope.attemptId,claimSha256:row.claim_sha256,payloadManifestSha256:row.payload_manifest_sha256,sourceDatabaseSystemId:row.source_database_system_id,sourceDatabaseOid:row.source_database_oid,sourceSha256:scope.sourceArchiveSha256,exhibitionId:proof.exhibitionId}));await owner.assertImportCatalog(c);await owner.assertDatabase(c);await requireActive();
 };
}

/** Hold current auth rows until the caller commits; expiry uses wall time. */
export async function lockWorkspaceOexSession(c:PoolClient,session:Session){const active=await c.query("SELECT m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL FOR SHARE OF a,u,m,t",[session.id,session.tenantId,session.userId]);if(active.rowCount!==1||active.rows[0]?.role!==session.role)throw Error('OEX_TERMINAL_COMMITTED_INVALID');}

/** Existing separately owned verification transaction. */
export async function verifyWorkspaceOexCommitted(pool:Pool,s:Session,owner:Owner,input:CommittedInput){
 const verify=committedVerification(s,owner,input);
 await transaction(pool,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await verify(c);
 });
}
/** Reuse a caller's READ COMMITTED transaction and already-held 82003→82002
 * fence. This is only the same domain proof read: it does not acquire a new
 * connection, start/commit a transaction, or reacquire advisory locks. */
export async function verifyWorkspaceOexCommittedOnClient(c:PoolClient,s:Session,owner:Owner,input:CommittedInput){
 await committedVerification(s,owner,input)(c);
}
