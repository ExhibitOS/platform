# ADR 0005: Independent local Studio drafts and explicit remote concurrency

Status: implementation candidate pending full integration review.

Studio's minimum authoring flow must work without account infrastructure or a
network, preserving full public geometry/placements and recovering interrupted
saves. Remote synchronization must never turn a stale local draft into an
implicit overwrite of another completed revision.

Use native IndexedDB v2 with atomic current/history transactions and expected
local versions. Preserve v1 raw records during migration, expose raw rescue and
fail closed for future/corrupt records. Do not delete history automatically.
Native storage avoids introducing a private service dependency; quota/eviction
remains a documented browser constraint requiring explicit file backups.

Bundle the pinned public JSON schemas and adapt only the Apache document-level
validation core for browser use, preserving notices and parity tests. Node file
and hashing APIs do not enter the browser. Use the unmodified pinned validator
on the server. Full draft JSON remains editable; geometry UI, asset-byte
validation, OEX distribution and publication remain separate tasks.

Optional server drafts use tenant/owner-scoped authoring records, immutable
snapshots, strong revision/hash ETags and transactionally checked If-Match.
Artists/curators own their drafts; admins administer their tenant. Exact durable
request receipts recover lost responses. Receipts deliberately return original
response versions; explicit current-state comparison precedes later apply.
Preserve current membership checks even for receipt replays. Use the existing
auth lock/transaction boundaries rather than a separate optimistic client lock.

A production-generated service worker caches only verified public build code
and Studio HTML. It never caches private APIs or drafts and never deletes data
or silently activates a replacement while authoring. Initial online preparation
is required; actual offline Chromium navigation proves shell availability.

Compatibility: migration006 only; prior migration checksums remain unchanged.
Legacy records retain their prior routes; Studio-managed generic writes are
rejected to enforce the dedicated schema/ETag path. Browser local JSON backups
are metadata-only and cannot be represented as complete artwork/OEX backups.
