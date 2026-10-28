-- Additive model-only request/result metadata. The prepared JPEG shape and
-- every existing row remain unchanged; all binary output is registered through
-- existing assets and asset_derivatives in the current import transaction.
ALTER TABLE import_jobs ADD COLUMN model_derivation jsonb;
ALTER TABLE import_jobs ADD CONSTRAINT import_model_derivation_shape CHECK(
 model_derivation IS NULL OR ((
  mime='model/gltf-binary' AND derived IS NULL AND derived_object_key IS NULL AND original_asset_id IS NULL
  AND jsonb_typeof(model_derivation)='object' AND octet_length(model_derivation::text)<=8192
  AND model_derivation->>'kind'='model-texture-pair'
  AND jsonb_typeof(model_derivation->'request')='object'
  AND model_derivation->'request'->>'profileId'='exhibitos-near-texture-pair-v1'
 ) IS TRUE)
);
