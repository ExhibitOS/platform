ALTER TABLE exhibitions ADD COLUMN studio_managed boolean NOT NULL DEFAULT false,
 ADD COLUMN studio_owner_user_id uuid REFERENCES users(id),
 ADD CONSTRAINT studio_owner_required CHECK(NOT studio_managed OR studio_owner_user_id IS NOT NULL);
CREATE TABLE studio_requests (
 tenant_id uuid, user_id uuid REFERENCES users(id), request_id uuid,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 exhibition_id uuid NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,request_id),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id)
);
CREATE TRIGGER studio_receipt_immutable BEFORE UPDATE OR DELETE ON studio_requests FOR EACH ROW EXECUTE FUNCTION immutable_revision();
