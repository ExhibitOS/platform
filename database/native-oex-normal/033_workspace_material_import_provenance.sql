-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Candidate for an explicitly qualified draft.12 selected import. It does not
-- itself admit that format or alter the legacy 9/10 owner protocol.
CREATE TABLE workspace_material_import_provenance (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 material_id uuid NOT NULL, material_version integer NOT NULL CHECK(material_version>0),
 source_material_id uuid NOT NULL, source_material_version integer NOT NULL CHECK(source_material_version>0),
 import_job_id uuid NOT NULL, attempt_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,material_id,material_version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 FOREIGN KEY(workspace_id,material_id,material_version) REFERENCES workspace_material_versions(workspace_id,id,version),
 FOREIGN KEY(tenant_id,import_job_id) REFERENCES native_oex_exhibition_provenance(tenant_id,import_job_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER workspace_material_import_provenance_immutable BEFORE UPDATE OR DELETE ON workspace_material_import_provenance
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();

-- Attachment writes versions and provenance before it marks the owned job
-- complete. Check their common owner, typed mapping and precommitted key at
-- transaction commit, while the job's cleanup inventory still contains it.
CREATE FUNCTION workspace_material_import_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_material_version<>NEW.material_version OR NOT EXISTS (
  SELECT 1 FROM workspace_material_versions v
  JOIN native_oex_exhibition_provenance p ON p.tenant_id=NEW.tenant_id AND p.import_job_id=NEW.import_job_id
  JOIN oex_import_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.import_job_id
  WHERE v.workspace_id=NEW.workspace_id AND v.tenant_id=NEW.tenant_id AND v.user_id=NEW.user_id
   AND v.id=NEW.material_id AND v.version=NEW.material_version
   AND p.workspace_id=NEW.workspace_id AND p.principal_id=NEW.user_id AND p.attempt_id=NEW.attempt_id
   AND p.source_sha256=j.payload_sha256 AND j.user_id=NEW.user_id AND j.state='complete'
   AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'
   AND j.result->'idMap'->>NEW.source_material_id::text=NEW.material_id::text
   AND v.descriptor->>'id'=NEW.material_id::text AND (v.descriptor->>'version')::integer=NEW.material_version
   AND v.descriptor->>'kind'='floor' AND jsonb_typeof(v.descriptor->'maps')='object'
   AND (SELECT count(*) FROM jsonb_object_keys(v.descriptor->'maps'))=1 AND (v.descriptor->'maps') ? 'color'
   AND jsonb_typeof(v.object_keys)='object' AND (SELECT count(*) FROM jsonb_object_keys(v.object_keys))=1
   AND (v.object_keys->>'color') ~ ('^' || NEW.tenant_id::text || '/oex-import/' || NEW.import_job_id::text || '/' || NEW.attempt_id::text || '/[0-9a-f-]{36}$')
   AND j.cleanup_keys @> jsonb_build_array(v.object_keys->>'color')
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.result #> '{draft,candidate,extensions,org.exhibitos.studio/workspace-materials,materials}') m WHERE m=v.descriptor)
 ) THEN RAISE EXCEPTION 'Workspace material import provenance invalid'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_material_import_complete_check AFTER INSERT ON workspace_material_import_provenance
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_material_import_complete();
