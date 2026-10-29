-- Immutable generated artwork previews and a revision-scoped selection. Old
-- selections remain addressable through their immutable binding after changes.
CREATE TABLE artwork_thumbnail_bindings (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 artwork_id uuid NOT NULL,
 artwork_revision integer NOT NULL CHECK(artwork_revision > 0),
 source_asset_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 thumbnail_asset_id uuid NOT NULL,
 selection_version integer NOT NULL CHECK(selection_version > 0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 bytes integer NOT NULL CHECK(bytes > 0 AND bytes <= 524288),
 object_key text NOT NULL,
 view jsonb NOT NULL,
 recipe jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,created_by,request_id),
 UNIQUE(tenant_id,artwork_id,artwork_revision,id),
 FOREIGN KEY(tenant_id,artwork_id,artwork_revision) REFERENCES artwork_approvals(tenant_id,artwork_id,revision),
 FOREIGN KEY(tenant_id,source_asset_id) REFERENCES assets(tenant_id,id),
 FOREIGN KEY(tenant_id,thumbnail_asset_id) REFERENCES assets(tenant_id,id)
);
CREATE TRIGGER artwork_thumbnail_binding_immutable BEFORE UPDATE OR DELETE ON artwork_thumbnail_bindings FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE artwork_thumbnail_selections (
 tenant_id uuid NOT NULL,
 artwork_id uuid NOT NULL,
 artwork_revision integer NOT NULL CHECK(artwork_revision > 0),
 version integer NOT NULL CHECK(version > 0),
 binding_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,artwork_id,artwork_revision),
 FOREIGN KEY(tenant_id,artwork_id,artwork_revision,binding_id) REFERENCES artwork_thumbnail_bindings(tenant_id,artwork_id,artwork_revision,id)
);
CREATE TABLE publication_thumbnail_bindings (
 tenant_id uuid NOT NULL,
 publication_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 PRIMARY KEY(publication_id,asset_id),
 FOREIGN KEY(publication_id,asset_id) REFERENCES publication_assets(publication_id,id),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES studio_publications(tenant_id,id),
 FOREIGN KEY(tenant_id,binding_id) REFERENCES artwork_thumbnail_bindings(tenant_id,id)
);
CREATE TRIGGER publication_thumbnail_binding_immutable BEFORE UPDATE OR DELETE ON publication_thumbnail_bindings FOR EACH ROW EXECUTE FUNCTION immutable_revision();
