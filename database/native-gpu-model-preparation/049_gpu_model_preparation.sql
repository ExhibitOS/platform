-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Optional ordinary GPU derivative family. Existing compact jobs are unchanged.
ALTER TABLE import_jobs ADD COLUMN gpu_preparation jsonb;
ALTER TABLE import_jobs ADD CONSTRAINT import_gpu_preparation_shape CHECK (
 gpu_preparation IS NULL OR ((
  state<>'uploading' AND mime='model/gltf-binary' AND derived IS NULL AND derived_object_key IS NULL
  AND model_derivation IS NULL AND model_preparation IS NULL
  AND original_asset_id IS NULL AND png_drain_version=1
  AND jsonb_typeof(gpu_preparation)='object' AND octet_length(gpu_preparation::text)<=16384
  AND gpu_preparation->>'kind'='gpu-model-preparation'
  AND gpu_preparation->'intent'->>'version'='1'
  AND gpu_preparation->'intent'->>'purpose'='approved-display-gpu-derivative'
  AND gpu_preparation->'intent'->>'recipeSHA256'='886e3815a386a46462e46d35ccb640498ebefcc853cefba61f76560b62cae4bc'
  AND gpu_preparation->'intent'->'request'->>'profile'='embedded-model-basecolor-uastc-512-mips-v1'
  AND (state<>'approved' OR (asset_id IS NOT NULL AND jsonb_typeof(gpu_preparation->'result')='object'))
 ) IS TRUE)
);
CREATE FUNCTION import_gpu_preparation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.gpu_preparation IS NOT NULL AND (
  NEW.gpu_preparation IS NULL
  OR (NEW.tenant_id,NEW.id,NEW.user_id,NEW.artwork_id,NEW.idempotency_key,NEW.request_hash,NEW.mime,NEW.expected_hash,NEW.expected_bytes,NEW.rights,NEW.object_key,NEW.scale_meters)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.id,OLD.user_id,OLD.artwork_id,OLD.idempotency_key,OLD.request_hash,OLD.mime,OLD.expected_hash,OLD.expected_bytes,OLD.rights,OLD.object_key,OLD.scale_meters)
  OR NEW.gpu_preparation->'intent' IS DISTINCT FROM OLD.gpu_preparation->'intent'
  OR (OLD.gpu_preparation ? 'result' AND NEW.gpu_preparation->'result' IS DISTINCT FROM OLD.gpu_preparation->'result')
 ) THEN RAISE EXCEPTION 'GPU_MODEL_PREPARATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_gpu_preparation_immutable BEFORE UPDATE ON import_jobs FOR EACH ROW EXECUTE FUNCTION import_gpu_preparation_immutable();
