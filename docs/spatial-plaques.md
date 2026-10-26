# Spatial plaques

Optional `org.exhibitos.studio/plaques` version 1 contains a closed `plaques` array
(maximum 32 records, 16 KiB). Absence renders no plaques. Each record has UUID
`id`, existing `roomId`, `source`, room-local metre `position:[x,y,z]`, unit
quaternion `rotation:[x,y,z,w]`, `dimensions:{width,height}`, and `visible:boolean`.
Width is .2–2m, height .15–1.2m; +Y is up and the plane front is +Z. The complete
plane must fit the room and remain finite in world/Float32 geometry.

`source` is exactly `{kind:'exhibition'}`, `{kind:'room'}`, or
`{kind:'artwork',placementId:UUID}`. Artwork sources must be in the same room.
Title/introduction/artist, room name and artwork information are always derived
from the existing exhibition and artwork records. No duplicated prose, URI,
font or asset fields exist. Invalid or deleted references refuse validation;
retarget or remove a plaque before deleting its source. Hidden records remain
validated and preserved. Unknown private namespaces remain untouched; public
and OEX projections remap only plaque ID, room ID and artwork placement ID.

Near text uses the existing Three.js scene, a shared plane and far material,
and the existing pinned LRU. Text is a derived 512×256 system-font CanvasTexture,
with no mipmaps or external download. Up to four textures on desktop or two on
compact reserve 4/2 MiB from the existing asset budget, including CPU canvas
and GPU texture residency. Eviction precedes replacement creation, so the
count also bounds replacement peaks. Front-facing visible labels enter at 4m and leave
at 5m. Far plaques retain their presence; small 3D text is never the only route.
A failed canvas leaves the far plane and accessible reading path available.
Teardown detaches meshes, releases pins and disposes owned geometry/materials,
textures and canvases. Source revision changes rebuild the derived cache.

Selecting a plaque explicitly requests the existing exhibition/artwork DOM
panel or the same dialog pattern for a room. Menu and text-list buttons expose
the same source through keyboard access. Existing movement pause, pointer-lock
release, exact caller focus and view-return policies are reused. No voice is
automatically played and no second camera, scene or font service is introduced.

Native hosts may opt into `plaque-inspector-v1` and call
`window.exhibitosViewport.plaqueInspector` with the existing CatalogBinding and
closed `add-plaque|set-plaque` plus `plaque`, or `remove-plaque` plus `plaqueId`.
The reply contains that binding, `plaqueId` and candidate. Only this namespace
and the existing template modification marker may change; other rows and
namespaces remain verbatim. Full source/result validation, server session checks
before and after computation, current-frame checks, replay rejection and all
other editing intent exclusions apply. Legacy v1 selection/actions are unchanged.
A source contract/build pass does not qualify native authoring UI, physical
mobile performance, human readability acceptance or public deployment.
