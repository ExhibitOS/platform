# Architectural wall finishes

`org.exhibitos.studio/architectural-finishes` is optional and closed:
`{version:1,walls:[{surfaceId,depth,preset,trimWidth,baseboardHeight,ceilingBand}]}`.
It admits at most eight existing walls, 8 KiB, eight openings per styled wall
and 256 generated boxes (3072 triangles) overall. UUID references are insensitive
to letter case. Depth is .02–.2m, trim width .02–.08m, baseboard height .04–.15m.
Presets are `plain`, `painted-edge` and `dark-edge`; ceiling band is Boolean.
There are no asset, shader, font, arbitrary material or modeler fields.

Existing wall XY, room, surface transform, opening and artwork validation remains
unchanged. The transformed zero-depth wall footprint must fit the room: no
tangential escape is admitted. Only the declared wall-local normal extrusion (centered ±depth/2),
plus the explicit .002m trim projection, may extend beyond the room's interior
footprint. Boundary walls need not be moved inward. No room, wall plane, door
opening or artwork is enlarged/moved to accommodate it. Finite affine/Float32
hull admission (without inflating thin trim boxes) still applies, as do existing navigation restrictions. Conservative
world assertion bounds refuse finishes that intersect existing artwork.

The existing XY opening partition is shared by base planes, extruded structural
boxes and navigation. Openings pass through the whole thickness. Jamb, floor and
optional ceiling bands are intersected with those same solid wall panels, never
inserted into the opening; no threshold, door leaf or sill blocks the passage.
Two restrained project PBR presets and one pooled box geometry supply the
finish. Base wall appearance remains its existing material. The same transformed
vertices feed Rapier and authoritative presence; transforms apply once and the
existing navigation mesh uses its existing physics queries. Legacy absence
renders/collides as before. Teardown owns only new geometry, materials and
instance buffers; borrowed base materials stay with their original owner.

Full namespace validation applies at draft/save/reopen, OEX and public projection
boundaries. Projection explicitly remaps only `surfaceId`. Hidden or unrelated
fields and namespaces are preserved. Invalid references refuse rather than
silently dropping settings. Existing strict v1 architecture action deltas stay
unchanged: preserve finish bindings or refuse if the resulting document is
invalid.

The optional `architectural-finishes-v1` capability exposes
`window.exhibitosViewport.architecturalFinishes`: CatalogBinding plus closed
`{type:'set-wall-finish',wall}` or `{type:'remove-wall-finish',surfaceId}`.
Reply is binding, `surfaceId` and candidate. Only this namespace and the existing
template modification marker may change. Candidate generation is pure prospective
Preview; the host explicitly applies through its existing frame/history path or
cancels by retaining the source. Authentication before/after, current frame,
replay and all editing intent exclusions are retained. Native authoring UI,
physical mobile performance, human visual acceptance and provider deployment
require their own evidence.
