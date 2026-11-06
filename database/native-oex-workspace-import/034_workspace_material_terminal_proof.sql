-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Candidate only: no existing native catalog, route or capability selects it.
-- The owner must have drained the actual worker/decoders and retain its fence;
-- a database row does not itself establish drain, authorization or COMMIT.
CREATE TABLE workspace_oex_import_terminal_proof (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, principal_id uuid NOT NULL,
 import_job_id uuid NOT NULL, attempt_id uuid NOT NULL, import_request_id uuid NOT NULL,
 source_archive_sha256 text NOT NULL CHECK(source_archive_sha256 ~ '^[a-f0-9]{64}$'),
 exhibition_id uuid NOT NULL, immutable_revision_id uuid NOT NULL,
 studio_etag text NOT NULL CHECK(studio_etag ~ '^"studio-r1-[a-f0-9]{64}"$'),
 result_sha256 text NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
 result_bytes bytea NOT NULL CHECK(octet_length(result_bytes) BETWEEN 1 AND 4194304),
 proof_bytes bytea NOT NULL CHECK(octet_length(proof_bytes) BETWEEN 1 AND 8192),
 PRIMARY KEY(tenant_id,import_job_id),
 FOREIGN KEY(workspace_id,tenant_id,principal_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 FOREIGN KEY(tenant_id,import_job_id) REFERENCES native_oex_exhibition_provenance(tenant_id,import_job_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(encode(sha256(result_bytes),'hex')=result_sha256),
 -- All interpolated strings have constrained ASCII characters and no spaces.
 -- Require the producer's exact ordered JSON encoding, not JSONB equivalence.
 CHECK(proof_bytes=convert_to('{"version":1,"kind":"workspace-oex-import-terminal","workspaceId":"' || workspace_id::text ||
  '","tenantId":"' || tenant_id::text || '","principalId":"' || principal_id::text || '","jobId":"' || import_job_id::text ||
  '","attemptId":"' || attempt_id::text || '","importRequestId":"' || import_request_id::text ||
  '","sourceArchiveSha256":"' || source_archive_sha256 || '","archiveFormat":"1.0.0-draft.12","exhibitionId":"' || exhibition_id::text ||
  '","immutableRevisionId":"' || immutable_revision_id::text || '","studioETag":' || to_json(studio_etag)::text ||
  ',"resultBytes":' || octet_length(result_bytes)::text || ',"resultSha256":"' || result_sha256 || '"}','UTF8'))
);
CREATE TRIGGER workspace_oex_terminal_proof_immutable BEFORE UPDATE OR DELETE ON workspace_oex_import_terminal_proof
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();

-- Result bytes are bound here by SHA and JSONB semantics. The trusted writer
-- enforces canonical result bytes; any replay must revalidate those exact bytes
-- before exposing them. The revision and native provenance must describe the
-- same completed bounded draft.12 import.
CREATE FUNCTION workspace_oex_terminal_proof_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM native_oex_exhibition_provenance p
  JOIN oex_import_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.import_job_id
  JOIN exhibition_revisions er ON er.tenant_id=p.tenant_id AND er.exhibition_id=p.exhibition_id AND er.revision=1
  WHERE p.tenant_id=NEW.tenant_id AND p.import_job_id=NEW.import_job_id
   AND p.workspace_id=NEW.workspace_id AND p.principal_id=NEW.principal_id
   AND p.attempt_id=NEW.attempt_id AND p.exhibition_id=NEW.exhibition_id AND p.source_sha256=NEW.source_archive_sha256
   AND j.user_id=NEW.principal_id AND j.request_id=NEW.import_request_id AND j.payload_sha256=NEW.source_archive_sha256
   AND j.state='complete' AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'
   AND j.result=convert_from(NEW.result_bytes,'UTF8')::jsonb
   AND j.result->>'exhibitionId'=NEW.exhibition_id::text AND j.result->>'revision'='1'
   AND j.result->>'etag'=NEW.studio_etag AND j.result->'draft'=er.snapshot
   AND er.snapshot #>> '{candidate,id}'=NEW.exhibition_id::text
   AND er.snapshot #>> '{candidate,revisionId}'=NEW.immutable_revision_id::text
 ) THEN RAISE EXCEPTION 'Workspace terminal proof invalid'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_oex_terminal_proof_complete_check AFTER INSERT ON workspace_oex_import_terminal_proof
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_oex_terminal_proof_complete();

-- Activation must not silently adopt an earlier unproved terminal result.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM oex_import_jobs WHERE state='complete' AND oex_format='1.0.0-draft.12') THEN
  RAISE EXCEPTION 'Unproved workspace terminal result';
 END IF;
END $$;
-- A newly completed draft.12 job cannot commit before its immutable proof.
-- Legacy 9/10 rows and transitions remain untouched.
CREATE FUNCTION workspace_oex_terminal_proof_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_oex_import_terminal_proof p WHERE p.tenant_id=NEW.tenant_id AND p.import_job_id=NEW.id) THEN
  RAISE EXCEPTION 'Workspace terminal proof required';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_oex_terminal_proof_required_check AFTER INSERT OR UPDATE ON oex_import_jobs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.state='complete' AND NEW.oex_format='1.0.0-draft.12')
 EXECUTE FUNCTION workspace_oex_terminal_proof_required();
