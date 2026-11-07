-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Publication IDs are public; the workspace source tuple and descriptor remain private.
-- Model bytes remain at their registered workspace object, with no new object copy.
CREATE TABLE publication_workspace_furnishings (
 tenant_id uuid NOT NULL, publication_id uuid NOT NULL, public_id uuid NOT NULL,
 workspace_id uuid NOT NULL, user_id uuid NOT NULL, source_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0), source_descriptor jsonb NOT NULL,
 PRIMARY KEY(publication_id,public_id),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES studio_publications(tenant_id,id),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 FOREIGN KEY(workspace_id,source_id,source_version) REFERENCES workspace_furnishing_versions(workspace_id,id,version)
);
CREATE TRIGGER publication_workspace_furnishing_immutable BEFORE UPDATE OR DELETE ON publication_workspace_furnishings FOR EACH ROW EXECUTE FUNCTION immutable_revision();
