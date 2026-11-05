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
