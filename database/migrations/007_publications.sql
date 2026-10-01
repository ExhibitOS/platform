-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Immutable public metadata and qualified bytes are separate from private authoring.
CREATE TABLE studio_publications (
 tenant_id uuid NOT NULL, id uuid PRIMARY KEY,
 exhibition_id uuid NOT NULL, draft_revision integer NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 snapshot jsonb NOT NULL,
 revision_sha256 text NOT NULL CHECK(revision_sha256 ~ '^[a-f0-9]{64}$'),
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER publication_snapshot_immutable BEFORE UPDATE OR DELETE ON studio_publications FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE publication_states (
 publication_id uuid PRIMARY KEY REFERENCES studio_publications(id),
 status text NOT NULL CHECK(status IN ('published','unpublished')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE publication_assets (
 tenant_id uuid NOT NULL, publication_id uuid NOT NULL, id uuid NOT NULL,
 artwork_id uuid NOT NULL, artwork_revision integer NOT NULL,
 source_asset_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 object_key text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=33554432),
 mime text NOT NULL CHECK(mime IN ('model/gltf-binary','image/png')),
 PRIMARY KEY(publication_id,id),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES studio_publications(tenant_id,id),
 FOREIGN KEY(tenant_id,artwork_id,artwork_revision) REFERENCES artwork_approvals(tenant_id,artwork_id,revision),
 FOREIGN KEY(tenant_id,source_asset_id) REFERENCES assets(tenant_id,id)
);
CREATE TRIGGER publication_asset_immutable BEFORE UPDATE OR DELETE ON publication_assets FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE publication_events (
 id uuid PRIMARY KEY, publication_id uuid NOT NULL REFERENCES studio_publications(id),
 actor_user_id uuid REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('published','unpublished','republished','rights-revoked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER publication_event_immutable BEFORE UPDATE OR DELETE ON publication_events FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE publication_requests (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 publication_id uuid NOT NULL REFERENCES studio_publications(id),
 PRIMARY KEY(tenant_id,user_id,request_id)
);
CREATE TRIGGER publication_request_immutable BEFORE UPDATE OR DELETE ON publication_requests FOR EACH ROW EXECUTE FUNCTION immutable_revision();
