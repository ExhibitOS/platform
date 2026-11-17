-- SPDX-License-Identifier: Apache-2.0
-- Selected successor only. Retain the original claim, lease and blob.
CREATE TABLE hayes_preopen_terminals (
 tenant_id uuid NOT NULL, attempt_id uuid NOT NULL, job_id uuid NOT NULL,
 proof_canonical bytea NOT NULL CHECK(octet_length(proof_canonical) BETWEEN 1 AND 4096),
 proof_sha256 text NOT NULL CHECK(encode(sha256(proof_canonical),'hex')=proof_sha256),
 PRIMARY KEY(tenant_id,attempt_id), UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,attempt_id,job_id) REFERENCES hayes_original_attempts(tenant_id,id,job_id)
);
CREATE TRIGGER hayes_preopen_terminal_immutable BEFORE UPDATE OR DELETE ON hayes_preopen_terminals
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();

CREATE FUNCTION check_hayes_preopen_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof jsonb; binding record;
BEGIN
 PERFORM 1 FROM import_jobs WHERE (tenant_id,id)=(NEW.tenant_id,NEW.job_id) FOR UPDATE;
 SELECT a.*,j.lease_until INTO binding
 FROM hayes_original_attempts a JOIN import_jobs j
 ON (j.tenant_id,j.id,j.hayes_attempt_id,j.lease_id,j.artwork_id,j.user_id)
  =(a.tenant_id,a.job_id,a.id,a.lease_id,a.artwork_id,a.principal_id)
 WHERE (a.tenant_id,a.id,a.job_id)=(NEW.tenant_id,NEW.attempt_id,NEW.job_id)
 AND j.state='processing' AND j.attempts=1 AND j.progress=25 AND j.lease_until<=clock_timestamp()
 AND j.asset_id IS NULL AND j.original_asset_id IS NULL AND j.hayes_disposition_id IS NULL
 AND NOT EXISTS (SELECT 1 FROM hayes_output_stages s WHERE s.tenant_id=j.tenant_id AND (s.job_id=j.id OR s.attempt_id=a.id))
 AND NOT EXISTS (SELECT 1 FROM hayes_original_dispositions d WHERE d.tenant_id=j.tenant_id AND (d.job_id=j.id OR d.attempt_id=a.id))
 AND NOT EXISTS (SELECT 1 FROM hayes_native_releases r WHERE r.tenant_id=j.tenant_id AND (r.job_id=j.id OR r.attempt_id=a.id));
 IF NOT FOUND THEN RAISE EXCEPTION 'Hayes pre-OPEN terminal claim invalid'; END IF;
 proof:=convert_from(NEW.proof_canonical,'UTF8')::jsonb;
 IF proof->>'kind' IS DISTINCT FROM 'hayes-preopen-claim-observation'
 OR proof->'version' IS DISTINCT FROM '1'::jsonb
 OR (proof->>'tenantId',proof->>'workspaceId',proof->>'principalId',proof->>'jobId',proof->>'artworkId',proof->>'artworkRevision')
  IS DISTINCT FROM (binding.tenant_id::text,binding.workspace_id::text,binding.principal_id::text,binding.job_id::text,binding.artwork_id::text,binding.artwork_revision::text)
 OR (proof#>>'{claim,attemptId}',proof#>>'{claim,leaseId}',proof#>>'{claim,correlationId}',proof#>>'{claim,generation}')
  IS DISTINCT FROM (binding.id::text,binding.lease_id::text,binding.correlation_id::text,binding.runtime_generation::text)
 OR (proof#>>'{claim,leaseUntil}')::timestamptz IS DISTINCT FROM binding.lease_until
 OR proof#>>'{claim,systemId}' IS DISTINCT FROM (pg_control_system()).system_identifier::text
 OR proof#>>'{claim,databaseOid}' IS DISTINCT FROM (SELECT oid::text FROM pg_database WHERE datname=current_database())
 OR proof#>'{claim,leaseExpired}' IS DISTINCT FROM 'true'::jsonb
 OR proof->>'state' IS DISTINCT FROM 'processing' OR proof->'attempts' IS DISTINCT FROM '1'::jsonb OR proof->'progress' IS DISTINCT FROM '25'::jsonb
 OR (proof->'outputStagePresent',proof->'dispositionPresent',proof->'releasePresent',proof->'openJournalPresent')
  IS DISTINCT FROM ('false'::jsonb,'false'::jsonb,'false'::jsonb,'false'::jsonb)
 THEN RAISE EXCEPTION 'Hayes pre-OPEN terminal proof invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_preopen_terminal_check BEFORE INSERT ON hayes_preopen_terminals
 FOR EACH ROW EXECUTE FUNCTION check_hayes_preopen_terminal();

CREATE FUNCTION check_hayes_preopen_terminal_cancelled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM import_jobs j WHERE (j.tenant_id,j.id,j.hayes_attempt_id)=(NEW.tenant_id,NEW.job_id,NEW.attempt_id) AND j.state='cancelled')
 THEN RAISE EXCEPTION 'Hayes pre-OPEN terminal outcome incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER hayes_preopen_terminal_cancelled AFTER INSERT ON hayes_preopen_terminals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_hayes_preopen_terminal_cancelled();

-- Only this job's inventory item is resolved. The original blob remains required.
CREATE VIEW hayes_preopen_terminal_bindings AS
 SELECT t.tenant_id,t.job_id,t.attempt_id,t.proof_canonical,t.proof_sha256,a.workspace_id,a.principal_id
 FROM hayes_preopen_terminals t
 JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(t.tenant_id,t.attempt_id,t.job_id)
 JOIN import_jobs j ON (j.tenant_id,j.id,j.hayes_attempt_id,j.lease_id)=(a.tenant_id,a.job_id,a.id,a.lease_id)
 WHERE j.state='cancelled' AND j.asset_id IS NULL AND j.original_asset_id IS NULL AND j.hayes_disposition_id IS NULL
 AND NOT EXISTS (SELECT 1 FROM hayes_output_stages s WHERE s.tenant_id=j.tenant_id AND (s.job_id=j.id OR s.attempt_id=a.id))
 AND NOT EXISTS (SELECT 1 FROM hayes_original_dispositions d WHERE d.tenant_id=j.tenant_id AND (d.job_id=j.id OR d.attempt_id=a.id))
 AND NOT EXISTS (SELECT 1 FROM hayes_native_releases r WHERE r.tenant_id=j.tenant_id AND (r.job_id=j.id OR r.attempt_id=a.id));
