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

## Workspace material intake

The intake API is implemented behind an explicitly supplied personal-workspace
owner and file store. It is disabled by default. The v5 validation candidate
exposes it on ordinary native reopen only after the exact capability and
031/032 ledger checks; production runtime admission and Manager's product
allowlist are not yet established. Check `GET /api/v1/auth/session` for
`workspaceMaterialProfile: "workspace-material-intake-v1"` before using it.
Built-in packs keep their existing identities. This slice accepts floor and wall
PNG maps; direct furnishing GLB intake is not implemented.

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

The available API flow is create → upload declared role bytes → complete and
inspect validation → list/read the workspace material and preview. A validated
workspace-material snapshot can be saved through Studio with `If-Match`; the
interactive surface preview/apply workflow remains under development. Failed
or cancelled intake must leave earlier resources and the saved exhibition unchanged. Retrying the same
idempotency key and content returns the same operation; using it for different
content is a conflict. Another workspace cannot read or complete its owner’s
material, and the snapshot guard rejects another workspace’s version. An
appearance binding does not alter the separately stored floor sound.

For a color source PNG with one C2PA manifest immediately after its image
header, prepare the upload from a built Platform checkout:

```sh
npm run pretypecheck
node scripts/prepare-workspace-color-map.mjs original.png ORIGINAL_SHA256 color.png > preparation.json
```

Keep the unchanged original and the preparation receipt together. The command
removes the bounded manifest chunk, preserves all remaining PNG bytes, and
validates the result against the ordinary color-map profile. Use the receipt's
`color` descriptor and the new PNG for normal authenticated intake. Record the
source and preparation receipt in the material provenance. The command does
not verify C2PA assertions or grant any usage rights.

The shared Spec defines a distinct OEX draft.12 profile for portable material
bytes and bindings. The private bounded OEX candidate handles floor and wall
color-only materials; other map roles remain unsupported for OEX output.
Selected draft.12 import uses V6 for floor color-only bindings. The opt-in
V7 candidate adds wall and mixed color-only bindings after an exact 035 catalog
and owner acknowledgement; V6 rejects 035 and cannot select wall imports. Existing
profiles are not automatically upgraded. Joint Manager/runtime qualification,
including live settlement and reopen, is still required. Workspace-material static publication and public Viewer output
remain unsupported. The existing formats are not reinterpreted.

The API routes are under `/api/v1/tenants/:tenantId`:

- `POST /workspace/material-intakes` declares request ID, kind, name, rights,
  provenance, and role descriptors; the server issues the material identity.
- `PUT /workspace/material-intakes/:id/maps/:role` supplies exact bytes;
  `GET /workspace/material-intakes/:id` reads progress; `POST .../complete`
  validates and registers; `POST .../cancel` cancels the owned attempt and
  `POST .../retry` retries a server-classified transient failure.
- `GET /workspace/materials`, `GET /workspace/materials/:id/versions/:version`,
  and `GET .../maps/:role` list, inspect, and preview approved owned versions.

For example, a color-only `declaration.json` has this shape. Replace the
example digest, byte count, dimensions, rights and request ID with the actual
source and the owner's declaration:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "kind": "floor",
  "name": "Example floor",
  "rights": {
    "holder": "Example owner",
    "ownership": "owner",
    "licenseId": "CC0-1.0",
    "creditLine": "Example credit",
    "permissions": {"display": true, "download": true, "export": true, "commercial": true}
  },
  "provenance": "Owner-provided example",
  "maps": {
    "color": {"mime": "image/png", "bytes": 1234,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "width": 256, "height": 256, "colorSpace": "srgb"}
  }
}
```

With an authenticated local session cookie in `$COOKIE` and its CSRF token in
`$CSRF`, create and upload the declared bytes:

```sh
curl -H "Cookie: $COOKIE" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' --data-binary @declaration.json \
  "$ORIGIN/api/v1/tenants/$TENANT/workspace/material-intakes"
