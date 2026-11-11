# Native saved-head fixture proposals

The installed local owner session advertises
`nativeFixtureAuthoringProposalProfile: saved-head-fixture-v1` only under the
existing live scene-authoring authority. This is separate from the existing
`saved-head-scene-v1` operations.

Use the existing `POST /api/v1/tenants/:tenantId/studio/exhibitions/:id/native-authoring-proposal`
with `If-Match` and the closed body `{expectedRevision, request}`. The request
contains the existing `{version:1, epoch, sequence, tenantId, principalId, requestId}`
binding plus exactly one command:

- `set-furnishing-visual`: `hostKind: light`, existing spot `hostId`,
  `catalogId: museum-track-spot`, `catalogVersion:1`, and `pose:{position,yaw,scale}`.
  The reply contains the six binding fields and the complete `candidate` only.
- `set-light-attachment`: existing `lightId` and
  `attachment:{surfaceId,anchor:[x,y],gap}`. This Native slice accepts an explicitly
  selected same-room ceiling only. Gap is 0.01–1 metre along surface +Z. The reply
  contains the binding, canonical existing `lightId`, and complete `candidate`.

The existing shared setters remain authoritative for optical alignment, surface
pose, room fit, attachment and catalogue validation. Both source and result
must pass furnishing and attachment validation, in addition to the ordinary
complete lifecycle checks. No wall, removal, arbitrary catalogue, passive rail,
caller-provided asset ID or caller-provided draft gains admission.

A fixture does not move its light. Its relative pose follows the light's stored
transform and existing aim settings. Attaching a light first and then selecting
its fixture is recommended. The reverse order also succeeds when the entire
result, including opaque fixture bounds, is valid. Invalid results are rejected
atomically; the producer never clamps, detaches or partially applies them.

Proposals do not write the draft or save. Native applies a checked proposal to
its local draft; an explicit Save is required before preparing another command
against the next saved head. A stale revision or ETag returns `REMOTE_CONFLICT`.
An exact existing binding returns the unchanged candidate, preserving binding
order and template flags. Identical request binding and saved head produce an
identical candidate. Existing catalogue asset IDs are reused; only a missing
catalogue asset receives a server-derived, scoped deterministic UUID. This ID
is an internal shared-setter option, not an external request field. Collision
validation remains in the existing setter and never falls back to another ID.

These source contracts do not establish installed-runtime, GUI, physical fit,
asset-rights or public-deployment acceptance for a new operation.
