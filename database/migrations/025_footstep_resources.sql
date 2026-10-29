-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Preserve exact imported, registered audio resources across reopen and backup.
CREATE TABLE studio_footstep_resources (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL,
 family text NOT NULL CHECK(family IN ('carpet','concrete','marble','tile','wood','shared')),
 pack_version integer NOT NULL CHECK(pack_version=1),
 role text NOT NULL CHECK(role IN ('sample','notice')),
 resource_path text NOT NULL CHECK(length(resource_path)<=230),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=131072),
 object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,exhibition_id,resource_path),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER studio_footstep_resource_immutable BEFORE UPDATE OR DELETE ON studio_footstep_resources FOR EACH ROW EXECUTE FUNCTION immutable_revision();
