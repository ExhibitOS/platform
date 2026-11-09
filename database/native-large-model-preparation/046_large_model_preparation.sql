-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The enlarged encoded limit belongs only to new source-only v2 GLB jobs.
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_expected_bytes_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_expected_bytes_check CHECK (
 expected_bytes BETWEEN 1 AND 33554432 OR (
  expected_bytes BETWEEN 33554433 AND 67108864
  AND mime='model/gltf-binary'
  AND model_preparation->'request'->>'profileId'='embedded-model-compact-large-20k-512-v2'
 ) IS TRUE
);
ALTER TABLE import_jobs DROP CONSTRAINT import_model_preparation_shape;
ALTER TABLE import_jobs ADD CONSTRAINT import_model_preparation_shape CHECK (
 model_preparation IS NULL OR ((
  mime='model/gltf-binary' AND derived IS NULL AND derived_object_key IS NULL
  AND model_derivation IS NULL AND png_drain_version=1
  AND jsonb_typeof(model_preparation)='object' AND octet_length(model_preparation::text)<=16384
  AND model_preparation->>'kind'='required-model-compact'
  AND jsonb_typeof(model_preparation->'request')='object'
  AND (
   model_preparation->'request'->>'profileId'='embedded-model-compact-20k-512-v1'
   OR (
    model_preparation->'request'->>'profileId'='embedded-model-compact-large-20k-512-v2'
    AND NOT (model_preparation->'request' ? 'sourceFull')
   )
  )
  AND (state<>'approved' OR (asset_id IS NOT NULL AND jsonb_typeof(model_preparation->'result')='object'))
 ) IS TRUE)
);
