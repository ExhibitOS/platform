-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Candidate for an explicitly qualified draft.12 selected import. It does not
-- itself admit that format or alter the legacy 9/10 owner protocol.
-- The owned importer writes one typed entry from its validated packed manifest
-- in the same transaction that commits its job-attempt cleanup inventory.
CREATE TABLE workspace_material_import_stage (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, import_job_id uuid NOT NULL, attempt_id uuid NOT NULL, lease_id uuid NOT NULL,
 source_material_id uuid NOT NULL, source_material_version integer NOT NULL CHECK(source_material_version>0),
 role text NOT NULL CHECK(role='color'), source_path text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8388608),
 object_key text NOT NULL, stage_txid xid8 NOT NULL,
 PRIMARY KEY(tenant_id,import_job_id,attempt_id,source_material_id,source_material_version,role),
 UNIQUE(tenant_id,import_job_id,attempt_id,object_key),
 FOREIGN KEY(tenant_id,import_job_id) REFERENCES oex_import_jobs(tenant_id,id),
 CHECK(source_path='resources/workspace-materials/' || source_material_id::text || '/' || source_material_version::text || '/color-' || sha256 || '.png'),
 CHECK(object_key ~ ('^' || tenant_id::text || '/oex-import/' || import_job_id::text || '/' || attempt_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
);
CREATE FUNCTION workspace_material_import_stage_owned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.stage_txid := pg_current_xact_id();
 IF NOT EXISTS(SELECT 1 FROM oex_import_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.import_job_id
  AND j.user_id=NEW.user_id AND j.state='processing' AND j.lease_id=NEW.lease_id AND j.lease_until>clock_timestamp()
  AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'
  AND j.cleanup_keys @> jsonb_build_array(NEW.object_key)) THEN RAISE EXCEPTION 'Workspace material stage not owned'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_material_import_stage_owned_check BEFORE INSERT ON workspace_material_import_stage
 FOR EACH ROW EXECUTE FUNCTION workspace_material_import_stage_owned();
CREATE TRIGGER workspace_material_import_stage_immutable BEFORE UPDATE OR DELETE ON workspace_material_import_stage
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();

CREATE TABLE workspace_material_import_provenance (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 material_id uuid NOT NULL, material_version integer NOT NULL CHECK(material_version>0),
 source_material_id uuid NOT NULL, source_material_version integer NOT NULL CHECK(source_material_version>0),
 import_job_id uuid NOT NULL, attempt_id uuid NOT NULL, lease_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,material_id,material_version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 FOREIGN KEY(workspace_id,material_id,material_version) REFERENCES workspace_material_versions(workspace_id,id,version),
 FOREIGN KEY(tenant_id,import_job_id) REFERENCES native_oex_exhibition_provenance(tenant_id,import_job_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER workspace_material_import_provenance_immutable BEFORE UPDATE OR DELETE ON workspace_material_import_provenance
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE FUNCTION workspace_material_import_attachment_owned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM oex_import_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.import_job_id
  AND j.user_id=NEW.user_id AND j.state='processing' AND j.lease_id=NEW.lease_id AND j.lease_until>clock_timestamp()
  AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12') THEN RAISE EXCEPTION 'Workspace material attachment not owned'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_material_import_attachment_owned_check BEFORE INSERT ON workspace_material_import_provenance
 FOR EACH ROW EXECUTE FUNCTION workspace_material_import_attachment_owned();

-- Attachment writes versions and provenance before it marks the owned job
-- complete. Check their common owner, typed mapping and precommitted key at
-- transaction commit, while the job's cleanup inventory still contains it.
CREATE FUNCTION workspace_material_import_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_material_version<>NEW.material_version OR NOT EXISTS (
  SELECT 1 FROM workspace_material_versions v
  JOIN native_oex_exhibition_provenance p ON p.tenant_id=NEW.tenant_id AND p.import_job_id=NEW.import_job_id
  JOIN oex_import_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.import_job_id
  JOIN exhibition_revisions er ON er.tenant_id=p.tenant_id AND er.exhibition_id=p.exhibition_id AND er.revision=1
  JOIN workspace_material_import_stage stage ON stage.tenant_id=NEW.tenant_id AND stage.import_job_id=NEW.import_job_id
   AND stage.attempt_id=NEW.attempt_id AND stage.source_material_id=NEW.source_material_id AND stage.source_material_version=NEW.source_material_version AND stage.role='color'
  WHERE v.workspace_id=NEW.workspace_id AND v.tenant_id=NEW.tenant_id AND v.user_id=NEW.user_id
   AND v.id=NEW.material_id AND v.version=NEW.material_version
   AND p.workspace_id=NEW.workspace_id AND p.principal_id=NEW.user_id AND p.attempt_id=NEW.attempt_id
   AND p.source_sha256=j.payload_sha256 AND j.user_id=NEW.user_id AND j.state='complete'
   AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'
   AND j.result->>'exhibitionId'=p.exhibition_id::text AND (j.result->>'revision')::integer=1 AND j.result->'draft'=er.snapshot
   AND j.result->'idMap'->>NEW.source_material_id::text=NEW.material_id::text
   AND v.descriptor->>'id'=NEW.material_id::text AND (v.descriptor->>'version')::integer=NEW.material_version
   AND v.descriptor->>'kind'='floor' AND jsonb_typeof(v.descriptor->'maps')='object'
   AND (SELECT count(*) FROM jsonb_object_keys(v.descriptor->'maps'))=1 AND (v.descriptor->'maps') ? 'color'
   AND jsonb_typeof(v.object_keys)='object' AND (SELECT count(*) FROM jsonb_object_keys(v.object_keys))=1
   AND stage.user_id=NEW.user_id AND stage.lease_id=NEW.lease_id AND stage.object_key=v.object_keys->>'color'
   AND stage.sha256=v.descriptor #>> '{maps,color,sha256}' AND stage.bytes=(v.descriptor #>> '{maps,color,bytes}')::integer
   -- Stage rows must have committed before this attachment transaction.
   AND stage.stage_txid<>pg_current_xact_id()
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(er.snapshot #> '{candidate,extensions,org.exhibitos.studio/workspace-materials,materials}') m WHERE m=v.descriptor)
 ) THEN RAISE EXCEPTION 'Workspace material import provenance invalid'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_material_import_complete_check AFTER INSERT ON workspace_material_import_provenance
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_material_import_complete();
