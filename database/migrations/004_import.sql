ALTER TABLE assets DROP CONSTRAINT assets_state_check;
ALTER TABLE assets ADD CONSTRAINT assets_state_check CHECK(state IN ('quarantine','stored','approved','rejected'));
CREATE TABLE import_jobs (
 tenant_id uuid, id uuid, user_id uuid NOT NULL REFERENCES users(id), artwork_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128), request_hash text NOT NULL,
 mime text NOT NULL CHECK(mime IN ('model/gltf-binary','image/png')), expected_hash text NOT NULL CHECK(expected_hash ~ '^[0-9a-f]{64}$'),
 scale_meters double precision NOT NULL CHECK(scale_meters>0 AND scale_meters<'Infinity'::float8),
 expected_bytes integer NOT NULL CHECK(expected_bytes BETWEEN 1 AND 33554432), rights jsonb NOT NULL,
 object_key text NOT NULL, approved_key text NOT NULL, asset_id uuid,
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','queued','processing','approved','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 error_code text, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,artwork_id) REFERENCES artworks(tenant_id,id), FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id)
);
CREATE INDEX import_due ON import_jobs(available_at) WHERE state IN ('queued','processing');
