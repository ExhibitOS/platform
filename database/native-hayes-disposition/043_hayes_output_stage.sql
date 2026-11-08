-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Inert selected catalog: a reservation is not a worker-drain proof,
-- disposition, approval, or authority to release native custody.
CREATE TABLE hayes_output_stages (
 tenant_id uuid NOT NULL, id uuid NOT NULL, attempt_id uuid NOT NULL, job_id uuid NOT NULL,
 output_sha256 text NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes integer NOT NULL CHECK(output_bytes BETWEEN 1 AND 16777216),
 object_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,attempt_id), UNIQUE(tenant_id,object_key),
 FOREIGN KEY(tenant_id,attempt_id,job_id) REFERENCES hayes_original_attempts(tenant_id,id,job_id),
 CHECK(object_key=tenant_id::text || '/hayes-output/' || attempt_id::text || '/' || output_sha256)
);
CREATE FUNCTION protect_hayes_output_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Hayes output stage requires verified disposition'; END IF;
 -- Lock first: evaluating the deadline before waiting on a row lock can
 -- admit an already-expired owner if the blocker did not update that row.
 PERFORM 1 FROM import_jobs j WHERE (j.tenant_id,j.id)=(NEW.tenant_id,NEW.job_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Hayes output stage owner invalid'; END IF;
 PERFORM 1 FROM hayes_original_attempts a JOIN import_jobs j
   ON (j.tenant_id,j.id,j.hayes_attempt_id)=(a.tenant_id,a.job_id,a.id)
  WHERE (a.tenant_id,a.id,a.job_id)=(NEW.tenant_id,NEW.attempt_id,NEW.job_id)
   AND j.state='processing' AND j.lease_id=a.lease_id AND j.lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Hayes output stage owner invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hayes_output_stage_guard BEFORE INSERT OR UPDATE OR DELETE ON hayes_output_stages FOR EACH ROW EXECUTE FUNCTION protect_hayes_output_stage();
