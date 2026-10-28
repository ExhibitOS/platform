-- Original JPEG custody is private quarantine; only its independently validated PNG is approved.
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_mime_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_mime_check CHECK(mime IN ('model/gltf-binary','image/png','image/jpeg'));
ALTER TABLE import_jobs ADD COLUMN derived jsonb, ADD COLUMN derived_object_key text, ADD COLUMN original_asset_id uuid;
ALTER TABLE import_jobs ADD CONSTRAINT import_prepared_shape CHECK(
 (mime IN ('model/gltf-binary','image/png') AND derived IS NULL AND derived_object_key IS NULL AND original_asset_id IS NULL)
 OR (mime='image/jpeg' AND derived IS NOT NULL AND jsonb_typeof(derived)='object' AND octet_length(derived::text)<=4096 AND derived_object_key IS NOT NULL)
);
ALTER TABLE import_jobs ADD CONSTRAINT import_original_asset_reference FOREIGN KEY(tenant_id,original_asset_id) REFERENCES assets(tenant_id,id);
ALTER TABLE import_jobs ADD CONSTRAINT import_original_asset_state CHECK(original_asset_id IS NULL OR (state='approved' AND asset_id IS NOT NULL AND original_asset_id<>asset_id));
