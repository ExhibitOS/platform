-- SPDX-License-Identifier: AGPL-3.0-or-later
-- A selected import may bind only its own newly-created exhibition. The API
-- issues the authority inside the already-fenced attachment transaction.
ALTER TABLE local_workspaces ADD CONSTRAINT local_workspaces_identity_unique
 UNIQUE (id,tenant_id,user_id);
CREATE TABLE native_oex_exhibition_provenance (
 tenant_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 principal_id uuid NOT NULL,
 exhibition_id uuid NOT NULL,
 import_job_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 source_database_system_id text NOT NULL CHECK (source_database_system_id ~ '^[0-9]{1,24}$'),
 source_database_oid text NOT NULL CHECK (source_database_oid ~ '^[0-9]{1,24}$'),
 claim_sha256 text NOT NULL CHECK (claim_sha256 ~ '^[a-f0-9]{64}$'),
 payload_manifest_sha256 text NOT NULL CHECK (payload_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 archive_profile text NOT NULL CHECK (archive_profile = 'bounded-file-v1'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,exhibition_id),
 UNIQUE (tenant_id,import_job_id),
 FOREIGN KEY (workspace_id,tenant_id,principal_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 FOREIGN KEY (tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id),
 FOREIGN KEY (tenant_id,import_job_id) REFERENCES oex_import_jobs(tenant_id,id)
);
CREATE FUNCTION native_oex_provenance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Native OEX provenance retained';
END;
$$;
CREATE TRIGGER native_oex_provenance_retained BEFORE UPDATE OR DELETE ON native_oex_exhibition_provenance
 FOR EACH ROW EXECUTE FUNCTION native_oex_provenance_immutable();
-- The selected attachment creates the exhibition before its job is marked
-- complete; check the whole linkage at transaction commit, not mid-attach.
CREATE FUNCTION native_oex_provenance_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM oex_import_jobs j
  WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.import_job_id
   AND j.user_id=NEW.principal_id AND j.payload_sha256=NEW.source_sha256
   AND j.archive_profile=NEW.archive_profile AND j.oex_format='1.0.0-draft.9'
   AND j.state='complete' AND j.result->>'exhibitionId'=NEW.exhibition_id::text
 ) THEN RAISE EXCEPTION 'Native OEX provenance linkage invalid'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER native_oex_provenance_complete_check AFTER INSERT ON native_oex_exhibition_provenance
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION native_oex_provenance_complete();
