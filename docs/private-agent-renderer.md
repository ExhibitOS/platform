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
The fixed admitted producer `projectPublication` is replayed over every source
and public artwork, using exact asset bytes and measured LOD metrics. The counts
must agree, and each artwork must match an unambiguous public asset. The existing
publication-copy replay does not admit media assets or unsupported furnishings.
Generated coarse PNGs require byte-identical producer replay and matching metrics;
all projected non-ID content is exact and the typed identity mapping is injective.
Prose and unknown UUID strings are never rewritten. Ambiguous/unsupported source
assets fail explicitly. This is a narrow replay, not a new publication authority.

The native owner supplies `--publication-runtime ABS --publication-runtime-sha SHA`
from its already-admitted runtime configuration, outside the agent JSON. Fixed API
module suffixes and exact manifest entries are verified; a client cannot select a
script URL or executable. Results record the producer pins and placement/viewpoint
mapping. The live native/CMS authority remains with the issuer.

## Local GLB comparison

Use the fixed command above with this v1 request and keep its owner pipe open.
Each descriptor names an absolute, owner-owned regular file and pins its byte
count and lowercase SHA-256. The roles describe the comparison and allow two
derivatives, such as an approved full model and its compact counterpart.

```json
{
  "version": 1,
  "operation": "raw-asset-comparison",
  "requestId": "f79e41bf-8a8e-41ed-88a0-dc7080cb432f",
  "reference": {"path": "/absolute/full.glb", "mime": "model/gltf-binary", "bytes": 16036864, "sha256": "<64 lowercase hex digits>"},
  "candidate": {"path": "/absolute/compact.glb", "mime": "model/gltf-binary", "bytes": 1874704, "sha256": "<64 lowercase hex digits>"},
  "settings": {
    "width": 640,
    "height": 360,
    "inspectionCamera": {"position": [195, 110, 505], "target": [0, 0, 0], "fov": 42},
    "lightPreset": "neutral-v1"
  }
}
```

Use GLBs admitted by the strict ordinary validator and the embedded PNG render
path. Per input, the encoded file is capped at 32 MiB, the model at 100,000
triangles, and texture edges at 2,048 pixels. Decoded estimates must fit the
comparison's 320 MiB resident and 416 MiB transition ceilings. Both models use
the same model-space camera and light at identity transform. The renderer
closes the first model's browser context before starting the second.

The local command creates no workspace, profile, or CMS record. Wait for
`result.json` before consuming `reference.png` and `candidate.png`. The result
records exact input and PNG digests and estimated memory. The exclusive output
directory is cleaned up on pre-commit failure. To cancel, send
`{"cancel":true}` through the owner pipe or use the existing signal controls.

## Internal verification with a live Viewer

Use the approved local static publication export and its manifest SHA-256. With
the development dependencies and workspace build prepared, run the loopback
Viewer entry. It bundles the Viewer before opening the local URL.

```sh
node scripts/dev-live-viewer.mjs /absolute/static-export MANIFEST_SHA256
```

After the ordinary 3D entrance, explicitly select the quality to verify. Run
the following call against the live canvas in the browser console or WebDriver.
The eye and look-at are room-local meter coordinates. The look-at can point
past a doorway. An omitted FOV keeps the current vertical field of view.

```js
const canvas = document.querySelector(
  '.publication-live-stage[data-stage-ready="true"] canvas[data-navigation-state]',
);
const inspection = canvas.exhibitosInspectPose({
  roomId: '66df16b1-18d7-425d-801a-8749ddb33a27',
  eye: [-0.0932, 1.661, -1.5077],
  lookAt: [0, 0.95, 2.6],
  fov: 45,
});
inspection.observation;
```

`inspection.read()` returns the current applied pose, effective quality,
workspace floor state and admitted and drawn placements as loading settles.
Take the comparison only after the relevant artwork and floor maps are ready.
A rejected pose reports its reason and leaves the current view in place.
`inspection.exit()` restores ordinary controls and the previous camera.
Exit before changing profiles, then repeat the same call. This development
entry serves the pinned export on loopback and changes only the live view.
