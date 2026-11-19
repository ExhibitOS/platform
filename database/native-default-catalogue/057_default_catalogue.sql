-- SPDX-License-Identifier: AGPL-3.0-or-later
-- This supplement is provisioned with a catalogue-capable local runtime.
CREATE TABLE workspace_default_catalogue_releases (
 workspace_id uuid NOT NULL REFERENCES local_workspaces(id),
 manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 catalogue jsonb NOT NULL,
 PRIMARY KEY (workspace_id,manifest_sha256)
);
CREATE TRIGGER workspace_default_catalogue_release_immutable
 BEFORE UPDATE OR DELETE ON workspace_default_catalogue_releases
 FOR EACH ROW EXECUTE FUNCTION immutable_revision();

CREATE TABLE workspace_default_catalogue_active (
 workspace_id uuid PRIMARY KEY REFERENCES local_workspaces(id),
 active_sha256 text NOT NULL,
 previous_sha256 text NOT NULL,
 CHECK (active_sha256 <> previous_sha256),
 FOREIGN KEY (workspace_id,active_sha256) REFERENCES workspace_default_catalogue_releases(workspace_id,manifest_sha256),
 FOREIGN KEY (workspace_id,previous_sha256) REFERENCES workspace_default_catalogue_releases(workspace_id,manifest_sha256)
);
