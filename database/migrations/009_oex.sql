-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Retain receipts and immutable identity/hash; cleanup deletes only job-owned disposable objects.
CREATE TABLE oex_import_jobs (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL, payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 expected_bytes integer NOT NULL CHECK(expected_bytes>0 AND expected_bytes<=67108864),
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','queued','processing','failed','cancelled','complete')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_id uuid, lease_until timestamptz, error_code text, result jsonb,
 staging_keys jsonb NOT NULL, cleanup_keys jsonb NOT NULL DEFAULT '[]',
 cleanup_pending boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(id), UNIQUE(tenant_id,user_id,request_id),
 CHECK((state='complete')=(result IS NOT NULL))
);
CREATE INDEX oex_work_queue ON oex_import_jobs(state,created_at);
CREATE FUNCTION oex_job_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OEX receipts retained'; END IF;
 IF ROW(NEW.tenant_id,NEW.id,NEW.user_id,NEW.request_id,NEW.payload_sha256,NEW.expected_bytes,NEW.staging_keys,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.user_id,OLD.request_id,OLD.payload_sha256,OLD.expected_bytes,OLD.staging_keys,OLD.created_at)
 THEN RAISE EXCEPTION 'OEX job identity immutable'; END IF;
 IF OLD.state='complete' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.result IS DISTINCT FROM OLD.result) THEN RAISE EXCEPTION 'OEX completed receipt immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER oex_job_identity_immutable BEFORE UPDATE OR DELETE ON oex_import_jobs FOR EACH ROW EXECUTE FUNCTION oex_job_identity_immutable();