curl -X PUT -H "Cookie: $COOKIE" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/octet-stream' --data-binary @color.png \
  "$ORIGIN/api/v1/tenants/$TENANT/workspace/material-intakes/$INTAKE/maps/color"
curl -H "Cookie: $COOKIE" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' --data '{}' \
  "$ORIGIN/api/v1/tenants/$TENANT/workspace/material-intakes/$INTAKE/complete"
```

Poll `GET .../material-intakes/$INTAKE` until `registered` or `failed`;
completion is asynchronous. Use the returned material ID/version with
`GET .../workspace/materials/$MATERIAL/versions/$VERSION/maps/color` for an
authenticated preview. Paths supplied to `curl` are client-side inputs, not
server authority.

### Request and response details

All routes require the authenticated personal workspace owner under the tenant
prefix. These details describe the validation candidate, not product admission.
Create takes a UUID `requestId`, `kind`, `name`, `rights`, `provenance`, and a
role-keyed `maps` object. A map has `mime`, `bytes`, `sha256`, `width`, `height`,
and `colorSpace`; normal also has `normalY: "up"`. Each PNG is at most 8 MiB,
at most 4,194,304 pixels, and 8-bit noninterlaced RGB or RGBA. The untagged
color map is interpreted as sRGB only when explicitly declared; data maps are
linear and must not have an sRGB chunk. Other roles, including height, and
URLs/paths in the descriptor are rejected; retain excluded source maps separately.
Repeat and rotation belong to each surface binding, not the immutable resource.

An intake response carries `intakeId`, `requestId`, `kind`, a
phase (`uploading`, `validating`, `cancelling`, `registered`, `failed`, or `cancelled`), a
role-keyed received map with verified byte count and hash, `retryable`, and
`error` (`code`, optional `role` and `field`) or the completed descriptor in
`material`. Every operation remains readable by the same workspace owner.
`GET /workspace/materials` is a cursor-paginated list with at most
50 bounded summaries per page (`id`, `version`, `kind`, `name`, and current
rights availability), plus `nextCursor`. Full rights, provenance, and map
descriptors are returned by the single-version read and registered intake's
`material`, not by the list summaries. Preview responses
return PNG bytes, MIME, byte count and SHA-256 with no redirect, and require a
current display grant. Future archive export and original download must separately
check the corresponding grant; those material operations are not yet implemented.

The same request UUID and identical normalized declaration returns the existing
intake; a different declaration is `IDEMPOTENCY_CONFLICT` (409). While uploading,
a repeated PUT with the identical declared bytes succeeds. Before a role is received, bytes
that do not match its declaration are `UPLOAD_INTEGRITY` (422); after receipt,
an attempt to replace it with different bytes is `ROLE_CONFLICT` (409). PUT after
the uploading phase returns `JOB_STATE` (409). Complete
is idempotent in validating or registered state. Cancel cannot delete a
registered material or a previously saved binding. A failed validation may be
retried only after its worker has physically drained; invalid source remains
available for the owner to choose a new intake, never silently modified. A
cross-workspace operation is forbidden, with no resource bytes disclosed.
Validation may return `MATERIAL_MAP_DESCRIPTOR`, `UPLOAD_INTEGRITY`,
`PNG_PIXEL_LIMIT_EXCEEDED`, `MATERIAL_MAP_DIMENSIONS`,
`MATERIAL_MAP_COLOR_SPACE`, or `FORMAT_REJECTED`; an intake status error can
include the affected role.
Additional storage/rights/ownership error semantics must be fixed alongside
implementation and remain distinguishable from format validation.

The snapshot binding is per existing surface UUID and includes the exact
workspace material UUID/version, repeat meters, rotation, and optional normal
scale and AO strength. Floor and wall bindings require matching
typed surfaces. On save the server resolves the immutable version under the
same workspace, rechecks display rights, and uses Studio `If-Match`. The binding
does not itself modify sound.
Portable import must allocate destination ownership and remap all typed IDs;
new-format output must not be represented as a legacy format. Capability and
exact runtime inventory are to be agreed with Manager before an execution claim.

### Candidate retry, cancellation and error envelope

For the reviewed client contract, `received` means only that the declared
bytes and digest were received, not that their contents or rights passed
validation. `registered` means all declared maps passed byte/PNG validation, the rights
declaration passed schema validation, and the immutable version was committed.
Display permission is separately checked on preview and save; future export must
check export permission.

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

Non-success HTTP responses use the existing API envelope `{code, message,
fieldErrors, requestId}`.
A failed intake status carries `{code, role?, field?}` in its `error` field.
The HTTP status is separate and the stable `code` has the same meaning in both. The optional
role is one of `color`, `normal`, `roughness`, or `ao`, and field is a bounded
contract field identifier, never a filesystem path or secret. The response
contains no raw decoder log. Preview is authenticated inline PNG, redirect-free,
and independently checked by the client against its descriptor; preview
authority does not imply download or export permission.

### Intended appearance precedence

The following rendering behavior remains to be implemented and verified. An active workspace-material binding overrides only the built-in
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

Explicitly choosing the already-stored built-in texture remains an edit when a
workspace texture is active: it removes that workspace binding in the same CAS.
A client must compare the complete proposed draft, not infer no change solely
from the unchanged legacy floor fields. Portable output must retain any built-in
resource required for the reversible fallback. Preview readiness must identify
the requested frame, surface ID and immutable material ID/version and report map load failure;
a matching geometry frame alone is not proof that the requested map was shown.

In the candidate intake status response the descriptor key is `material`.
It is omitted until registration and contains the full immutable descriptor
when registered. `error` is null when no failure is recorded, `received` starts
as an empty object, and `retryable` is always boolean. A qualified runtime must
construct the intake service with the identical bound native owner context and
file store used by the API. Preview bytes and their response headers may be sent
only after the authenticated database transaction has successfully committed.

### Bounded architectural wall depth

The existing architectural-finishes version 1 namespace supports up to 20 unique existing wall faces. The 8 KiB metadata, 8 openings per styled wall and 256 generated boxes / 3072 triangles budgets remain unchanged. Explicit wall depth remains centred on the authored wall plane; unstyled surfaces keep their existing representation. Artwork obstruction and registered furnishing checks remain mandatory. A wall-normal mounting change must use a supported placement operation and fresh saved-head validation; a coupled light may need its own supported pose/aim update so its admitted mounting profile remains valid.

### Saved-head frame image contact

A live eligible Native owner advertises `nativeFrameImageFitProposalProfile: "saved-head-frame-image-fit-v1"`. The existing `native-authoring-proposal` route accepts `type: "reconcile-frame-image-fit"` and one `placementId`, with its unchanged version/epoch/sequence/tenant/principal/request binding, expected revision and If-Match. It reads that existing attachment, verifies the immutable registered descriptor/model and currently approved primary PNG, then derives canonical pixel extents with existing bounded PNG decoding. No caller-supplied pixel/aspect values are accepted by this proposal.

The reply has the same six binding fields plus `candidate` and `placementId`; the response ETag is the saved source head. Only the selected attachment gains `imageFit` and namespace7/9 becomes10. Source descriptors, artwork dimensions/pixels, other rows/transforms, light and wall state are retained. An already identical issued record returns an identical candidate for the Native no-op path; stale or conflicting issued records are refused. Ordinary save/preflight rechecks the actual approved primary metadata; publication creation uses the same snapshot guard and public projection retains the source-SHA/pixel record while remapping its inherited IDs. Removing an issued record from the same otherwise unchanged attachment is not an ordinary frame delta.

Spec33 workspace10/OEX draft22 preserves older v9 behavior and emits the new envelope only for explicitly upgraded state. The policy's exact canonical contain footprint drives both gallery image and frame aperture; no positive3mm gap, crop, mat, backing, physical metadata scale or Z change is introduced. The existing ETag/owner/rights/registry/request replay and output guards remain in force.
