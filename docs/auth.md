# Authentication and tenant access

The reference API uses tenant-bound database sessions. Both local development and network mode require authentication for protected resources. The public health endpoint remains process liveness; it does not disclose a session or prove database readiness. This stage adds server policy, not a completed account-management UI, external OIDC provider or anonymous publication service.

The machine-readable contract is [auth-openapi.json](../contracts/auth-openapi.json); design decisions and primary security references are in [ADR 0003](adr/0003-auth.md).

## Request flow

Login with an existing subject, password and tenant membership at `POST /api/v1/auth/login`. Supply the exact configured `Origin`. The server issues an HttpOnly cookie and returns `{authenticated: true}`; it does not return the cookie's bearer token in JSON. `GET /api/v1/auth/session` returns the authenticated user, tenant, current role, CSRF token and expiry. Never put passwords or session cookies in URLs or logs.

Every authenticated mutation supplies the cookie, the exact configured `Origin`, and `X-CSRF-Token` from the session response. The token is separate from the cookie and cannot authenticate a request alone. Logout revokes the database session and clears the cookie. Expired, revoked, disabled-user and removed-membership sessions cannot access resources. Membership and assignment changes are evaluated on subsequent requests rather than relying on role data held in the browser.

A tenant path must match the tenant bound to the session. Logging into another tenant is an explicit new login after selecting an existing membership; changing a URL is not a tenant switch. Missing and inaccessible resources return the same denied response to reduce ID enumeration. Server checks apply even when a client directly calls a hidden operation.

## Role and resource policy

| Operation | Admin | Artist | Curator | Viewer |
| --- | --- | --- | --- | --- |
| Artwork metadata read | Own tenant | Own artwork | Artwork placed in an assigned exhibition | Denied |
| Artwork metadata edit | Own tenant | Own artwork | Denied | Denied |
| Exhibition read | Own tenant | Explicit `canView` grant | Explicit assignment | Explicit `canView` grant |
| Exhibition edit | Own tenant | Denied | Explicit assignment | Denied |
| Asset metadata read | Own tenant | Asset of own artwork | Denied | Denied |
| Asset export eligibility | Own tenant, with valid `permissions.export` rights | Own artwork, with valid `permissions.export` rights | Denied | Denied |
| Private asset bytes | Own tenant, with valid `permissions.download` rights | Own artwork, with valid `permissions.download` rights | Denied | Denied |
| Membership, assignment, revoke and disable operations | Own tenant | Denied | Denied | Denied |

Artist identity is separate from login identity and an artwork references its artist owner. Curator assignments are not inferred from membership alone. For a curator, an assignment grants exhibition editing regardless of `canView`; for an artist or viewer, `canView: true` grants exhibition read only. It does not grant raw asset or artwork access. Tenant admin privileges never cross tenant boundaries.

`PATCH` artwork/exhibition sends `{revision, metadata}`. A successful edit increments the revision and preserves an immutable snapshot; a stale expected revision returns a conflict. The caller must fetch current data and resolve its edit before retrying. Generic metadata editing does not imply that arbitrary HTML, executable scripts or new publication rights are safe; rendering and publication validation remain separate work.

`GET /assets/:id` returns metadata only. `POST /assets/:id/export-check` evaluates role and the full OES rights record using the exported public OES rights JSON schema and strict UTC validity checks at the current instant. It requires `rights.permissions.export: true` and returns eligibility only. It does not return bytes, an OEX archive, a signed URL or a private object key. Curator/viewer access to an exhibition does not authorize asset download.

`GET /assets/:id/bytes` is a separate private download operation. It requires admin/owning-artist access, a full rights record accepted by the exported public OES rights JSON schema, `rights.permissions.download: true`, a currently valid optional `validFrom`/`expiresAt` interval, a configured blob adapter, `stored` or format-`approved` processing state, and matching metadata SHA-256 and byte count. It returns a bounded object as `application/octet-stream` with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. This is neither an anonymous gallery nor an OEX exporter. `stored` represents storage integrity only; format/decoder validation and publication approval remain required in subsequent ingestion/rendering work. Unconfigured storage returns `503 STORAGE_UNAVAILABLE`; an unstored or inconsistent asset returns a 409 error.

Rights follow the public OES artwork schema: `holder`, `ownership`, a `licenseId` or `licenseText`, `creditLine`, and nested `permissions` containing the four boolean flags `display`, `download`, `export` and `commercial`. Download and export are independent: an export grant does not permit the private bytes endpoint when download is false, and a download grant does not permit export eligibility when export is false. `display: false` alone does not block either operation; these routes do not publish the artwork. Optional UTC `validFrom` is inclusive and `expiresAt` is exclusive at request time.

Compatibility: earlier storage-only examples with flat fields such as `{export: true}` are not accepted authorization records. Unknown or conflicting flat-versus-nested fields and malformed/incomplete rights fail closed with `403 RIGHTS_DENIED`. Existing rows need an explicitly reviewed full OES rights record before download/export can be authorized; no permission is inferred or automatically migrated from legacy booleans. The public artifact and source are pinned in [artifact.json](../contracts/artifact.json). Rights validation neither approves GLB/image formats nor creates an OEX archive or a publication grant.

## Administration and operational limits

