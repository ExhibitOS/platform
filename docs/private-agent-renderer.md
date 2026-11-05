# Private headless agent renderer

Development-only fixed command: `node scripts/build-private-agent-renderer.mjs`, then
`node scripts/private-agent-renderer.mjs --input /absolute/request.json --output /absolute/new-directory`.
Node24, existing dependencies and Playwright's installed Chromium are required.
The native helper keeps stdin open; EOF, SIGTERM, SIGINT or `{"cancel":true}` aborts this child.
No AppKit, WKWebView, foreground/focus, OS-window capture or shared browser is used.

`bench-proposal` accepts `{version:1,operation:"bench-proposal",frame,request}` and returns
`reply` with the existing exact native bench inspector keys. This is a pure proposal;
the Manager owns pending intent, live session, expected revision/edit version, checkedReply,
apply/save/re-read and export. It does not grant filesystem or authoring authority.

`scene-snapshot` accepts `version,operation,requestId,binding,saved,candidateSha256,staticRoot,indexSha256,oexPath,oexSha256,exportReceiptPath,exportReceiptSha256,snapshot`.
The binding has `workspaceId,tenantId,principalId,expectedRevision,expectedEditVersion`.
`expectedRevision` is native journal CAS; it is separate from Studio `saved.revision`.
`saved` has `exhibitionId,draftId,revision,etag`. The Manager-produced export receipt
contains `binding,saved,candidateSha256,indexSha256,oexSha256` after native save/re-read/export.
The candidate digest is the canonical exported exhibition digest. The snapshot retains
existing `placementId,width:640,height:360` and either `viewpointId` or `inspectionCamera`.
A real admitted artwork placement is required; bench-only emptiness is not asset readiness.

Only the exact content-addressed static files are served on a private ephemeral loopback
origin. External requests are blocked. Source/receipt/OEX/assets are hashed before and
after rendering; changed inputs or cancellation produce no successful PNG result.
The new output directory contains `scene.png` (at most512KiB) and `result.json` with
request/saved/export/camera/actual asset readiness and PNG digest. An existing directory
is never overwritten; native request idempotency remains the issuer's responsibility.

This is a snapshot of an immutable native export. It does not perform authenticated
live Studio/CMS freshness checks. The existing static rights/source checks and snapshot
camera/idle/decoded-asset/abort checks remain active. Headless software rendering does
not establish physical GPU performance or native visual equivalence.

For publication-copy exports, add `exported:{exhibitionId,publicationId,candidateSha256}`
to the request and receipt. Top-level `candidateSha256` and `saved` remain the
source save identity. Receipt `publication` contains the actual existing native
`intent` (NativePublicationPending), `completed` (NativePublicationCompleted) and
`staticExport` (NativeStaticExportReceipt). Source ID/ETag, snapshot ID, publish
request/plan binding, publication ID/hash/status and static receipt/index/output
are compared explicitly. The renderer validates and renders the exported candidate;
the result preserves both identities. It does not infer source/export equivalence.

The source save, native private publication snapshot and public API projection are
three different identities. The retained `sourceDraft` must match the source hash
and existing native copy delta. Private snapshot IDs match intent/completed only.
For this thirteen-artwork output, fixed admitted producer `projectPublication` is
replayed over exact unchanged source/public asset bytes and measured LOD metrics;
all projected non-ID content is exact and the typed identity mapping is injective.
Prose and unknown UUID strings are never rewritten. Ambiguous/unsupported source
assets fail explicitly. This is a narrow replay, not a new publication authority.

The native owner supplies `--publication-runtime ABS --publication-runtime-sha SHA`
from its already-admitted runtime configuration, outside the agent JSON. Fixed API
module suffixes and exact manifest entries are verified; a client cannot select a
script URL or executable. Results record the producer pins and placement/viewpoint
mapping. The live native/CMS authority remains with the issuer.
