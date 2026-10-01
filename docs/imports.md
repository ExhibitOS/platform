# Authenticated primary-asset imports

Implementation candidate; actual acceptance results are recorded before merge. This API adds one primary GLB or PNG asset to an existing artwork. It does not import an entire OES directory, OEX archive, JPEG/WebP, remote URL, or Capture dataset. Full artwork dimensions/provenance editing and publication remain later work. It accepts the public OES rights record and a positive physical `scaleMeters` value. Read [authentication](auth.md), [storage recovery](storage.md), and [OpenAPI](../contracts/import-openapi.json).

## Flow and authorization

An admin of the same tenant or the artwork's owning artist may create/read/upload/complete/cancel/retry its imports. Curator/viewer membership does not grant these operations. Every write needs the tenant-bound session cookie, exact Origin/Host and CSRF token from the auth session. A session or membership change is rechecked on requests, and the worker rechecks the submitter's current artwork ownership before approval. User input never selects an object path.

1. `POST /api/v1/tenants/:tenantId/imports`: send `artworkId`, `idempotencyKey` (1–128 characters), `mime`, lower-case `sha256`, expected `bytes` (1–32 MiB), `scaleMeters` (positive, at most 1,000,000), and full `rights`. Same tenant/key/canonical payload returns the same job; changed payload conflicts.
2. `PUT .../imports/:id/bytes`: send the complete object with exact `Content-Type: application/octet-stream`. Length/hash must match the declared values. Interrupted, missing or mismatched bytes never complete a job. Successful identical replay while uploading is safe.
3. `POST .../imports/:id/complete`: verify uploaded bytes and queue validation. Repeating completion for queued/processing/approved returns current state.
4. Poll `GET .../imports/:id`. State is `uploading → queued → processing → approved`, or `failed/cancelled`. Progress is a state milestone, not measured transfer percentage. An approved job returns its asset ID.
5. Failed jobs expose `retryAt` and require explicit retry after the recorded exponential delay; at most five attempts. Cancel fences a queued/processing worker with its lease identity. Approved jobs cannot be cancelled through this endpoint.

The worker is one-shot: after `npm run build`, supply private `DATABASE_URL` and `BLOB_ROOT` environment values and run `npm run import:work`. Repeat under a supervised local scheduler when desired; this task does not provision a production service. Never pass credentials in arguments or commit local data. The worker claims durable PostgreSQL jobs with a 30-second lease, runs a bounded decoder, then commits asset/rights/job together. Expired leases may be reclaimed; stale or cancelled workers cannot commit approval. No source or user bytes are automatically deleted.

## Qualified formats and limits

The platform limit is 32 MiB per object, narrower than the general public spec limit. GLB must be version 2 and self-contained; this first profile rejects extensions, textures, images, and all URI resources. Khronos validation runs in an isolated subprocess. PNG must be non-interlaced, 8-bit RGB/RGBA, at most 4,194,304 pixels with dimensions no larger than 8,192, and at most 256 chunks. The conservative profile rejects ancillary metadata. CRC, complete chunk structure, compressed-stream length, bounded expansion and every scanline filter are validated; signature alone is insufficient.

The decoder has a five-second timeout, 128 MiB JavaScript heap limit and bounded output. Input/pixel/expanded-byte limits also bound native buffers; the heap flag alone is not a total OS memory sandbox. Failure terminates decoding and leaves quarantine unapproved. MIME spoof, truncated files, remote URI, malformed GLB/PNG and unsupported formats fail with safe errors; no external URL is fetched.

`approved` means this narrow import profile passed, not that rights permit publication or every renderer/browser/device is supported. A private original download still checks independent `permissions.download`, current rights validity, tenant/ownership and hash/size. There is no anonymous or public import-bytes route. OEX/package generation, watermarked derivatives and publishing are not provided.

## Recovery and retention

Quarantine and approved copies use immutable keys. Durable job references protect in-flight bytes from orphan reconciliation. A copy that succeeds before a database failure remains recoverable; retry cannot create a duplicate asset. Cancellation invalidates the lease but retains bytes. Trash, jobs and staging are not automatically purged; retention and actual data deletion need a separately verified recovery policy. Git backups exclude job rows, object bytes and credentials. Follow the consistent database/object backup procedure before introducing persistent artwork data.
