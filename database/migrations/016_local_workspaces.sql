-- Personal native workspace ownership. No passwords or anonymous HTTP authority.
CREATE TABLE local_workspaces (
 id uuid PRIMARY KEY,
 tenant_id uuid UNIQUE NOT NULL REFERENCES tenants(id),
 user_id uuid UNIQUE NOT NULL REFERENCES users(id),
 mac_uid bigint NOT NULL CHECK(mac_uid > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
