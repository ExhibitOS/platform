-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Supplemental candidate for a qualified personal workspace only. The owner
-- bootstrap must opt in explicitly; legacy schemas and migrations stay intact.
CREATE UNIQUE INDEX local_workspaces_owner_scope ON local_workspaces(id,tenant_id,user_id);
CREATE TABLE workspace_material_intakes (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 id uuid NOT NULL, request_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 declaration jsonb NOT NULL,
 phase text NOT NULL CHECK(phase IN ('uploading','validating','cancelling','registered','failed','cancelled')),
 received jsonb NOT NULL DEFAULT '{}'::jsonb,
 error jsonb, retryable boolean NOT NULL DEFAULT false,
 worker_token uuid, material_id uuid NOT NULL, material_version integer NOT NULL CHECK(material_version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,request_id),
 UNIQUE(workspace_id,material_id,material_version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 CHECK(NOT retryable OR (phase='failed' AND worker_token IS NULL)),
 CHECK(phase NOT IN ('registered','failed','cancelled') OR worker_token IS NULL)
);
CREATE TABLE workspace_material_versions (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 descriptor jsonb NOT NULL, object_keys jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id,version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id)
);
CREATE TRIGGER workspace_material_version_immutable BEFORE UPDATE OR DELETE ON workspace_material_versions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
