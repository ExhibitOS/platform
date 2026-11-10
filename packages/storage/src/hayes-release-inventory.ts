// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
type ExactHayesRelease = {
 workspaceId: string;
 principalId: string;
 jobId: string;
 completionFrameSha256: string;
};
/** Historical inventory can be read after a database restore. The exact
 * preservation selection instead requires the original physical database. */
export async function confirmedHayesReleaseBindings(c:PoolClient,tenantId?:string,exact?:ExactHayesRelease):Promise<Set<string>>{
 const exactFilter=exact?`AND (a.workspace_id,a.principal_id,r.job_id,r.completion_frame_sha256)=($2::uuid,$3::uuid,$4::uuid,$5::text)
   AND j.user_id=a.principal_id AND j.artwork_id=a.artwork_id
   AND j.lease_until IS NOT NULL AND cardinality(j.png_worker_tokens)=0 AND (j.model_preparation ? 'claim') IS NOT TRUE
   AND r.database_system_identifier=(pg_control_system()).system_identifier::text
   AND r.database_oid=(SELECT oid::text FROM pg_database WHERE datname=current_database())`:'';
 const parameters=exact?[tenantId??null,exact.workspaceId,exact.principalId,exact.jobId,exact.completionFrameSha256]:[tenantId??null];
 const rows=(await c.query(`SELECT r.tenant_id::text AS tenant_id,r.job_id::text AS job_id,r.stage_id::text AS stage_id
  FROM hayes_native_releases r
  JOIN hayes_original_dispositions d ON (d.tenant_id,d.id,d.attempt_id,d.job_id,d.stage_id)=(r.tenant_id,r.disposition_id,r.attempt_id,r.job_id,r.stage_id)
  JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(r.tenant_id,r.attempt_id,r.job_id)
  JOIN hayes_output_stages s ON (s.tenant_id,s.id,s.attempt_id,s.job_id)=(r.tenant_id,r.stage_id,r.attempt_id,r.job_id)
  JOIN import_jobs j ON (j.tenant_id,j.id,j.hayes_attempt_id,j.hayes_disposition_id)=(r.tenant_id,r.job_id,r.attempt_id,r.disposition_id)
  WHERE ($1::uuid IS NULL OR r.tenant_id=$1::uuid)
   ${exactFilter}
   AND j.state='approved' AND j.lease_id=a.lease_id AND j.approved_key=s.object_key AND j.asset_id=d.display_asset_id
   AND (d.native_owner_id,d.runtime_manifest_sha256,d.worker_manifest_sha256,d.native_evidence_sha256,d.database_system_identifier,d.database_oid,d.receipt_sha256)=(r.native_owner_id,r.runtime_manifest_sha256,r.worker_manifest_sha256,r.native_evidence_sha256,r.database_system_identifier,r.database_oid,r.receipt_sha256)
   AND encode(sha256(r.completion_canonical),'hex')=r.completion_frame_sha256
   AND convert_from(r.completion_canonical,'UTF8')::jsonb=jsonb_build_object('version',1,'kind','hayes-release-completed','binding',jsonb_build_object('version',1,'tenantId',a.tenant_id::text,'workspaceId',a.workspace_id::text,'principalId',a.principal_id::text,'jobId',a.job_id::text,'leaseId',a.lease_id::text,'attemptId',a.id::text,'runtimeGeneration',a.runtime_generation::text,'artworkId',a.artwork_id::text,'correlationId',a.correlation_id::text,'artworkRevision',a.artwork_revision,'sourceSha256',a.source_sha256,'sourceBytes',a.source_bytes),'nativeOwnerId',r.native_owner_id::text,'runtimeManifestSha256',r.runtime_manifest_sha256,'workerManifestSha256',r.worker_manifest_sha256,'nativeEvidenceSha256',r.native_evidence_sha256,'readyFrameSha256',r.ready_frame_sha256,'dbStageId',r.stage_id::text,'database',jsonb_build_object('systemIdentifier',r.database_system_identifier,'databaseOid',r.database_oid),'challenge',r.challenge::text,'receiptId',r.disposition_id::text,'receiptSha256',r.receipt_sha256,'intentSha256',r.intent_sha256,'completionSha256',r.completion_sha256)`,parameters)).rows;
 const bindings=new Set<string>();for(const row of rows){bindings.add(`import_jobs:${row.tenant_id}:${row.job_id}`);bindings.add(`hayes_output_stages:${row.tenant_id}:${row.stage_id}`);}return bindings;
}
