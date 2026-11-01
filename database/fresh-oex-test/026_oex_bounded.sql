-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Selected fresh native test only; this directory is not the ordinary
-- migration sequence and must never be applied to an existing workspace.
ALTER TABLE oex_import_jobs ADD COLUMN archive_profile text;
ALTER TABLE oex_import_jobs ADD COLUMN oex_format text;
ALTER TABLE oex_import_jobs DROP CONSTRAINT oex_import_jobs_expected_bytes_check;
ALTER TABLE oex_import_jobs ADD CONSTRAINT oex_import_jobs_bounded_profile_check CHECK (
 expected_bytes > 0 AND (
  (archive_profile IS NULL AND oex_format IS NULL AND expected_bytes <= 67108864)
  OR (archive_profile IS NOT NULL AND oex_format IS NOT NULL AND archive_profile = 'bounded-file-v1' AND oex_format = '1.0.0-draft.9' AND expected_bytes <= 536870912)
 )
);
CREATE OR REPLACE FUNCTION oex_job_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OEX receipts retained'; END IF;
 IF ROW(NEW.tenant_id,NEW.id,NEW.user_id,NEW.request_id,NEW.payload_sha256,NEW.expected_bytes,NEW.staging_keys,NEW.created_at,NEW.archive_profile,NEW.oex_format)
 IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.user_id,OLD.request_id,OLD.payload_sha256,OLD.expected_bytes,OLD.staging_keys,OLD.created_at,OLD.archive_profile,OLD.oex_format)
 THEN RAISE EXCEPTION 'OEX job identity immutable'; END IF;
 IF OLD.state='complete' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.result IS DISTINCT FROM OLD.result) THEN RAISE EXCEPTION 'OEX completed receipt immutable'; END IF;
 RETURN NEW;
END;
$$;
