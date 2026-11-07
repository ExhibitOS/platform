-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Separate opt-in supplement. Preserve immutable 033/035; only an explicitly
-- qualified fresh catalog admits normal and roughness alongside color.
DO $$
DECLARE constraint_row record; roles_found integer := 0; path_found integer := 0;
BEGIN
 FOR constraint_row IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='workspace_material_import_stage'::regclass AND contype='c'
 LOOP
  IF constraint_row.definition LIKE '%role = ''color''%' THEN
   roles_found := roles_found + 1;
   EXECUTE format('ALTER TABLE workspace_material_import_stage DROP CONSTRAINT %I',constraint_row.conname);
  ELSIF constraint_row.definition LIKE '%source_path%' AND constraint_row.definition LIKE '%/color-%' THEN
   path_found := path_found + 1;
   EXECUTE format('ALTER TABLE workspace_material_import_stage DROP CONSTRAINT %I',constraint_row.conname);
  END IF;
 END LOOP;
 IF roles_found<>1 OR path_found<>1 THEN RAISE EXCEPTION 'Workspace stage constraints mismatch'; END IF;
END $$;
ALTER TABLE workspace_material_import_stage
 ADD CONSTRAINT workspace_material_import_stage_map_role_check CHECK(role IN ('color','normal','roughness')),
 ADD CONSTRAINT workspace_material_import_stage_map_path_check CHECK(source_path='resources/workspace-materials/' || source_material_id::text || '/' || source_material_version::text || '/' || role || '-' || sha256 || '.png');
CREATE OR REPLACE FUNCTION workspace_material_import_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_material_version<>NEW.material_version OR NOT EXISTS (
  SELECT 1 FROM workspace_material_versions v
  JOIN native_oex_exhibition_provenance p ON p.tenant_id=NEW.tenant_id AND p.import_job_id=NEW.import_job_id
  JOIN oex_import_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.import_job_id
  JOIN exhibition_revisions er ON er.tenant_id=p.tenant_id AND er.exhibition_id=p.exhibition_id AND er.revision=1
  WHERE v.workspace_id=NEW.workspace_id AND v.tenant_id=NEW.tenant_id AND v.user_id=NEW.user_id
   AND v.id=NEW.material_id AND v.version=NEW.material_version
   AND p.workspace_id=NEW.workspace_id AND p.principal_id=NEW.user_id AND p.attempt_id=NEW.attempt_id
   AND p.source_sha256=j.payload_sha256 AND j.user_id=NEW.user_id AND j.state='complete'
   AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'
   AND j.result->>'exhibitionId'=p.exhibition_id::text AND (j.result->>'revision')::integer=1 AND j.result->'draft'=er.snapshot
   AND j.result->'idMap'->>NEW.source_material_id::text=NEW.material_id::text
   AND v.descriptor->>'id'=NEW.material_id::text AND (v.descriptor->>'version')::integer=NEW.material_version
   AND v.descriptor->>'kind' IN ('floor','wall') AND jsonb_typeof(v.descriptor->'maps')='object'
   AND v.descriptor #> '{rights,permissions,display}'='true'::jsonb AND v.descriptor #> '{rights,permissions,export}'='true'::jsonb
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(er.snapshot #> '{candidate,extensions,org.exhibitos.studio/workspace-materials,bindings}') b
     JOIN LATERAL jsonb_array_elements(er.snapshot #> '{candidate,surfaces}') s ON s->>'id'=b->>'surfaceId'
     WHERE b->>'materialId'=NEW.material_id::text AND (b->>'materialVersion')::integer=NEW.material_version AND s->>'type'=v.descriptor->>'kind')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(er.snapshot #> '{candidate,extensions,org.exhibitos.studio/workspace-materials,bindings}') b
     LEFT JOIN LATERAL jsonb_array_elements(er.snapshot #> '{candidate,surfaces}') s ON s->>'id'=b->>'surfaceId'
     WHERE b->>'materialId'=NEW.material_id::text AND (b->>'materialVersion')::integer=NEW.material_version AND (s IS NULL OR s->>'type' IS DISTINCT FROM v.descriptor->>'kind'))
   AND (v.descriptor->'maps') ? 'color'
   AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v.descriptor->'maps') role WHERE role NOT IN ('color','normal','roughness'))
   AND jsonb_typeof(v.object_keys)='object'
   AND (SELECT count(*) FROM jsonb_object_keys(v.object_keys))=(SELECT count(*) FROM jsonb_object_keys(v.descriptor->'maps'))
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_each(v.descriptor->'maps') map
     LEFT JOIN workspace_material_import_stage stage ON stage.tenant_id=NEW.tenant_id AND stage.import_job_id=NEW.import_job_id
       AND stage.attempt_id=NEW.attempt_id AND stage.source_material_id=NEW.source_material_id
       AND stage.source_material_version=NEW.source_material_version AND stage.role=map.key
     WHERE stage.role IS NULL OR stage.user_id<>NEW.user_id OR stage.lease_id<>NEW.lease_id
       OR stage.object_key IS DISTINCT FROM v.object_keys->>map.key
       OR stage.sha256 IS DISTINCT FROM map.value->>'sha256'
       OR stage.bytes IS DISTINCT FROM (map.value->>'bytes')::integer
       OR NOT (j.cleanup_keys @> jsonb_build_array(stage.object_key)) OR stage.stage_txid=pg_current_xact_id()
   )
   AND (SELECT count(*) FROM workspace_material_import_stage stage WHERE stage.tenant_id=NEW.tenant_id AND stage.import_job_id=NEW.import_job_id
     AND stage.attempt_id=NEW.attempt_id AND stage.source_material_id=NEW.source_material_id AND stage.source_material_version=NEW.source_material_version)
     =(SELECT count(*) FROM jsonb_object_keys(v.descriptor->'maps'))
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(er.snapshot #> '{candidate,extensions,org.exhibitos.studio/workspace-materials,materials}') m WHERE m=v.descriptor)
 ) THEN RAISE EXCEPTION 'Workspace material import provenance invalid'; END IF;
 RETURN NULL;
END;
$$;
