-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Explicit opt-in profile for a new qualified workspace. Earlier migrations,
-- rows, job identities and provenance are preserved.
ALTER TABLE oex_import_jobs DROP CONSTRAINT oex_import_jobs_bounded_profile_check;
ALTER TABLE oex_import_jobs ADD CONSTRAINT oex_import_jobs_bounded_profile_check CHECK (
 expected_bytes > 0 AND (
  (archive_profile IS NULL AND oex_format IS NULL AND expected_bytes <= 67108864)
  OR (archive_profile IS NOT NULL AND oex_format IS NOT NULL AND archive_profile = 'bounded-file-v1' AND oex_format IN ('1.0.0-draft.9','1.0.0-draft.10','1.0.0-draft.12') AND expected_bytes <= 536870912)
 )
);
CREATE OR REPLACE FUNCTION native_oex_provenance_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM oex_import_jobs j
  WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.import_job_id
   AND j.user_id=NEW.principal_id AND j.payload_sha256=NEW.source_sha256
   AND j.archive_profile=NEW.archive_profile AND j.oex_format IN ('1.0.0-draft.9','1.0.0-draft.10','1.0.0-draft.12')
   AND j.state='complete' AND j.result->>'exhibitionId'=NEW.exhibition_id::text
 ) THEN RAISE EXCEPTION 'Native OEX provenance linkage invalid'; END IF;
 RETURN NULL;
END;
$$;
