# Studio authoring drafts

Open `/studio` on the production web origin. Local creation, JSON editing,
autosave, reopening, history recovery and file backup need no account or server.
The initial online visit must finish the explicit offline-shell preparation;
after that the installed service worker serves the verified public application
code for `/studio`. An unprepared browser cannot install an app while offline.
Development mode does not provide this production offline-shell guarantee.

This stage edits the complete public OES exhibition draft JSON. It preserves
rooms, surfaces, openings, placements, artwork snapshots, navigation, rights,
accessibility and declarative scripts. It is not yet the geometry editor,
Viewer, publication pipeline or a renderer of artwork bytes. Every local save
and remote write validates the full pinned public schema and document semantics,
including references, normalized quaternions, physical units and accessibility.
The version is `1.0.0-draft.1`; documents over 1 MiB, depth 32, 100,000 JSON nodes
or 16,384 code units per string are rejected. Asset bytes are not fetched or
validated by this authoring stage.

## Local storage and recovery

IndexedDB database `exhibitos-studio` version 2 stores each current record and
immutable version history in one transaction. A save supplies the expected local
version; a second tab's completed save produces `LOCAL_CONFLICT` instead of
overwriting it. History recovery creates another version and requires the same
comparison. The interactive history window loads the newest 50 versions; older
versions remain retained and included in an explicit raw rescue export. A fork assigns new draft/exhibition/revision IDs and drops the remote
account binding; it retains geometry, references and embedded artwork snapshots.

The defined database-v1 record is `{id,format:1,version,draft,updatedAt}` with a
valid public draft and matching version/IDs/timestamps. Upgrade preserves its raw
record in `legacy`, copies valid entries to version 2 with an initial history
record and leaves malformed entries intact. A failed upgrade rolls back; an
older tab can block it, requiring that tab to close and an explicit retry. Future
database/record versions and corrupt records fail closed. Raw rescue exports
retain current, history and legacy values without replacing them.

Quota exhaustion and interrupted transactions retain the last completed current
record and history. The editor keeps unsaved input available for a separate file
backup. Save the JSON backup and any unsaved input before changing browser
storage settings. Browser storage can be evicted or cleared; persistence is not
a backup guarantee. This implementation never automatically deletes prior
drafts, history, rescue copies or prior service-worker caches.

Normal backup files use `{kind:'exhibitos-local-draft-backup',format:2,record}`.
Import validates that envelope and the full draft, then creates a new independent
fork. A raw rescue is diagnostic JSON, not a normal import file. Neither backup
contains artwork bytes nor constitutes a full OEX archive. Obtain independent
asset backups before relying on later distribution/export workflows.

Local drafts are stored in the current browser profile/origin and remain usable
after logout. They are not private per account on a shared browser profile; use
separate OS/browser profiles for private local work. No password, session token,
CSRF token or asset bytes are written into draft records.

## Optional remote authoring

After explicit account/session confirmation, artists and curators can create
their own remote drafts. Tenant admins can administer tenant drafts. Other owners,
assigned curators and viewers cannot access private authoring drafts. Every
request checks current server membership, tenant and resource ownership. All
protected responses use `Cache-Control: no-store`; the offline worker does not
cache API responses, sessions, draft JSON or protected artwork bytes.

The [Studio OpenAPI](../contracts/studio-openapi.json) defines three routes:

- `POST /api/v1/tenants/{tenantId}/studio/exhibitions` creates a remote draft using
  `{draft,requestId}`. Its ID is `draft.exhibitionId`, distinct from `draft.id`.
- `GET /api/v1/tenants/{tenantId}/studio/exhibitions/{id}` returns
  `{revision,etag,draft}` and the same strong quoted HTTP `ETag`.
- `PUT` at that path requires exactly one strong `If-Match` and
  `{draft,requestId}`. It atomically compares the server ETag, creates an immutable
  remote snapshot and advances the server revision.

The ETag combines the server authoring revision and SHA-256 of sorted draft JSON.
The server revision is independent of local editVersion and the candidate's
logical exhibition revision. Missing `If-Match` is 428, weak/list/wildcard or
malformed values are 400, stale values are 412. Fetch the current server draft
explicitly to compare after a conflict, then choose a separate local fork or an
explicit apply. A conflict never silently retries with the newest server ETag.
The legacy generic exhibition PATCH returns `STUDIO_ROUTE_REQUIRED` for these
records, so it cannot bypass public schema validation or the ETag comparison.

`requestId` is an idempotency key scoped to the tenant and authenticated account.
An exact lost-response retry returns its original durable response without a new
revision. Reusing the key with changed method, payload, target or If-Match returns
409. A historical replay response may contain an older ETag; fetch current state
before applying later edits. Revoked ownership/membership is checked even for
cached receipts. Local remote bindings contain only
`{tenantId,userId,id,etag,revision}`; account mismatch blocks UI synchronization.

## Application updates and verification

The production offline shell validates build hashes before caching public bytes.
New shells wait until explicit application-update action or old tabs close;
there is no automatic `skipWaiting` and no deletion of prior caches. Back up
drafts before applying updates. A cache quota/install failure leaves prior
completed drafts intact. Cache availability differs from local draft durability.

Use Node 24.21.0/npm 11.19.0, `npm ci`, `npm run check`, `npm run test:drafts`,
and `npm run test:e2e`. The draft integration command requires local Docker and
Chromium and uses isolated synthetic PostgreSQL metadata. Setting
`EXHIBITOS_DRAFTS_SKIP_BROWSER=1` runs only the API portion and must not be cited
as offline-browser proof. The browser-only Apache public validator adaptation is
documented in [its source notice](../apps/web/src/drafts/README.md); the server
uses the original pinned public package.
