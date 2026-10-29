-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Each token belongs to one actual worker invocation, including expired leases.
-- A lost worker leaves its token present until an independently verified recovery.
ALTER TABLE import_jobs ADD COLUMN png_drain_version smallint NOT NULL DEFAULT 0 CHECK(png_drain_version IN (0,1));
ALTER TABLE import_jobs ADD COLUMN png_worker_tokens uuid[] NOT NULL DEFAULT '{}';
-- An older worker cannot claim a tracked job without registering its invocation.
ALTER TABLE import_jobs ADD CONSTRAINT png_processing_owner_registered CHECK (
 png_drain_version<>1 OR state<>'processing' OR (lease_id IS NOT NULL AND COALESCE(lease_id=ANY(png_worker_tokens),false))
);
