# ADR 0016: interoperable plane geometry and explicit template provenance

Status: candidate pending integration qualification

Advanced architectural generators lower curved wall chords, stair treads/risers
and inclined ramps into the existing public rigid rectangle model. Rendering,
collision, persistence and publication therefore consume identical concrete
geometry rather than separate visual-only approximations. Generator parameters
are bounded; subsequent individual plane edits use ordinary reversible commands.
Faceting and local-origin placement are explicit limitations, and a generated
stair does not establish an accessible route.

Optional versioned daylight and template provenance are validated in the
shared dependency-free Studio contract and at protected API/publication/OEX
boundaries. Solar controls supply a visual approximation rather than photometry.
Template licenses are explicit, private licenses cannot cross redistribution
boundaries, and import closes the supported extension vocabulary to avoid
leaking private metadata. Template geometry must contain no artwork/media.
Unsupported upstream consumers still receive normal public planes; the public
spec artifact and legacy fixtures remain unchanged.

No migration, hosted service, paid resource or new package is introduced.
Existing authorization, ETags, immutable publication and backups remain the
underlying data paths. Integration qualification must cover a real PostgreSQL
and production browser, not just generator mathematics or UI controls.
