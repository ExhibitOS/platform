-- SPDX-License-Identifier: AGPL-3.0-or-later
CREATE TABLE freeze_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL, exhibition_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('creating','failed','complete')),
 lease_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 5),
 object_keys jsonb NOT NULL, cleanup_pending boolean NOT NULL DEFAULT false, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,user_id,request_id)
);
CREATE TABLE exhibition_freezes (
 tenant_id uuid NOT NULL,id uuid NOT NULL UNIQUE,exhibition_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 source_snapshot jsonb NOT NULL,manifest jsonb NOT NULL,manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 signature text NOT NULL,inventory jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,id) REFERENCES freeze_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER freeze_snapshot_immutable BEFORE UPDATE OR DELETE ON exhibition_freezes FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE freeze_availability (tenant_id uuid NOT NULL,freeze_id uuid NOT NULL,revoked boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,freeze_id),FOREIGN KEY(tenant_id,freeze_id) REFERENCES exhibition_freezes(tenant_id,id));
CREATE TABLE freeze_events (tenant_id uuid NOT NULL,id uuid NOT NULL,freeze_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),action text NOT NULL CHECK(action IN ('created','offline-authorized','revoked','restored')),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,freeze_id) REFERENCES exhibition_freezes(tenant_id,id));
CREATE TRIGGER freeze_event_immutable BEFORE UPDATE OR DELETE ON freeze_events FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE FUNCTION freeze_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'freeze receipts retained'; END IF;
 IF ROW(NEW.tenant_id,NEW.id,NEW.user_id,NEW.request_id,NEW.exhibition_id,NEW.payload_sha256,NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.user_id,OLD.request_id,OLD.exhibition_id,OLD.payload_sha256,OLD.created_at) THEN RAISE EXCEPTION 'freeze identity immutable'; END IF;
 IF OLD.state='complete' AND ROW(NEW.state,NEW.object_keys,NEW.cleanup_pending) IS DISTINCT FROM ROW(OLD.state,OLD.object_keys,OLD.cleanup_pending) THEN RAISE EXCEPTION 'completed freeze retained'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_request_immutable BEFORE UPDATE OR DELETE ON freeze_requests FOR EACH ROW EXECUTE FUNCTION freeze_request_immutable();
