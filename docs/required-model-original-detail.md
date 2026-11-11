# Ordinary prepared-model original detail

A finished required-model upload retains its original in custody while CMS
approves the prepared display. Original custody is not public output authority.
The native owner can explicitly approve the retained original for a current
exhibition without reimporting it or changing the saved draft.

The live session advertises `nativeRequiredModelOriginalProfile:
required-model-custody-v1` only with local bounded editing, a live matching
workspace/database/blob root and required-model execution. The approval and
readback repeat those checks and use the existing native origin, session, CSRF,
authorization and maintenance transaction. Existing adoption approvals remain
separate.

`GET /api/v1/tenants/:tenantId/studio/artworks/:id/native-model-candidate`
with `artworkRevision` resolves the current approved CMS selection. Its existing
job view optionally includes `requiredModelCustody` when the original has the
stricter unexpired download rights and a distinct retained source. Existing
display/export candidate discovery stays available without that projection:

```text
{version:1, kind:"required-model-custody-v1", workspaceId, tenantId,
 principalId, artworkId, artworkRevision, artworkRevisionId, importJobId,
 serverReceiptSha256, original:{assetId,mime,sha256,bytes},
 display:{assetId,mime,sha256,bytes,reusedOriginal}, rightsSha256}
```

The producer reuses `Imports.access` to verify the immutable preparation receipt,
original/display rows, rights, source keys and derivative lineage. It supports
both the original approved revision and the existing provisional display-reference
source revision followed by its explicitly approved next revision. An upload
transfer may already be finished; a caller supplies no local transfer intent.

`POST .../studio/exhibitions/:id/native-original-static-approval` accepts the
closed body `{kind:"required-model-custody-v1", artworkId, artworkRevision,
importJobId, serverReceiptSha256}` and the current exhibition `If-Match`.
The exact CMS artwork must be in the owned saved exhibition. The server verifies
both original and display bytes, current unexpired download/display/export rights,
and the existing bounded embedded-GLB structural report. A separate durable
approval binds that custody to this exhibition and artwork revision. It does not
promote the quarantined original, change placement scale or claim calibrated
physical units.

The result is `{version:1, approved:true, exhibitionId, revision, etag,
custody, approvalSha256}`. The digest identifies the stored approval, including
the structural feature report. Identical approval on the same current head
returns the same digest; a stale head returns `412 REMOTE_CONFLICT`.

`GET .../studio/exhibitions/:id/native-required-model-original` takes
`artworkId`, `artworkRevision`, `importJobId` and `serverReceiptSha256` as query
parameters. It requires the same native session/origin/CSRF authority and returns
the same identity and current head, with `approved:false` and
`approvalSha256:null` before explicit approval. Its response ETag is the current
saved ETag. An ineligible or changed custody returns
`409 REQUIRED_MODEL_ORIGINAL_UNAVAILABLE`; denied or expiring rights return
`403 ORIGINAL_STATIC_RIGHTS_DENIED`. Existing malformed input/auth errors apply.

Original-inclusive publication adds a detail candidate only for an explicit
approval of the current artwork revision. Prepare, persist, replay and export
reconstruction revalidate the owned source, rights, receipt and exact bytes.
Publication bindings use a distinct ordinary-model kind. A candidate with zero
or multiple binding authorities is refused; adoption is never inferred from a
shared inspector identifier. The existing detail contract and Viewer resource
admission still decide whether an acquired original can be displayed.

Source tests and synthetic PostgreSQL checks establish their tested boundaries.
Actual installed native selection, restart, export and Viewer consumption require
their own final runtime and consumer evidence.
