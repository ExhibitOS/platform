# Input policy observation

The authenticated POST route in `contracts/processing-authorization-openapi.json`
checks the current session, exact tenant/Origin/Host, CSRF, and current artwork
write ownership. Only the current administrator or owning artist can pass.
It validates current public OES rights and requires export permission plus explicit
`processingConsent: true`. No private producer code, images or source paths enter
this request. Only a dataset SHA-256 and caller request UUID are submitted.

The response binds current subject/role, tenant, artwork/revision, origin, input
hash, nonce and canonical rights hash. It expires within thirty seconds and no
later than session or rights expiry, with `Cache-Control: no-store`.

This is a point-in-time policy observation, not a bearer capability, authorization
to replay a request, durable ingest permit, reconstruction result or publication.
Export permission and explicit consent are a conservative application policy;
they do not independently establish copyright or permission to modify a work.
The route creates no upload, import, asset or job. A worker must check current
rights again; clients must authenticate directly to the configured authority and
verify the exact response binding. A caller-supplied response is not trusted proof.

Persistent authenticated intake still requires atomic job/audit admission,
original producer output, independent input rehash, rights changes and restart
custody checks. These are separate unfinished gates. Existing imports and their
rights requirements are unchanged.

## Reproduce the server check

Build the storage/API workspaces with the pinned Node version. Set
`EXHIBITOS_TEST_POSTGRES_IMAGE` to an already installed immutable PostgreSQL
image ID, then run `node scripts/test-processing-authorization.mjs`.
The check uses real HTTP/PostgreSQL and a labelled, memory-backed synthetic DB.
It refuses implicit image pulls and persistent data mounts, stops only its own
container after closing connections, and prints no credentials. It tests current
roles, ownership, revoked/expired rights, exact origin/CSRF/Host, closed input,
bounded response binding and zero import/asset side effects.
