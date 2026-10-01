# ADR 0006: reversible OES geometry commands and namespaced surface materials

Status: implementation candidate, pending independent review

The existing full public OES draft remains the persisted source of truth. Geometry commands clone it, validate the complete candidate, then publish one reversible state transition. Invalid commands do not modify the caller or consume undo history. Recent history is bounded to 20 snapshots; durable recovery remains the existing IndexedDB history mechanism. Referenced removals fail instead of silently cascading artwork or navigation changes.

Public surfaces are room-local rigid rectangles and openings are wall-local rectangles. We implement this profile and a six-plane white-cube factory. Unsupported curved walls and staircases are not synthesized. Rendering applies each room and surface transform once and cuts bounded rectangular wall panels around openings.

The base public schema has no material fields. An optional `org.exhibitos.studio/materials` version-1 extension adds bounded surface-ID assignments of color, roughness and metalness. Its contract and default values are specified in [Studio geometry](../studio-geometry.md). A neutral, dependency-free workspace package supplies the same extra validation to browser draft validation and API validation. It imports no private repositories or Node-only storage implementation. Unknown own versions fail closed; other extension namespaces retain their original values.

No database migration is needed: existing immutable Studio revisions already store complete validated drafts. Existing remote ownership, strong ETags, receipts, local CAS and offline public-shell rules continue to apply. Other OES consumers may ignore the extension and use their own default surface appearance.
