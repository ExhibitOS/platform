# Local runtime readiness contract

The optional `buildApp` lifecycle configuration enables public
`GET /api/v1/readiness`. Existing `/api/v1/health` remains process liveness.
A runtime must configure migration, web-build and blob roots explicitly; ordinary
development servers do not expose readiness by default.

Protocol version `1` uses `schemaVersion: "1.0.0-draft.1"`,
`platformVersion: "0.1.0"`, `ready` and component states. Components are
`platform`, `api`, `database`, `web`, `storage`; these are not Compose service
names. A successful response is HTTP200; an unavailable component produces
HTTP503. Both responses use `Cache-Control: no-store`. Manager must reject an
unsupported protocol or platform version and inspect all component states.

Database readiness compares the complete applied migration-name/SHA-256 inventory
with the configured migration bytes. Web readiness requires a readable nonempty
index.html under a real directory. Storage readiness requires an accessible
read/write/searchable real directory. Symlink roots and index files fail closed.
Only status values leave the endpoint; database errors, paths, credentials and
user rows are excluded. The runtime must bound pool connection acquisition;
the migration inventory query also has a two-second client timeout.

These checks do not certify throughput, quotas, device capabilities, external
backups or realtime availability. The local runtime currently uses the Platform
and PostgreSQL Compose services; realtime is a later implementation. This draft
contract does not change authentication, asset rights or existing API health.
