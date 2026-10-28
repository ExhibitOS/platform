-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Preserve only selected exact maps/notices across OEX import, reopen and backup.
CREATE TABLE studio_surface_material_resources (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL,
 pack_id text NOT NULL CHECK(pack_id IN ('museum-matte-paint','fine-lime-plaster')),
 pack_version integer NOT NULL CHECK(pack_version=1),
 role text NOT NULL CHECK(role IN ('color','roughness','normal','notice')),
 resource_path text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8388608 AND (role<>'notice' OR bytes<=8192)),
 object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,exhibition_id,pack_id,pack_version,role),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER studio_surface_material_resource_immutable BEFORE UPDATE OR DELETE ON studio_surface_material_resources FOR EACH ROW EXECUTE FUNCTION immutable_revision();
