-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Opt-in current-version supplement; never apply during ordinary reopen.
-- Ready candidates and selection events are immutable, not a mutable pointer.
CREATE TABLE workspace_furnishing_thumbnail_candidates (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 id uuid NOT NULL, request_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 furnishing_id uuid NOT NULL, furnishing_version integer NOT NULL CHECK(furnishing_version=1),
 source jsonb NOT NULL, render_request jsonb NOT NULL,
 png_sha256 text NOT NULL CHECK(png_sha256 ~ '^[a-f0-9]{64}$'),
 png_bytes integer NOT NULL CHECK(png_bytes BETWEEN 1 AND 524288),
 object_key text NOT NULL,
 receipt jsonb NOT NULL,
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT workspace_furnishing_thumbnail_candidates_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT workspace_furnishing_thumbnail_candidate_request_key UNIQUE(workspace_id,tenant_id,user_id,request_id),
 CONSTRAINT workspace_furnishing_thumbnail_candidate_binding_key UNIQUE(workspace_id,tenant_id,user_id,furnishing_id,furnishing_version,id,receipt_sha256),
 CONSTRAINT workspace_furnishing_thumbnail_candidate_owner_fkey FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 CONSTRAINT workspace_furnishing_thumbnail_candidate_model_fkey FOREIGN KEY(workspace_id,furnishing_id,furnishing_version) REFERENCES workspace_furnishing_versions(workspace_id,id,version),
 CHECK(object_key=tenant_id::text||'/workspace-furnishing-thumbnail/'||workspace_id::text||'/'||id::text||'/'||png_sha256),
 CHECK(COALESCE(
  jsonb_typeof(source)='object' AND
  source ?& ARRAY['furnishingId','furnishingVersion','modelSha256','modelBytes','descriptorSha256','rightsSha256'] AND
  source - ARRAY['furnishingId','furnishingVersion','modelSha256','modelBytes','descriptorSha256','rightsSha256']='{}'::jsonb AND
  source->>'furnishingId'=furnishing_id::text AND source->'furnishingVersion'='1'::jsonb AND
  source->>'modelSha256' ~ '^[a-f0-9]{64}$' AND source->>'descriptorSha256' ~ '^[a-f0-9]{64}$' AND source->>'rightsSha256' ~ '^[a-f0-9]{64}$' AND
  jsonb_typeof(source->'modelBytes')='number' AND (source->>'modelBytes')::numeric BETWEEN 28 AND 33554432 AND
  trunc((source->>'modelBytes')::numeric)=(source->>'modelBytes')::numeric,false)),
 CHECK(COALESCE(
  jsonb_typeof(render_request)='object' AND
  render_request ?& ARRAY['version','epoch','sequence','tenantId','principalId','requestId','furnishingId','furnishingVersion','modelBytes','modelSha256','recipeId','toolId'] AND
  render_request - ARRAY['version','epoch','sequence','tenantId','principalId','requestId','furnishingId','furnishingVersion','modelBytes','modelSha256','recipeId','toolId']='{}'::jsonb AND
  render_request->'version'='1'::jsonb AND
  render_request->>'epoch' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' AND
  jsonb_typeof(render_request->'sequence')='number' AND (render_request->>'sequence')::numeric BETWEEN 1 AND 9007199254740991 AND
  trunc((render_request->>'sequence')::numeric)=(render_request->>'sequence')::numeric AND
  render_request->>'tenantId'=tenant_id::text AND render_request->>'principalId'=user_id::text AND render_request->>'requestId'=request_id::text AND
  render_request->>'furnishingId'=furnishing_id::text AND render_request->'furnishingVersion'='1'::jsonb AND
  render_request->'modelBytes'=source->'modelBytes' AND render_request->'modelSha256'=source->'modelSha256' AND
  render_request->>'recipeId'='furnishing-glb-card-256-v1' AND render_request->>'toolId'='exhibitos-three-0.186.1-thumbnail-v1',false)),
 CHECK(receipt=jsonb_build_object('version',1,'purpose','registered-furnishing-thumbnail','profile','workspace-furnishing-thumbnail-v1',
  'workspaceId',workspace_id::text,'candidateId',id::text,'requestId',request_id::text,'source',source,'renderRequest',render_request,
  'png',jsonb_build_object('mime','image/png','width',256,'height',256,'sha256',png_sha256,'bytes',png_bytes)))
);
CREATE TRIGGER workspace_furnishing_thumbnail_candidate_immutable BEFORE UPDATE OR DELETE ON workspace_furnishing_thumbnail_candidates FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE workspace_furnishing_thumbnail_selections (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 furnishing_id uuid NOT NULL, furnishing_version integer NOT NULL CHECK(furnishing_version=1),
 version integer NOT NULL CHECK(version>=1),
 request_id uuid NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 candidate_id uuid NOT NULL, receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT workspace_furnishing_thumbnail_selections_pkey PRIMARY KEY(workspace_id,furnishing_id,furnishing_version,version),
 CONSTRAINT workspace_furnishing_thumbnail_selection_request_key UNIQUE(workspace_id,tenant_id,user_id,request_id),
 CONSTRAINT workspace_furnishing_thumbnail_selection_owner_fkey FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 CONSTRAINT workspace_furnishing_thumbnail_selection_model_fkey FOREIGN KEY(workspace_id,furnishing_id,furnishing_version) REFERENCES workspace_furnishing_versions(workspace_id,id,version),
 CONSTRAINT workspace_furnishing_thumbnail_selection_candidate_fkey FOREIGN KEY(workspace_id,tenant_id,user_id,furnishing_id,furnishing_version,candidate_id,receipt_sha256)
  REFERENCES workspace_furnishing_thumbnail_candidates(workspace_id,tenant_id,user_id,furnishing_id,furnishing_version,id,receipt_sha256)
);
CREATE TRIGGER workspace_furnishing_thumbnail_selection_immutable BEFORE UPDATE OR DELETE ON workspace_furnishing_thumbnail_selections FOR EACH ROW EXECUTE FUNCTION immutable_revision();
