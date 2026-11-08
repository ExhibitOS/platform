-- SPDX-License-Identifier: AGPL-3.0-or-later
-- A required compact display is separate from optional 022 texture derivation.
ALTER TABLE import_jobs ADD COLUMN model_preparation jsonb;
ALTER TABLE import_jobs DROP CONSTRAINT import_prepared_shape;
ALTER TABLE import_jobs ADD CONSTRAINT import_prepared_shape CHECK (
 (mime IN ('model/gltf-binary','image/png') AND derived IS NULL AND derived_object_key IS NULL
  AND (original_asset_id IS NULL OR (mime='model/gltf-binary' AND model_preparation IS NOT NULL)))
 OR (mime='image/jpeg' AND derived IS NOT NULL AND jsonb_typeof(derived)='object'
  AND octet_length(derived::text)<=4096 AND derived_object_key IS NOT NULL)
);
ALTER TABLE import_jobs ADD CONSTRAINT import_model_preparation_shape CHECK (
 model_preparation IS NULL OR ((
  mime='model/gltf-binary' AND derived IS NULL AND derived_object_key IS NULL
  AND model_derivation IS NULL AND png_drain_version=1
  AND jsonb_typeof(model_preparation)='object' AND octet_length(model_preparation::text)<=16384
  AND model_preparation->>'kind'='required-model-compact'
  AND jsonb_typeof(model_preparation->'request')='object'
  AND model_preparation->'request'->>'profileId'='embedded-model-compact-20k-512-v1'
  AND (state<>'approved' OR (asset_id IS NOT NULL AND jsonb_typeof(model_preparation->'result')='object'))
 ) IS TRUE)
);
-- A result binds the immutable original/request. Retry only changes lifecycle;
-- a committed display result cannot be transplanted or rewritten.
CREATE FUNCTION import_model_preparation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.model_preparation IS NOT NULL AND (
  NEW.model_preparation IS NULL
  OR (NEW.tenant_id,NEW.id,NEW.user_id,NEW.artwork_id,NEW.idempotency_key,NEW.request_hash,NEW.mime,NEW.expected_hash,NEW.expected_bytes,NEW.rights,NEW.object_key,NEW.scale_meters)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.id,OLD.user_id,OLD.artwork_id,OLD.idempotency_key,OLD.request_hash,OLD.mime,OLD.expected_hash,OLD.expected_bytes,OLD.rights,OLD.object_key,OLD.scale_meters)
  OR NEW.model_preparation->'request' IS DISTINCT FROM OLD.model_preparation->'request'
  OR (OLD.model_preparation ? 'result' AND NEW.model_preparation->'result' IS DISTINCT FROM OLD.model_preparation->'result')
 ) THEN RAISE EXCEPTION 'MODEL_PREPARATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_model_preparation_immutable BEFORE UPDATE ON import_jobs FOR EACH ROW EXECUTE FUNCTION import_model_preparation_immutable();