Initial admin enrollment is a one-time operator bootstrap transaction, using a bounded JSON input of at most 4096 bytes read from stdin. Its fields are `tenantId`, `subject` and `password`, with no extra fields. Bootstrap closes for the whole database after its first credential exists. There is no default password, public bootstrap route or public signup. Tenant admins can enroll a new account using `POST /api/v1/tenants/:tenantId/users`; the subject is globally unique and the account starts with the supplied tenant role. Keep the database connection environment private. A shared local password, password passed in argv or committed credential is not a supported setup procedure.

Admin session revocation is tenant-scoped. Disabling a user is an account-wide state change and invalidates its sessions, so an admin may disable only a member with no membership in another tenant. A multi-tenant target returns `409 MULTI_TENANT_USER`. Demoting or disabling the last active tenant admin returns `409 LAST_ADMIN`. Administrative mutations take the exclusive permission lock and resource transactions take its shared form. A revoke waits for already-authorized resource work to finish; it does not undo a transaction that already completed.

Local mode uses loopback binding and a loopback HTTP origin solely for development. It still checks session, membership, CSRF, Origin and Host. Network mode requires a configured HTTPS origin and a secure cookie, and also permits only a loopback bind (`127.0.0.1` or `::1`). The reference HTTP server must run behind an external TLS terminator; an external plaintext bind is rejected. Proxy trust is disabled, and forwarded headers cannot override these checks. An HTTPS configuration string does not create certificates or a TLS listener. Use the exact allowed origin rather than a wildcard. CORS or a hidden UI is not authorization.

Database credentials remain privileged infrastructure access. This reference policy does not create PostgreSQL row-level security or make stolen credentials safe. OIDC federation, MFA, account invitation/reset/recovery, distributed session management, signed file URLs, real export bytes and production penetration testing are outside this stage. Rate limits are a bounded reference defense and require deployment-specific capacity and abuse review.

## Runtime and bootstrap

Apply migrations and build using the documented storage workflow before starting authenticated services. Set `DATABASE_URL`, `AUTH_MODE` and `AUTH_ORIGIN` together through a private environment; partial configuration fails startup. `AUTH_ORIGIN` is an exact origin without a path, userinfo or trailing slash. `HOST` and `PORT` select the listener. For local development use `HOST=127.0.0.1` and an origin matching the client-visible host/port. No auth configuration leaves only the health foundation on loopback; it does not expose unprotected metadata routes. A configured API refuses startup if the auth database/migration is unavailable.

`BLOB_ROOT` optionally selects the private filesystem backend for the reference server. Keep it restricted to the service account and ensure it contains the configured database's object keys. The generic adapter interface can accept S3 in code, but the reference server does not provide an S3 credential/environment deployment profile.

After securely creating a mode-0600 ignored bootstrap JSON file, the operator can run:

```sh
npm run build
npm run auth:bootstrap < .local/bootstrap-admin.json
```

Supply the database URL privately in the environment. The CLI accepts no command-line credential arguments, returns only the new user and tenant IDs, and prints a generic failure. It does not create a production account recovery procedure. Rotate credentials through a separately reviewed operator process; do not reopen bootstrap against a live database.

Session cookies expire after eight hours with no sliding renewal in this reference. Login permits at most ten attempts per source address per minute, four concurrent password hashes and 4096 tracked addresses per process. These controls are process-local; multiple API instances need a shared abuse-control strategy. With proxy trust disabled, requests through one TLS proxy share that proxy's source address and therefore its login-attempt bucket. The proxy must provide its own reviewed abuse controls; do not enable forwarded-header trust to bypass the reference policy. The same password-hash capacity guard applies to admin enrollment. Log and reverse-proxy configuration must redact credentials and cookies. Database backups contain credential hashes and session/CSRF records and need private handling; review and revoke restored sessions before enabling a restored environment.

## Verification

Run `npm run check`, `npm run test:auth`, `npm run test:storage` and `npm run test:e2e` with the pinned runtime. The auth and storage integration commands require local Docker and use owned synthetic resources. Actual results belong to the implementation handoff evidence. Required negative cases include another tenant's read/edit/export/asset, missing or wrong Origin/CSRF, wrong Host/forwarded-header attempts, stale revision, role/assignment changes, logout/revoke/disable, and a local configuration attempted on a network listener. This document records the expected contract and must be synchronized with actual handlers before release; its existence does not prove those tests have passed.

Primary-asset import is documented in [imports.md](imports.md). Format approval is not anonymous publication authorization. Legacy internal `stored` attachments remain private and rights-gated; quarantine and rejected objects cannot be downloaded.

CMS-managed 작품은 `cms_managed` 표시로 구분합니다. 기존 artwork GET은 이 레코드의 소유 artist와 tenant admin만 private metadata를 읽게 하며, 배정된 관람자·curator는 CMS display serializer를 사용합니다. 기존 generic PATCH는 `400 CMS_ROUTE_REQUIRED`로 거부하고 검증된 CMS 수정 경로를 요구합니다. 원본·export는 asset rights와 CMS artwork rights의 교집합을 적용하며 CMS rights 누락·오류는 거부합니다. Legacy non-CMS 레코드의 기존 정책은 유지됩니다.
