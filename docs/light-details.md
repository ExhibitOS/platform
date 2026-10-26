# Fixture bodies and authored light aiming

The optional exhibition extension `org.exhibitos.studio/light-details` is
`{version:1,lights:[{lightId,fixture,aim?,penumbra?,range?,temperatureKelvin?}]}`.
It is closed and bounded to 32 existing light bindings / 16 KiB. Absence preserves
the existing light renderer and data. Artwork files, units and unknown private
extensions are not rewritten.

`fixture` is `none`, `spot-can` (spot only), `disc` (point only), or `panel` (area
only, existing width/height .1–4 m). Directional lights have no housing. Bodies
use small shared project geometry/materials, at most 64 meshes / 1920 triangles,
and never become shadow casters. They are visual fixtures, not optical models,
physical collision objects or calibrated luminaires.

`aim` is `{kind:'rotation'}`, `{kind:'placement-center'}`, or
`{kind:'point',position:[x,y,z]}`. Point coordinates use the light room's existing
metre frame (+Y up), must be inside that room and differ from the light position.
Placement-center reuses `Light.targetPlacementId` in the same room; its centre
comes from the artwork assertion through artwork and placement transforms.
Moving the target updates the next scene generation; deleting it is rejected
until explicitly retargeted or switched to rotation. Rotation/point clears the
base placement target. Ordinary light deletion removes its details atomically.
An absent aim preserves the old placement-origin/quaternion behaviour. Editor
aim/beam lines are not created for public visitors.

`penumbra` is 0–1 for a spot beam edge; it is not shadow softness. `range` is the
existing Three point/spot cutoff distance, .1–50 m. Base `beamAngle` remains a
full cone angle in radians; native degree controls convert at their existing
boundary. Units and numeric intensity are never silently converted on type
changes. Existing bounded shadow/mobile policies remain independent.

`temperatureKelvin` records explicit visual approximation intent (1000–20000 K).
`lightKelvinLinear` supplies the matching linear RGB for the existing Light.color.
Stored RGB is authoritative: the renderer never repaints it from K on load.
Direct RGB edits clear K in the same command. No spectral, lux, conservation or
cross-device colour accuracy is implied.

New native clients may negotiate `light-fixture-aim-v1` and call
`window.exhibitosViewport.lightDetails` with CatalogBinding plus closed fields
`{type:'set-light-details',lightId,light:Omit<Light,'id'>,settings}`. Settings omit
their repeated lightId. The result is the same binding plus lightId and a fully
validated candidate. Only that light, its details binding and existing
template.modified may change. Room, shadow policy and scale are preserved;
type changes require their existing canonical unit without intensity conversion.
Source/result validation, authenticated current-frame checks before/after,
bounded replay and exclusion with placement/light/bench intents apply.

The old `light-inspector-v1` envelope and successful delta are unchanged. A legacy
edit succeeds only while its unchanged details remain valid. A conflicting RGB,
type or size edit refuses with `LIGHT_DETAILS_REQUIRES_ADVANCED_INSPECTOR` and
keeps the source/raw input; use the new atomic command instead. No ordinary v1
frame selection/action whitelist is widened. Public/OEX projections remap typed
light IDs only. Native GUI, public hosting and human rendering acceptance remain
separate from shared-source and local-output verification.
