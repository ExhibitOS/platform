-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Selected native catalog only. A row is authenticated completion evidence
-- supplied by the original live Manager session, never a lock-absence proof.
CREATE TABLE hayes_native_releases (
 tenant_id uuid NOT NULL, attempt_id uuid NOT NULL, job_id uuid NOT NULL,
 disposition_id uuid NOT NULL, stage_id uuid NOT NULL, native_owner_id uuid NOT NULL,
 runtime_manifest_sha256 text NOT NULL CHECK(runtime_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 worker_manifest_sha256 text NOT NULL CHECK(worker_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 native_evidence_sha256 text NOT NULL CHECK(native_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 ready_frame_sha256 text NOT NULL CHECK(ready_frame_sha256 ~ '^[0-9a-f]{64}$'),
 database_system_identifier text NOT NULL CHECK(database_system_identifier ~ '^[1-9][0-9]{0,19}$' AND database_system_identifier::numeric<=18446744073709551615),
 database_oid text NOT NULL CHECK(database_oid ~ '^[1-9][0-9]{0,9}$' AND database_oid::numeric<=4294967295),
 challenge uuid NOT NULL,
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 intent_sha256 text NOT NULL CHECK(intent_sha256 ~ '^[0-9a-f]{64}$'),
 completion_sha256 text NOT NULL CHECK(completion_sha256 ~ '^[0-9a-f]{64}$'),
 completion_canonical bytea NOT NULL CHECK(octet_length(completion_canonical) BETWEEN 1 AND 8192),
 completion_frame_sha256 text NOT NULL CHECK(completion_frame_sha256 ~ '^[0-9a-f]{64}$' AND encode(sha256(completion_canonical),'hex')=completion_frame_sha256),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,attempt_id), UNIQUE(tenant_id,disposition_id),
 FOREIGN KEY(tenant_id,disposition_id,attempt_id,job_id) REFERENCES hayes_original_dispositions(tenant_id,id,attempt_id,job_id),
 FOREIGN KEY(tenant_id,stage_id,attempt_id,job_id) REFERENCES hayes_output_stages(tenant_id,id,attempt_id,job_id)
);
CREATE FUNCTION protect_hayes_native_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frame jsonb; system_id text; db_oid text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Hayes release evidence immutable'; END IF;
 SELECT (pg_control_system()).system_identifier::text,oid::text INTO system_id,db_oid FROM pg_database WHERE datname=current_database();
 IF system_id IS DISTINCT FROM NEW.database_system_identifier OR db_oid IS DISTINCT FROM NEW.database_oid THEN RAISE EXCEPTION 'Hayes release database invalid'; END IF;
 frame:=convert_from(NEW.completion_canonical,'UTF8')::jsonb;
 PERFORM 1 FROM import_jobs WHERE (tenant_id,id)=(NEW.tenant_id,NEW.job_id) FOR UPDATE;
 IF NOT EXISTS (
  SELECT 1 FROM hayes_original_dispositions d
  JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(d.tenant_id,d.attempt_id,d.job_id)
  JOIN import_jobs j ON (j.tenant_id,j.id,j.hayes_attempt_id,j.hayes_disposition_id)=(d.tenant_id,d.job_id,d.attempt_id,d.id)
  WHERE (d.tenant_id,d.id,d.attempt_id,d.job_id,d.stage_id)=(NEW.tenant_id,NEW.disposition_id,NEW.attempt_id,NEW.job_id,NEW.stage_id)
   AND j.state='approved' AND j.lease_id=a.lease_id AND j.lease_until>clock_timestamp()
   AND (d.native_owner_id,d.runtime_manifest_sha256,d.worker_manifest_sha256,d.native_evidence_sha256,d.database_system_identifier,d.database_oid,d.receipt_sha256)=(NEW.native_owner_id,NEW.runtime_manifest_sha256,NEW.worker_manifest_sha256,NEW.native_evidence_sha256,NEW.database_system_identifier,NEW.database_oid,NEW.receipt_sha256)
   AND frame=jsonb_build_object('version',1,'kind','hayes-release-completed','binding',jsonb_build_object('version',1,'tenantId',a.tenant_id::text,'workspaceId',a.workspace_id::text,'principalId',a.principal_id::text,'jobId',a.job_id::text,'leaseId',a.lease_id::text,'attemptId',a.id::text,'runtimeGeneration',a.runtime_generation::text,'artworkId',a.artwork_id::text,'correlationId',a.correlation_id::text,'artworkRevision',a.artwork_revision,'sourceSha256',a.source_sha256,'sourceBytes',a.source_bytes),'nativeOwnerId',NEW.native_owner_id::text,'runtimeManifestSha256',NEW.runtime_manifest_sha256,'workerManifestSha256',NEW.worker_manifest_sha256,'nativeEvidenceSha256',NEW.native_evidence_sha256,'readyFrameSha256',NEW.ready_frame_sha256,'dbStageId',NEW.stage_id::text,'database',jsonb_build_object('systemIdentifier',NEW.database_system_identifier,'databaseOid',NEW.database_oid),'challenge',NEW.challenge::text,'receiptId',NEW.disposition_id::text,'receiptSha256',NEW.receipt_sha256,'intentSha256',NEW.intent_sha256,'completionSha256',NEW.completion_sha256)
 ) THEN RAISE EXCEPTION 'Hayes release evidence invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_native_release_guard BEFORE INSERT OR UPDATE OR DELETE ON hayes_native_releases FOR EACH ROW EXECUTE FUNCTION protect_hayes_native_release();
