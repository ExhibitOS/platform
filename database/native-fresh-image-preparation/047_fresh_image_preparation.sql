-- SPDX-License-Identifier: AGPL-3.0-or-later
ALTER TABLE import_jobs DROP CONSTRAINT import_prepared_shape;
ALTER TABLE import_jobs ADD CONSTRAINT import_prepared_shape CHECK (
 (mime IN ('model/gltf-binary','image/png') AND derived IS NULL AND derived_object_key IS NULL
  AND (original_asset_id IS NULL OR (mime='model/gltf-binary' AND model_preparation IS NOT NULL)))
 OR (mime='image/jpeg' AND derived IS NOT NULL AND jsonb_typeof(derived)='object'
  AND octet_length(derived::text)<=4096 AND derived_object_key IS NOT NULL)
 OR ((mime='image/png' AND derived->>'kind'='fresh-product-image') IS TRUE)
);
ALTER TABLE import_jobs ADD CONSTRAINT import_fresh_image_preparation_shape CHECK (
 (derived->>'kind') IS DISTINCT FROM 'fresh-product-image' OR ((
  mime IN ('image/jpeg','image/png')
  AND model_preparation IS NULL AND model_derivation IS NULL AND png_drain_version=1
  AND jsonb_typeof(derived)='object' AND octet_length(derived::text)<=4096
  AND derived_object_key IS NOT NULL
  AND jsonb_typeof(derived->'request')='object'
  AND derived->'request'->>'profile'='ordinary-image-preparation-v1'
  AND (state='approved')=(asset_id IS NOT NULL AND original_asset_id IS NOT NULL AND jsonb_typeof(derived->'result')='object')
  AND (state='approved' OR (asset_id IS NULL AND original_asset_id IS NULL AND NOT (derived ? 'result')))
 ) IS TRUE)
);
