# ADR 0007: approved artwork snapshots and reversible presentation

Status: accepted after independent source review and actual clean-clone validation

Studio edits the full public OES candidate through the existing geometry command history. Physical artwork snapshots, placements, lights and public routes use their existing public fields. Wall alignment transforms once from wall to room coordinates, rejects outside-wall and opening overlap, and remains an explicit authoring action. It does not imply a collision-aware visitor runtime.

CMS supplies immutable approved metadata through a protected authoring bridge. Current tenant, resource and display rights are checked before projection. The public snapshot has a stable revision ID and relative inventory paths, excluding private notes/storage keys. Preview loads only bounded qualified CMS derivatives through current authorization, rather than arbitrary inventory URLs or originals. Revision preconditions bind bytes to the approved metadata after the intervening-request race was identified during independent review. Offline preserves metadata and labeled dimensions; it does not cache protected artwork bytes.

The public draft lacks start-camera/viewpoint/credits fields, so Platform uses the optional bounded version1 `org.exhibitos.studio/presentation` extension with shared server/browser validation. Other namespaces remain untouched and other clients may ignore it. Routes remain optional navigation metadata, and free preview controls are available. See [wire contract and limits](../studio-placement.md).

No migration, private dependency or new browser dependency is required. Original file download and export retain their separate rights gates. Browser qualification, current approval changes and unsupported rendering are explicit limits; authoring preview is not publication or Viewer completion.
