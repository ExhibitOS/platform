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
or 16,384 code units per string are rejected. The editor additionally caps
candidate JSON input at 1,000,000 UTF-8 bytes; the remote HTTP request including
draft/requestId wrappers is capped at 1 MiB. These transport/editor limits can
reject a near-limit document before the public schema limit. Asset bytes are not
fetched or validated by this authoring stage.

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

## Workspace material intake — contract draft

This section is a proposed interface for review, not an implemented API or a
claim that existing OEX readers support user materials. Built-in registered
material packs retain their existing identifiers and behavior. The first slice
covers a user's floor and wall PNG maps; furnishing GLB follows through the
same workspace-owned intake boundary with its own format validation.

A personal workspace owner creates an intake for `floor` or `wall` with an
idempotency key, name, explicit rights and provenance, and role descriptors.
`color` is required; `normal`, `roughness`, and `ao` are optional. Each role
has bounded bytes, SHA-256, dimensions, and color-space semantics. Color is
sRGB; data maps are linear; a normal map must declare its orientation. The
server accepts bytes separately, validates exact content and the supported PNG
profile, and registers an immutable material ID and version only on successful
completion. Client paths and external URLs are never authority. Material
registration is scoped to the authenticated workspace; sharing or promotion to
the built-in catalogue is a separate action.

The intended flow is create → upload required role bytes → complete and inspect
validation → list/read the workspace material and preview → apply to a floor or
wall through the existing Studio save and ETag. Failed or cancelled intake must
leave earlier resources and the saved exhibition unchanged. Retrying the same
idempotency key and content returns the same operation; using it for different
content is a conflict. Another workspace cannot read, complete, apply, or export
its owner’s material. Applying floor appearance preserves existing sound unless
sound is explicitly edited through its own supported operation.

A new explicitly versioned OEX profile is required for exact referenced user
materials, rights, provenance, and map bytes. Existing OEX versions are not
reinterpreted. Import must verify bytes and references, bind material ownership
to the destination workspace and remap IDs without changing the source; static
export must carry only authorized referenced materials. This contract still
requires precise endpoint schemas and error codes, shared Spec implementation,
Manager CLI/GUI integration, and actual save/reopen/export/Viewer verification.

The current endpoint proposal, pending Manager and Spec review, is under the
existing `/api/v1/tenants/:tenantId` prefix:

- `POST /workspace/material-intakes` declares request ID, kind, name, rights,
  provenance, and role descriptors; the server issues the material identity.
- `PUT /workspace/material-intakes/:id/maps/:role` supplies exact bytes;
  `GET /workspace/material-intakes/:id` reads progress; `POST .../complete`
  validates and registers; `POST .../cancel` cancels the owned attempt.
- `GET /workspace/materials`, `GET /workspace/materials/:id/versions/:version`,
  and `GET .../maps/:role` list, inspect, and preview approved owned versions.

These routes do not exist yet. The proposed portable profile is a distinct
OEX draft.12; it is not admitted by existing draft.9/10 native runtimes.
The draft must also cover bounded import, immutable byte and rights checks,
and remapped workspace identities before portable use can be claimed.

### Candidate request and response details

The following details are proposed for the shared review; until the server and
Spec implement them they are not production behavior. All routes are available
only to the authenticated personal workspace owner, under the tenant prefix.
Create takes a UUID `requestId`, `kind`, `name`, `rights`, `provenance`, and a
role-keyed `maps` object. A map has `mime`, `bytes`, `sha256`, `width`, `height`,
and `colorSpace`; normal also has `normalY: "up"`. Each PNG is at most 8 MiB,
at most 4,194,304 pixels, and 8-bit noninterlaced RGB or RGBA. The untagged
color map is interpreted as sRGB only when explicitly declared; data maps are
linear and must not have an sRGB chunk. Other roles and URLs/paths are rejected.
Repeat and rotation belong to each surface binding, not the immutable resource.

An intake response is intended to carry `intakeId`, `requestId`, `kind`, a
phase (`uploading`, `validating`, `cancelling`, `registered`, `failed`, or `cancelled`), a
role-keyed received map with verified byte count and hash, `retryable`, and
`error` (`code`, optional `role` and `field`) or the completed material
`descriptor`. Every operation remains readable by the same workspace owner.
`GET /workspace/materials` is proposed as a cursor-paginated list with at most
50 bounded summaries per page (`id`, `version`, `kind`, `name`, and current
rights availability), plus `nextCursor`. Full rights, provenance, and map
descriptors are returned only by the single-version read. Preview responses return PNG bytes, MIME, byte count and
SHA-256 from the authorized descriptor with no redirect. Preview requires a
current display grant; archive export and original download separately require
the corresponding grant. The authorization decision is checked at use time.

