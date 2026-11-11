# Saved-head scene proposals

The native operator uses the existing authenticated
`POST /api/v1/tenants/:tenantId/studio/exhibitions/:id/native-authoring-proposal`
for a reviewable candidate from the current saved exhibition. Preview does not
save or create a server object. Local apply and ordinary exhibition save remain
separate operations.

The session advertises `nativeSceneAuthoringProposalProfile: saved-head-scene-v1`
only with local authentication, bounded editing, a live runtime and the matching
workspace tenant/principal with a verified database. The scene POST repeats that
readiness check. Both the existing native mutation authority and Studio owner
check apply; `If-Match` and `expectedRevision` must identify the saved head.
The native host must additionally verify its installed runtime/pair and current
session. A marker is capability discovery, not a substitute for authorization.
Existing plaque/wall proposals retain `nativeAuthoringProposalProfile: saved-head-v1`.

The body is `{expectedRevision, request}`. Every request carries exactly the
existing binding fields `version: 1`, `epoch`, `sequence`, `tenantId`,
`principalId`, and `requestId`, plus one command:

- `set-pedestal`: `placementId` and the existing closed installation `pedestal`
  representation. The placement, artwork transform, frame, rights and other
  installation bindings are preserved.
- `add-light`: a complete existing OES `light`, including a caller-selected stable
  `id`, and optional `settings` using the existing light-details representation
  without `lightId`. Settings apply atomically with the light. An existing light
  ID is rejected; the server does not mint an ID on preview or retry.
- `set-light-details`: `lightId`, `light` without `id`, and `settings` without
  `lightId`. The existing shared light-details function enforces reference,
  room, shadow, scale, unit, fixture, aim, temperature, range and penumbra rules.

The full saved base and resulting draft are validated. The response echoes the
binding plus `placementId` or `lightId` and `candidate`; its ETag is the unchanged
saved ETag. Repeating an identical preview on that head produces the same
candidate without writes. After apply/save, the native operator reconciles the
existing durable save request rather than creating a new light or replaying
against an unverified head. Source/model assets and approval are not changed by
these commands.

Model thumbnail rendering remains the existing product transient renderer and
[rendered thumbnail selection API](rendered-artwork-thumbnail.md). Preparing or
reviewing a candidate does not select it. The native host/CLI owns renderer
lifecycle, candidate persistence, explicit selection and restart recovery;
this scene endpoint adds no thumbnail or validation-capture mechanism.

Source and route tests do not establish packaged CLI, restart, export or actual
Viewer qualification. Those require the final admitted native/runtime pair and
its consuming operator evidence.
