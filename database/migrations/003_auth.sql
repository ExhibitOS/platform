ALTER TABLE users ADD COLUMN disabled boolean NOT NULL DEFAULT false;
CREATE TABLE auth_credentials (
 user_id uuid PRIMARY KEY REFERENCES users(id), salt bytea NOT NULL CHECK(octet_length(salt)=16),
 password_hash bytea NOT NULL CHECK(octet_length(password_hash)=32),
 algorithm text NOT NULL CHECK(algorithm='argon2id'), memory integer NOT NULL CHECK(memory=19456), passes integer NOT NULL CHECK(passes=2), parallelism integer NOT NULL CHECK(parallelism=1)
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'), csrf_token text NOT NULL,
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX auth_sessions_user ON auth_sessions(tenant_id,user_id);
CREATE TABLE exhibition_assignments (
 tenant_id uuid NOT NULL, exhibition_id uuid NOT NULL, user_id uuid NOT NULL, can_view boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,exhibition_id,user_id),
 FOREIGN KEY(tenant_id,exhibition_id) REFERENCES exhibitions(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
