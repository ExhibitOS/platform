-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Optional native catalog. An unresolved owner is durable evidence, not a
-- lease timeout. No cleanup or settlement authority is conferred here.
CREATE TABLE hayes_original_attempts (
 tenant_id uuid NOT NULL, id uuid NOT NULL, workspace_id uuid NOT NULL,
 principal_id uuid NOT NULL, job_id uuid NOT NULL, lease_id uuid NOT NULL,
 runtime_generation uuid NOT NULL, correlation_id uuid NOT NULL,
 artwork_id uuid NOT NULL, artwork_revision integer NOT NULL CHECK(artwork_revision>0),
 source_sha256 text NOT NULL CHECK(source_sha256='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6'),
 source_bytes integer NOT NULL CHECK(source_bytes=8383096),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,job_id), UNIQUE(tenant_id,id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES import_jobs(tenant_id,id),
 FOREIGN KEY(workspace_id,tenant_id,principal_id) REFERENCES local_workspaces(id,tenant_id,user_id)
);
ALTER TABLE import_jobs ADD COLUMN hayes_attempt_id uuid;
ALTER TABLE import_jobs ADD CONSTRAINT hayes_job_binding_unique UNIQUE(tenant_id,id,hayes_attempt_id);
ALTER TABLE hayes_original_attempts ADD CONSTRAINT hayes_attempt_job_backlink FOREIGN KEY(tenant_id,job_id,id) REFERENCES import_jobs(tenant_id,id,hayes_attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE import_jobs ADD CONSTRAINT hayes_attempt_fk FOREIGN KEY(tenant_id,hayes_attempt_id,id) REFERENCES hayes_original_attempts(tenant_id,id,job_id);
CREATE FUNCTION protect_hayes_original_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Hayes attempt requires verified disposition';
END $$;
CREATE TRIGGER hayes_original_attempt_immutable BEFORE UPDATE OR DELETE ON hayes_original_attempts FOR EACH ROW EXECUTE FUNCTION protect_hayes_original_attempt();
CREATE FUNCTION protect_hayes_original_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.hayes_attempt_id IS NULL AND NEW.hayes_attempt_id IS NOT NULL THEN
  IF (to_jsonb(NEW)-'state'-'progress'-'attempts'-'lease_id'-'lease_until'-'hayes_attempt_id'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'progress'-'attempts'-'lease_id'-'lease_until'-'hayes_attempt_id'-'updated_at') OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_until IS NULL OR NEW.lease_until<=clock_timestamp() OR OLD.state<>'queued' OR NEW.state<>'processing' OR NEW.mime<>'model/gltf-binary' OR NEW.derived IS NOT NULL OR NEW.model_derivation IS NOT NULL OR NEW.expected_hash<>'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6' OR NEW.expected_bytes<>8383096 OR NOT EXISTS (SELECT 1 FROM hayes_original_attempts a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.hayes_attempt_id AND a.job_id=NEW.id AND a.principal_id=NEW.user_id AND a.artwork_id=NEW.artwork_id AND a.lease_id=NEW.lease_id) THEN RAISE EXCEPTION 'Hayes binding invalid'; END IF;
 END IF;
 IF OLD.hayes_attempt_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Hayes owner unresolved'; END IF;
  IF (to_jsonb(NEW)-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') OR NOT (NEW.state=OLD.state OR (OLD.state='processing' AND NEW.state='cancelled')) THEN
   RAISE EXCEPTION 'Hayes owner unresolved';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_original_job_guard BEFORE UPDATE OR DELETE ON import_jobs FOR EACH ROW EXECUTE FUNCTION protect_hayes_original_job();
