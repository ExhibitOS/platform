-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Separate opt-in supplement; never apply during ordinary workspace reopen.
CREATE TABLE workspace_furnishing_intakes (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 id uuid NOT NULL, request_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 declaration jsonb NOT NULL,
 phase text NOT NULL CHECK(phase IN ('uploading','validating','cancelling','registered','failed','cancelled')),
 received jsonb, error jsonb, retryable boolean NOT NULL DEFAULT false,
 worker_token uuid, furnishing_id uuid NOT NULL, furnishing_version integer NOT NULL CHECK(furnishing_version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,request_id),
 UNIQUE(workspace_id,furnishing_id,furnishing_version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 CHECK(NOT retryable OR (phase='failed' AND worker_token IS NULL)),
 CHECK(phase NOT IN ('registered','failed','cancelled') OR worker_token IS NULL)
);
CREATE TABLE workspace_furnishing_versions (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 id uuid NOT NULL, version integer NOT NULL CHECK(version>0), descriptor jsonb NOT NULL,
 object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id,version),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id)
);
CREATE TRIGGER workspace_furnishing_version_immutable BEFORE UPDATE OR DELETE ON workspace_furnishing_versions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
