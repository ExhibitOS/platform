-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Actual uploaded OEX floor resources are retained independently from artwork,
-- WAV media and cover images. Fixed catalogue semantics are checked before SQL.
CREATE TABLE studio_floor_resources (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL,
 pack_id text NOT NULL CHECK(pack_id IN ('WoodFloor051','Marble006','Tiles074','Carpet004')),
 pack_version integer NOT NULL CHECK(pack_version=1),
 role text NOT NULL CHECK(role IN ('color','roughness','normal','ao','notice')),
 resource_path text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8388608), object_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,exhibition_id,pack_id,pack_version,role),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER studio_floor_resource_immutable BEFORE UPDATE OR DELETE ON studio_floor_resources FOR EACH ROW EXECUTE FUNCTION immutable_revision();
