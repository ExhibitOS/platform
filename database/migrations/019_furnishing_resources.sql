-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Retain only selected OEX furnishing payloads and their exact CC0 notices.
-- Catalogue identity is independent of remapped exhibition/asset UUID paths.
CREATE TABLE studio_furnishing_resources (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL,
 catalog_id text NOT NULL CHECK(catalog_id ~ '^[a-z]+(-[a-z]+)*$' AND length(catalog_id)<=64),
 catalog_version integer NOT NULL CHECK(catalog_version=1),
 role text NOT NULL CHECK(role IN ('model','notice')),
 resource_path text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8388608 AND (role<>'notice' OR bytes<=32768)),
 object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,exhibition_id,catalog_id,catalog_version,role),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER studio_furnishing_resource_immutable BEFORE UPDATE OR DELETE ON studio_furnishing_resources FOR EACH ROW EXECUTE FUNCTION immutable_revision();
