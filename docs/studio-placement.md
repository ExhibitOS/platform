# Studio artwork placement and presentation

Open `/studio`, create or reopen a local draft and create a room. The placement controls use the same full validated public OES document, command undo/redo, local CAS autosave and optional authenticated remote revisions as the geometry editor. Field edits require explicit apply. Invalid references, transforms, wall alignment or cameras retain the prior candidate and history.

## Approved artwork and physical scale

Confirm the current server account in Studio. Enter the artwork ID of a reviewed, currently approved CMS GLB or PNG and import its metadata. The protected `GET /api/v1/tenants/{tenantId}/studio/artworks/{artworkId}` endpoint returns a full public Artwork snapshot with a deterministic revision UUID and a same-origin qualified-preview URL. It verifies current session, tenant, resource access, approval and display rights before projecting metadata. It excludes private authoring notes, original storage keys and original URLs. Artists use their own artwork; administrators operate within their tenant. Curator access retains the current assigned-exhibition policy and does not grant discovery of arbitrary private artwork.

Select an imported snapshot and room, then add a placement. Physical dimensions are meters; new placements use unit scale and centered bounds resting at half the artwork height above the room floor. Manual room-local position and normalized XYZW rotation (preserving an existing placement scale), surface-local wall offset and a nonnegative snap interval are editable. Wall alignment rotates the placement with the wall, projects its offset into the room once, and rejects placements outside the wall or overlapping openings. It is explicit alignment, not continuous collision prevention. Referenced removals require clearing the remaining references first.

Only qualified, watermarked CMS derivatives are fetched through the server's current authorization gate. The preview calibrates bounded GLB geometry to the approved physical dimensions and displays PNGs on a physical-size plane. Imported public inventory paths are metadata, not browser fetch targets. External GLB resources are rejected. Preview requests send `expectedRevision` and verify `X-ExhibitOS-Artwork-Revision` before rendering; an intervening reapproval rejects stale metadata with409 rather than mixing revisions. Checks occur when fetching/reopening; this does not erase already received bytes remotely. Original downloads and exports remain separate rights. Offline or unauthorized bytes appear as explicitly labeled physical bounds while metadata is preserved; draft JSON backups do not contain artwork bytes.

## Lights, camera and optional tour

Add point or spot lights with room-local position/rotation, finite intensity, RGB color, spot beam angle and optional placement target. Existing directional lights render; existing area lights use a point approximation. This editor is not a physically certified lighting simulation and does not implement shadows, exposure calibration or light baking.

Prepare a viewing camera with viewing distance and eye height, then explicitly apply its position, target and field of view. The camera position must be inside its referenced room; target must differ, and FOV is 10–120 degrees. Named viewpoints, exhibition title and credits are editable. Optional public navigation routes store named accessible waypoint sequences. Applying a route does not disable free camera navigation; preview camera controls remain available. Route metadata is not an implemented guided visitor runtime.

## Presentation extension and compatibility

The optional Platform extension `org.exhibitos.studio/presentation` version1 contains exactly `version`, `viewpoints`, `credits` and optional `startCamera`. Each camera has `roomId`, three-number room-local `position` and `target`, and `fov`. A viewpoint additionally has a distinct UUID `id` and nonempty `name` up to512 UTF-16 code units. At most64 viewpoints,4096 credits UTF-16 code units and32KiB serialized extension are allowed; coordinates must be finite and within10km. Unknown own versions/fields fail closed in both browser and generic server draft writes. Unrelated namespaces remain intact. The public base OES version remains unchanged and other clients may ignore this extension.

No database migration is introduced. Existing documents without presentation metadata use empty credits/viewpoints and no start camera. Session command history remains bounded to20; durable local recovery is separate. The qualified geometry preview adds limits of128 placements and128 lights, alongside [geometry bounds](studio-geometry.md). WebGL failures preserve numeric editing and document backup.

This is an authoring preview qualified with synthetic local Chromium fixtures. Full Viewer/publication, OEX packaging, anonymous display, accessibility tour runtime and general mobile GPU support remain later implementation work.
