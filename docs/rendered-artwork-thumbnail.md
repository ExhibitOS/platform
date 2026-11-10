# Reviewed rendered artwork thumbnails

The native catalog can prepare one 256 × 256 default-view PNG with the existing
Three.js thumbnail renderer, show that candidate for explicit review, and select
those same bytes through the CMS thumbnail-selection route. This is an
**authorized representative image**, not cryptographic proof that its pixels
depict the approved model. Existing approved-asset thumbnail selection remains
available through its original eight-field contract.

The session advertises `nativeRenderedArtworkThumbnailProfile` with value
`rendered-display-preview-v1` only for the live local workspace owner, bounded
editing, matching durable FileBlobStore and runtime availability. The web viewport
adds that capability only to an enabled, editable, non-plan frame. Loss of the
session profile invalidates in-flight catalog authentication. The POST repeats
workspace readiness before and after the operation, under the existing CSRF,
origin, owner, maintenance and read-committed mutation authority.

The renderer resolves the current approved primary from CMS metadata, hashes the
actual preview response separately, and rechecks source metadata after encoding.
Its reply adds `sourceAssetId`, `sourceSha256`, `displaySha256`, `pngSha256`,
`recipeId: artwork-glb-card-256-v1`,
`toolId: exhibitos-three-0.186.1-thumbnail-v1` and `modelBytes` to the existing
bound catalog reply. The approved primary is distinct from an optional acquired
original, and the preview derivative may have a different hash. Existing model,
texture, memory, queue and disposal limits remain in force.

`POST /api/v1/tenants/:tenantId/cms/artworks/:id/thumbnail-selection` accepts exactly
these ten fields for this profile:

- `kind`, `requestId`, `expectedRevision`, `expectedSelectionVersion`
- `sourceAssetId`, `sourceSha256`, `displaySha256`
- `pngSha256`, `pngBase64`, `view: {kind: "default"}`

The server checks current approval, source rights and source hash, recomputes the
existing CMS preview derivative, and validates the PNG hash, canonical base64,
512 KiB maximum and exact dimensions with the isolated PNG decoder. It writes an
immutable durable blob, verifies its stored bytes, registers an approved PNG with
the source rights, and reuses the existing revision-scoped selection/CAS and
immutable binding/audit logic. The recipe records source, preview and output
hashes and byte lengths. Artwork revision, model approval and primary assets do
not change.

Success and identical replay return `id`, `thumbnailAssetId`, `thumbnailSha256`,
`selectionVersion`, `selected`. A replay reuses its original asset and binding;
`selected` reports whether that binding is still current. Changed claims under
the same request conflict; stale revision, approval, rights or selection fail
closed. An uncertain rollback can leave private immutable blob bytes, which an
identical retry reuses rather than deleting or replacing them.

Unit tests cover envelope/decoder bounds, primary versus preview binding,
post-encoding revalidation and disposal, session readiness, route authorization,
CAS conflicts, identical and changed replay, revoked rights, corrupt stored bytes
and retry after a failed asset insertion. Native compilation and contract tests,
actual packaged runtime admission, explicit candidate review, persisted selection
and export/reopen are separate consumer qualification stages.