The same request UUID and identical normalized declaration returns the existing
intake; a different declaration is `IDEMPOTENCY_CONFLICT` (409). A repeated PUT
with the identical declared bytes succeeds. Before a role is received, bytes
that do not match its declaration are `UPLOAD_INTEGRITY` (422); after receipt,
an attempt to replace it with different bytes is `ROLE_CONFLICT` (409). Complete
is idempotent in validating or registered state. Cancel cannot delete a
registered material or a previously saved binding. A failed validation may be
retried only after its worker has physically drained; invalid source remains
available for the owner to choose a new intake, never silently modified. A
cross-workspace operation is forbidden, with no resource bytes disclosed.
Validation may return `MATERIAL_MAP_DESCRIPTOR`, `UPLOAD_INTEGRITY`,
`PNG_PIXEL_LIMIT_EXCEEDED`, `MATERIAL_MAP_DIMENSIONS`,
`MATERIAL_MAP_COLOR_SPACE`, or `FORMAT_REJECTED`, together with the affected role.
Additional storage/rights/ownership error semantics must be fixed alongside
implementation and remain distinguishable from format validation.

The proposed binding is per existing surface UUID and includes the exact
workspace material UUID/version, repeat meters, rotation, and applicable PBR
scalars. A floor and a wall use their own typed surface checks. The server must
resolve the immutable version under the same workspace, recheck display rights,
and save through existing Studio `If-Match`; it must not infer sound changes.
Portable import must allocate destination ownership and remap all typed IDs;
new-format output must not be represented as a legacy format. Capability and
exact runtime inventory are to be agreed with Manager before an execution claim.

### Candidate retry, cancellation and error envelope

For the reviewed client contract, `received` means only that the declared
bytes and digest were received, not that their contents or rights passed
validation. `registered` means all required maps and declared rights passed
the server's validation and the immutable workspace version was committed.

`POST /workspace/material-intakes/:id/retry` is the only retry action for a
failed attempt. It is available only for a server-classified transient failure
after all associated workers physically exit and ownership is rechecked. It
reuses the same declaration and bytes. Deterministic errors such as malformed
PNG, mismatched metadata, missing rights, or a changed input are corrected by
creating a new declaration with a new request UUID; the old input is preserved.
Complete replay while validating returns its current state, and after registration
returns that same version. A cancel during validation reports `cancelling`
until workers actually exit and cleanup is complete, then `cancelled`; the
client must not equate acceptance of cancellation with resource return.

Both non-success HTTP responses and a failed intake status use the same bounded
error object `{code, role?, field?}`. The HTTP status is separate. The optional
role is one of `color`, `normal`, `roughness`, or `ao`, and field is a bounded
contract field identifier, never a filesystem path or secret. The response
contains no raw decoder log. Preview is authenticated inline PNG, redirect-free,
and independently checked by the client against its descriptor; preview
authority does not imply download or export permission.

### Candidate appearance precedence

For review, an active workspace-material binding overrides only the built-in
texture maps for its exact surface. Existing floor preset/binding, authored
sound and legacy experience footsteps remain stored and continue to determine
sound. Existing floor or wall scalar color, roughness and metalness remain the
scalar inputs; this binding does not introduce a second scalar override.
Repeat and rotation belong to the workspace binding. Optional normal scale and
AO strength default to 1 and affect only present corresponding maps. Scalar-only
or sound-only edits leave the active workspace binding unchanged. Explicitly
removing the workspace binding exposes the retained built-in appearance; an
explicit built-in texture choice removes the workspace binding in the same
`If-Match` transaction. A room-base binding is not a workspace material target.

A saved snapshot cannot contain duplicate surface bindings, duplicate material
ID/version descriptors, missing references, unused descriptors, a surface/kind
mismatch, or a descriptor that differs from the authenticated workspace's
registered immutable version. Permission or byte verification failure is
reported rather than silently treated as successful application. Preview and
Viewer must use the same precedence; any visually degraded fallback must remain
observable and cannot be reported as a ready texture. These are design targets,
not current product behavior or a supported OEX format claim.
