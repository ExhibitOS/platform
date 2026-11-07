-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Separate opt-in catalog; ordinary reopen must never apply it implicitly.
-- The stage row is committed before writing the derived object, so interrupted
-- workers leave durable, owner-bound evidence for retry or cancellation.
CREATE TABLE workspace_frame_preparations (
 workspace_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 intake_id uuid NOT NULL, furnishing_id uuid NOT NULL, furnishing_version integer NOT NULL CHECK(furnishing_version=1),
 source_key text NOT NULL, source_bytes integer NOT NULL CHECK(source_bytes>0),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 renderable_key text NOT NULL, renderable_bytes integer NOT NULL CHECK(renderable_bytes>0),
 renderable_sha256 text NOT NULL CHECK(renderable_sha256 ~ '^[a-f0-9]{64}$'),
 recipe text NOT NULL CHECK(recipe='omit-unused-invalid-tangent-r1'),
 state text NOT NULL CHECK(state IN ('staged','registered')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,intake_id), UNIQUE(workspace_id,furnishing_id,furnishing_version),
 FOREIGN KEY(workspace_id,intake_id) REFERENCES workspace_furnishing_intakes(workspace_id,id),
 FOREIGN KEY(workspace_id,tenant_id,user_id) REFERENCES local_workspaces(id,tenant_id,user_id),
 CHECK(source_key=tenant_id::text||'/workspace-furnishing-intake/'||workspace_id::text||'/'||intake_id::text||'/'||source_sha256),
 CHECK(renderable_key=tenant_id::text||'/workspace-furnishing-intake/'||workspace_id::text||'/'||intake_id::text||'/'||renderable_sha256),
 CHECK((source_sha256='17c571accc4ed2554731d4ce89f3cad4faa66cf2bca83321ecd92ad2537093d9' AND source_bytes=101768 AND renderable_sha256='2fb941a9f6ed030638512e917e348a0a3000e29c1133fe3f9670268ff1c4169c' AND renderable_bytes=101720) OR
       (source_sha256='b21ee369bf9e2d958d9ff2c03cf2457bbd22669c7d1621c379bebcb6330a8c89' AND source_bytes=147640 AND renderable_sha256='a0d0c0d3f02fea91b6a09273eec8d200248a16c8caf5139bd029b681af8eddcd' AND renderable_bytes=147592) OR
       (source_sha256='06ac605194e7aa870c4c9c68c17e00b6d1256c421aba6ed9b169e7f873b7b8d9' AND source_bytes=177500 AND renderable_sha256='5af789b1aa8e6aa410b40cf16e27c9e2000f87438f1fa52cb08bc46c19c75778' AND renderable_bytes=177476))
);
CREATE FUNCTION protect_workspace_frame_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='registered' THEN RAISE EXCEPTION 'registered frame preparation is immutable'; END IF;
 IF TG_OP='UPDATE' AND (ROW(OLD.workspace_id,OLD.tenant_id,OLD.user_id,OLD.intake_id,OLD.furnishing_id,OLD.furnishing_version,OLD.source_key,OLD.source_bytes,OLD.source_sha256,OLD.renderable_key,OLD.renderable_bytes,OLD.renderable_sha256,OLD.recipe,OLD.created_at)
  IS DISTINCT FROM ROW(NEW.workspace_id,NEW.tenant_id,NEW.user_id,NEW.intake_id,NEW.furnishing_id,NEW.furnishing_version,NEW.source_key,NEW.source_bytes,NEW.source_sha256,NEW.renderable_key,NEW.renderable_bytes,NEW.renderable_sha256,NEW.recipe,NEW.created_at) OR NEW.state<>'registered') THEN
  RAISE EXCEPTION 'frame preparation binding is immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_frame_preparation_immutable BEFORE UPDATE OR DELETE ON workspace_frame_preparations FOR EACH ROW EXECUTE FUNCTION protect_workspace_frame_preparation();
-- Once a preparation is registered, its intake is the retained source receipt.
-- The validating -> registered settlement remains possible in the transaction
-- that registers the preparation; subsequent edits/deletion are forbidden.
CREATE FUNCTION protect_registered_frame_preparation_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.phase='registered' AND EXISTS (SELECT 1 FROM workspace_frame_preparations p WHERE p.workspace_id=OLD.workspace_id AND p.intake_id=OLD.id AND p.state='registered') THEN
  RAISE EXCEPTION 'registered frame preparation intake is immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_frame_preparation_intake_immutable BEFORE UPDATE OR DELETE ON workspace_furnishing_intakes FOR EACH ROW EXECUTE FUNCTION protect_registered_frame_preparation_intake();
