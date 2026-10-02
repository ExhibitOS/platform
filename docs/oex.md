# Portable exhibition files

Implementation candidate; actual round-trip and failure qualification is pending.

In Studio, save the current input locally and to your account's server, then select
**OEX 내보내기**. The server binds the saved immutable revision to its ETag and
checks current ownership, approval and explicit export grants for every included
artwork and audio object. Display permission alone does not allow export. Local
JSON backups contain metadata; OEX includes declared artwork and audio bytes.

Sign in through Artist CMS with an artist or admin account. In Studio, choose an
`.oex` file, select **파일 전달·가져오기 시작**, then refresh the job status. After
completion, **가져온 전시 열기** creates a separate local copy linked to the new
server draft. Unsaved local input blocks opening another exhibition. Existing
exhibitions and publications remain intact; importing never publishes. Review
the new draft and use the separate READY/publication flow when display grants
permit it. Export-only preservation grants remain private.

If upload response observation fails, retry the same selected file: the request
identity is retained for that attempt. Job status survives page reload and is
available through **가져오기 상태 새로고침**. Failed processing can be retried up
to five worker attempts. Cancellation disposes only this job's temporary bytes.
Completed receipts remain available and completed artwork/audio objects are
retained. The browser does not cancel a durable server job just by leaving the page.

## Format and supported profile

Public `@exhibitos/spec` package0.1.0-draft.2 supports original OEX1.0.0-draft.1
and the distinct media-bearing OEX1.0.0-draft.2. OES/OED draft identities remain
unchanged. The server writes draft.2; reading an old file does not silently migrate
its source manifest. There is no stable-format or general ZIP compatibility claim.

Platform accepts approved GLB and PNG, and bounded PCM16 WAV (one/two channels,
8–48kHz, up to60seconds). Unsupported codecs, unknown executable/opaque extension
namespaces, external resource fetching and arbitrary package layouts fail closed.
Known material, placement/presentation, LOD, artwork detail and audio/transcript
extensions are checked and their typed references remapped. UUID-looking prose
is preserved. Source archive hash and typed ID map are retained in the receipt;
derived destination revision IDs/hashes differ from the source.

New IDs avoid replacing destination data even when a source ID already exists.
Original asset byte hashes and scene geometry/units/rights remain the comparison
basis. Missing image depth stays unrecorded; the catalogue does not invent a
physical thickness. Synthetic provenance remains identified as synthetic. No
access token, environment/config file, raw Capture dataset or private CMS identity
binding is a declared package member. The closed layout cannot detect every secret
or private datum embedded in arbitrary user prose or artwork bytes: review content
before granting export rights or distributing an archive.

## Limits and recovery

Archive/upload and Platform decoded total are bounded64MiB. The public reader
also enforces256files,100MiB per expanded file,256MiB expanded total and100:1
compression ratio; the tighter Platform total applies to service imports.
Artwork objects remain at most32MiB and audio12MiB. A tenant has at most16 retained
active/failed staging jobs and512MiB staging exposure; cancel unwanted jobs to
release temporary storage. HTTP input buffering and worker output are bounded.
Parsing runs in a child process with30second timeout and512MiB V8 old-space
ceiling; this is not an OS-level resident-memory guarantee. Individual artwork
decoding uses the existing isolated validator.

Migration009 adds durable jobs, leases and cleanup inventories. Before destination
writes, the worker commits the exclusively owned cleanup keys. Verified objects,
CMS snapshots/approval records, audio records and the new private Studio draft
commit together. A failed transaction leaves no partial published exhibition.
An interrupted worker can resume after lease expiry; cleanup errors retain a
receipt for another cleanup attempt. Failed source staging remains available for
retry until explicit cancellation; completed/cancelled staging is disposed.

Run migrations explicitly using the documented storage command before enabling
the configured API with `BLOB_ROOT`. The API starts its local worker when object
storage is configured and fails startup if migration009 is absent. Shutdown waits
for the active iteration. Tests may keep the worker disabled and drive the same
`run`/`runNext` methods explicitly. No hosted scheduler or paid service is created.

OEX is a portable exhibition artifact, not a full administrative DB, credentials,
service configuration or browser IndexedDB backup. Git bundles exclude the new
job rows, staging and imported object bytes. Persistent real use needs consistent
DB/blob backup and a verified restoration point before destructive maintenance.
Freeze records, standalone offline runtime and administrative backup automation
are separate features. This initial server flow requires a network connection;
it does not cache protected artwork bytes for offline browser export.

Contract: [OEX OpenAPI](../contracts/oex-openapi.json).
Actual qualification command: `npm run test:oex` after the documented exact
Node/npm installation, with Docker and Playwright available. Passing format or
unit checks alone does not prove atomic restoration, current rights or UI behavior.
