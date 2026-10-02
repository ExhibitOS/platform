-- SPDX-License-Identifier: AGPL-3.0-or-later
-- No deletion API: immutable approved bytes/rights plus reversible current availability.
CREATE TABLE studio_audio (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL, id uuid NOT NULL,
 request_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=12582912),
 mime text NOT NULL CHECK(mime='audio/wav'), rights jsonb NOT NULL,
 object_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('uploading','validated','approved')),
 duration_seconds double precision, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,created_by,request_id),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TABLE audio_approvals (
 tenant_id uuid NOT NULL, audio_id uuid NOT NULL, snapshot jsonb NOT NULL,
 approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,audio_id), FOREIGN KEY(tenant_id,audio_id) REFERENCES studio_audio(tenant_id,id)
);
CREATE TRIGGER audio_approval_immutable BEFORE UPDATE OR DELETE ON audio_approvals FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE publication_media (
 tenant_id uuid NOT NULL, publication_id uuid NOT NULL, id uuid NOT NULL,
 source_audio_id uuid NOT NULL, source_sha256 text NOT NULL,
 object_key text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=12582912), mime text NOT NULL CHECK(mime='audio/wav'),
 PRIMARY KEY(publication_id,id),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES studio_publications(tenant_id,id),
 FOREIGN KEY(tenant_id,source_audio_id) REFERENCES audio_approvals(tenant_id,audio_id)
);
CREATE TRIGGER publication_media_immutable BEFORE UPDATE OR DELETE ON publication_media FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE FUNCTION audio_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'audio sources are retained'; END IF;
 IF ROW(NEW.tenant_id,NEW.exhibition_id,NEW.id,NEW.request_id,NEW.created_by,NEW.payload_sha256,NEW.sha256,NEW.bytes,NEW.mime,NEW.rights,NEW.object_key,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.tenant_id,OLD.exhibition_id,OLD.id,OLD.request_id,OLD.created_by,OLD.payload_sha256,OLD.sha256,OLD.bytes,OLD.mime,OLD.rights,OLD.object_key,OLD.created_at)
 THEN RAISE EXCEPTION 'audio source immutable'; END IF;
 IF OLD.state='approved' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds) THEN RAISE EXCEPTION 'approved audio immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER audio_source_immutable BEFORE UPDATE OR DELETE ON studio_audio FOR EACH ROW EXECUTE FUNCTION audio_source_immutable();
