-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Inert selected catalog: a reservation is not a worker-drain proof,
-- disposition, approval, or authority to release native custody.
CREATE TABLE hayes_output_stages (
 tenant_id uuid NOT NULL, id uuid NOT NULL, attempt_id uuid NOT NULL, job_id uuid NOT NULL,
 output_sha256 text NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes integer NOT NULL CHECK(output_bytes BETWEEN 1 AND 16777216),
 object_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,attempt_id), UNIQUE(tenant_id,object_key),
 FOREIGN KEY(tenant_id,attempt_id,job_id) REFERENCES hayes_original_attempts(tenant_id,id,job_id),
 CHECK(object_key=tenant_id::text || '/hayes-output/' || attempt_id::text || '/' || output_sha256)
);
CREATE FUNCTION protect_hayes_output_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Hayes output stage requires verified disposition'; END IF;
 -- Lock first: evaluating the deadline before waiting on a row lock can
 -- admit an already-expired owner if the blocker did not update that row.
 PERFORM 1 FROM import_jobs j WHERE (j.tenant_id,j.id)=(NEW.tenant_id,NEW.job_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Hayes output stage owner invalid'; END IF;
 PERFORM 1 FROM hayes_original_attempts a JOIN import_jobs j
   ON (j.tenant_id,j.id,j.hayes_attempt_id)=(a.tenant_id,a.job_id,a.id)
  WHERE (a.tenant_id,a.id,a.job_id)=(NEW.tenant_id,NEW.attempt_id,NEW.job_id)
   AND j.state='processing' AND j.lease_id=a.lease_id AND j.lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Hayes output stage owner invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_output_stage_guard BEFORE INSERT OR UPDATE OR DELETE ON hayes_output_stages FOR EACH ROW EXECUTE FUNCTION protect_hayes_output_stage();

-- A receipt is durable evidence of one atomic asset registration, not a
-- substitute for native containment or the Manager's post-commit readback.
ALTER TABLE hayes_output_stages ADD CONSTRAINT hayes_stage_binding_unique UNIQUE(tenant_id,id,attempt_id,job_id);
CREATE TABLE hayes_original_dispositions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, attempt_id uuid NOT NULL, job_id uuid NOT NULL, stage_id uuid NOT NULL,
 native_owner_id uuid NOT NULL,
 database_system_identifier text NOT NULL CHECK(database_system_identifier ~ '^[1-9][0-9]{0,19}$' AND database_system_identifier::numeric<=18446744073709551615),
 database_oid text NOT NULL CHECK(database_oid ~ '^[1-9][0-9]{0,9}$' AND database_oid::numeric<=4294967295),
 runtime_manifest_sha256 text NOT NULL CHECK(runtime_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 worker_manifest_sha256 text NOT NULL CHECK(worker_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 native_evidence_sha256 text NOT NULL CHECK(native_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 attestation jsonb NOT NULL CHECK(jsonb_typeof(attestation)='object' AND octet_length(attestation::text)<=4096),
 receipt_canonical bytea NOT NULL CHECK(octet_length(receipt_canonical) BETWEEN 1 AND 6144),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$' AND encode(sha256(receipt_canonical),'hex')=receipt_sha256),
 original_asset_id uuid NOT NULL, display_asset_id uuid NOT NULL, derivative_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,attempt_id), UNIQUE(tenant_id,id,attempt_id,job_id),
 FOREIGN KEY(tenant_id,stage_id,attempt_id,job_id) REFERENCES hayes_output_stages(tenant_id,id,attempt_id,job_id),
 FOREIGN KEY(tenant_id,original_asset_id) REFERENCES assets(tenant_id,id),
 FOREIGN KEY(tenant_id,display_asset_id) REFERENCES assets(tenant_id,id),
 FOREIGN KEY(tenant_id,derivative_id) REFERENCES asset_derivatives(tenant_id,id),
 CHECK(original_asset_id<>display_asset_id)
);
ALTER TABLE import_jobs ADD COLUMN hayes_disposition_id uuid;
ALTER TABLE import_jobs ADD CONSTRAINT hayes_disposition_binding_fk FOREIGN KEY(tenant_id,hayes_disposition_id,hayes_attempt_id,id)
 REFERENCES hayes_original_dispositions(tenant_id,id,attempt_id,job_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION protect_hayes_original_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Hayes disposition immutable'; END IF;
 -- Serialize cancellation and terminal recording, then check the fresh lease.
 PERFORM 1 FROM import_jobs WHERE (tenant_id,id)=(NEW.tenant_id,NEW.job_id) FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM import_jobs j JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(j.tenant_id,j.hayes_attempt_id,j.id)
  WHERE (j.tenant_id,j.id,j.hayes_attempt_id)=(NEW.tenant_id,NEW.job_id,NEW.attempt_id)
  AND j.state='processing' AND j.lease_id=a.lease_id AND j.lease_until>clock_timestamp()) THEN
  RAISE EXCEPTION 'Hayes disposition owner invalid';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_disposition_immutable BEFORE INSERT OR UPDATE OR DELETE ON hayes_original_dispositions FOR EACH ROW EXECUTE FUNCTION protect_hayes_original_disposition();
-- Cross-check the receipt only at commit, after the atomic job transition.
CREATE FUNCTION check_hayes_disposition_committed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked_rights uuid;
BEGIN
 -- Keep the selected mutable rows stable through commit. The fixed writer
 -- must acquire the same locks before its final revalidation and mutation.
 PERFORM w.id FROM artworks w JOIN import_jobs j ON (w.tenant_id,w.id)=(j.tenant_id,j.artwork_id) WHERE (j.tenant_id,j.id)=(NEW.tenant_id,NEW.job_id) FOR SHARE OF w;
 SELECT r.id INTO locked_rights FROM rights r JOIN assets o ON (o.tenant_id,o.rights_id)=(r.tenant_id,r.id) WHERE (o.tenant_id,o.id)=(NEW.tenant_id,NEW.original_asset_id) FOR SHARE OF r;
 PERFORM id FROM assets WHERE tenant_id=NEW.tenant_id AND id IN (NEW.original_asset_id,NEW.display_asset_id) ORDER BY id FOR SHARE;
 PERFORM id FROM asset_derivatives WHERE (tenant_id,id)=(NEW.tenant_id,NEW.derivative_id) FOR SHARE;
 IF NOT EXISTS (
  SELECT 1 FROM import_jobs j
  JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(j.tenant_id,j.hayes_attempt_id,j.id)
  JOIN hayes_output_stages s ON (s.tenant_id,s.id,s.attempt_id,s.job_id)=(NEW.tenant_id,NEW.stage_id,NEW.attempt_id,NEW.job_id)
  JOIN assets o ON (o.tenant_id,o.id)=(NEW.tenant_id,NEW.original_asset_id)
  JOIN assets d ON (d.tenant_id,d.id)=(NEW.tenant_id,NEW.display_asset_id)
  JOIN asset_derivatives x ON (x.tenant_id,x.id,x.asset_id)=(NEW.tenant_id,NEW.derivative_id,o.id)
  JOIN rights r ON (r.tenant_id,r.id)=(o.tenant_id,o.rights_id)
  JOIN artworks w ON (w.tenant_id,w.id)=(j.tenant_id,j.artwork_id)
  WHERE (j.tenant_id,j.id,j.hayes_attempt_id,j.hayes_disposition_id)=(NEW.tenant_id,NEW.job_id,NEW.attempt_id,NEW.id)
   AND j.state='approved' AND j.lease_id=a.lease_id AND j.lease_until>clock_timestamp()
   AND j.asset_id=d.id AND j.original_asset_id IS NULL AND j.approved_key=s.object_key
   AND w.revision=a.artwork_revision AND w.deleted_at IS NULL AND r.id=locked_rights AND r.deleted_at IS NULL AND r.metadata=j.rights AND w.metadata->'rights'=j.rights
   AND w.metadata->'displayReference'->>'status'='provisional-uncalibrated' AND w.metadata->'displayReference'->>'assetSha256'=s.output_sha256
   AND w.metadata->'provenance'->>'sourceUnits'='unknown' AND w.metadata->'provenance'->'scaleApplied'='false'::jsonb
   AND o.artwork_id=j.artwork_id AND d.artwork_id=j.artwork_id AND o.rights_id=d.rights_id
   AND o.state='quarantine' AND o.deleted_at IS NULL AND o.object_key=j.object_key AND o.target_key=j.object_key
   AND o.sha256=a.source_sha256 AND o.bytes=a.source_bytes AND o.mime='model/gltf-binary' AND o.scale_meters=1
   AND d.state='approved' AND d.deleted_at IS NULL AND d.object_key=s.object_key AND d.target_key=s.object_key
   AND d.sha256=s.output_sha256 AND d.bytes=s.output_bytes AND d.mime='model/gltf-binary' AND d.scale_meters=1
   AND x.deleted_at IS NULL AND x.metadata->>'kind'='hayes-original-display-v1'
   AND x.metadata->>'originalAssetId'=o.id::text AND x.metadata->>'displayAssetId'=d.id::text
   AND x.metadata->>'attemptId'=a.id::text AND x.metadata->>'outputSha256'=s.output_sha256
 ) THEN RAISE EXCEPTION 'Hayes disposition incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER hayes_disposition_commit_check AFTER INSERT ON hayes_original_dispositions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_hayes_disposition_committed();

-- Preserve the 042 claim/cancel guards and admit only the receipt-bound
-- processing -> approved transition. The owner lease is retained for native
-- disposition; a database commit alone is not release evidence.
CREATE OR REPLACE FUNCTION protect_hayes_original_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.hayes_attempt_id IS NOT NULL OR NEW.hayes_disposition_id IS NOT NULL THEN RAISE EXCEPTION 'Hayes binding must be claimed after upload'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.hayes_attempt_id IS NULL AND NEW.hayes_attempt_id IS NOT NULL THEN
  IF (to_jsonb(NEW)-'state'-'progress'-'attempts'-'lease_id'-'lease_until'-'hayes_attempt_id'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'progress'-'attempts'-'lease_id'-'lease_until'-'hayes_attempt_id'-'updated_at') OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_until IS NULL OR NEW.lease_until<=clock_timestamp() OR OLD.state<>'queued' OR NEW.state<>'processing' OR NEW.mime<>'model/gltf-binary' OR NEW.derived IS NOT NULL OR NEW.model_derivation IS NOT NULL OR NEW.expected_hash<>'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6' OR NEW.expected_bytes<>8383096 OR NOT EXISTS (SELECT 1 FROM hayes_original_attempts a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.hayes_attempt_id AND a.job_id=NEW.id AND a.principal_id=NEW.user_id AND a.artwork_id=NEW.artwork_id AND a.lease_id=NEW.lease_id) THEN RAISE EXCEPTION 'Hayes binding invalid'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.hayes_attempt_id IS NULL AND NEW.hayes_attempt_id IS NULL AND NEW.hayes_disposition_id IS DISTINCT FROM OLD.hayes_disposition_id THEN RAISE EXCEPTION 'Hayes disposition requires owner'; END IF;
 IF OLD.hayes_attempt_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Hayes owner unresolved'; END IF;
  IF OLD.state='processing' AND NEW.state='approved' AND OLD.hayes_disposition_id IS NULL THEN
   IF (to_jsonb(NEW)-'state'-'progress'-'asset_id'-'approved_key'-'hayes_disposition_id'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'progress'-'asset_id'-'approved_key'-'hayes_disposition_id'-'updated_at') OR NEW.progress<>100 OR NEW.lease_until<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM hayes_original_dispositions d JOIN hayes_output_stages s ON (s.tenant_id,s.id,s.attempt_id,s.job_id)=(d.tenant_id,d.stage_id,d.attempt_id,d.job_id) WHERE (d.tenant_id,d.id,d.attempt_id,d.job_id)=(NEW.tenant_id,NEW.hayes_disposition_id,NEW.hayes_attempt_id,NEW.id) AND d.display_asset_id=NEW.asset_id AND s.object_key=NEW.approved_key) THEN RAISE EXCEPTION 'Hayes disposition invalid'; END IF;
  ELSIF (to_jsonb(NEW)-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'updated_at') OR NOT (NEW.state=OLD.state OR (OLD.state='processing' AND NEW.state='cancelled')) THEN
   RAISE EXCEPTION 'Hayes owner unresolved';
  END IF;
 END IF;
 RETURN NEW;
END $$;
