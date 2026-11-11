# Camera-position shadow and contact policy

This implementation candidate replaces navigation-room retargeting of projected
shadows and support shading with bounded camera-position/view selection. Source
checks do not establish an actual doorway performance improvement, physical
mobile memory use, visual acceptance or public deployment.

## Projected depth pass

Desktop uses one existing positive directional light, falling back to one
existing positive spot in document order. It does not add light or alter authored
intensity, colour, transform, target, floor material, audio or navigation. This is
an explicit visual tradeoff: representative shadows follow that stable source
instead of each current room's spot. A later authoring change that removes the
positive directional source requires checking the fallback on its actual output.

One 512-pixel PCF target retains the prior estimated 2 MiB allowance. The world
capture includes occluders behind the camera, intersects scene bounds with a
20-metre cube around the camera, and refits after more than 6 metres of
movement. If casters were omitted, a turn over 15 degrees or a projection change reprioritizes work.
Explicit geometry/light changes also invalidate it. Ordinary room labels and
small camera movement do not replace the map or change receiver eligibility.

At most 256 retained receiver references, 64 depth casters and 100,000 depth
triangles are admitted globally. Small structural occluders precede visible and
nearby work. Omitted casters remain rendered normally. Geometry planarity is
cached by position/index identity and update version; clients must mark mutated
attributes with `needsUpdate`, as Three requires. Compact still has no depth map.

## Receiver support shading

Both profiles select at most eight visible footprints within 12 metres, giving
previously selected footprints a 0.75-metre retention preference. Re-selection
requires 0.4 metre movement, 5 degrees of rotation or a projection change.
Selection streams existing descriptors; earlier offscreen rooms cannot exhaust
later rooms' slots. This is a bounded approximation, not full scene occlusion or
an unlimited number of bench feet/frame/plinth cues.

Material-scoped world-space matrices prevent an unrelated receiver material from
using another receiver's mask. Shared material instances use their combined
selected world footprints. Material reference masks share a pool of eight owned
world matrices rather than allocating 128 separate matrices. Shader ownership and cache keys persist while views
change, including inactive count-zero materials. At most sixteen material hooks
are retained (8,320 estimated uniform bytes); admitting another material recycles
an inactive hook. Final retirement clears every retained hook and disposes its
material's program references, preserving authored values and textures. This is
required by Three's material/program uniform-reference cache. Room-label changes do not request retirement; the sixteen-material cache can
recycle inactive slots when a view needs new materials. No meshes, triangles, textures or draws are
added by this shading path. Compiled program and physical GPU memory are unknown.

The existing 12 KiB modeled working allowance is reserved in the shared asset
peak ledger for the controller's entire lifetime. Initial admission may evict
only expendable encoded cache; existing artwork/furnishing holds and pin guards
remain. Concurrent decoding accounts for the live allowance instead of
repeatedly retiring and reconstructing support shading at transition peaks.
Descriptor/receiver replacement and scene disposal can still retire it.

## Scope and verification

Existing frustum culling, camera/FOV/projected-size loading priorities, wall rays,
door eligibility, rights enforcement and artwork budgets continue to operate.
Navigation room labels still serve physical floors, minimum loading, exits and
audio. This change does not assert those other paths cannot contribute to a
stall. An affected actual comparison must include the same doorway in both
directions and representative frame-to-wall, sculpture-to-plinth and bench-to-floor
shading in Desktop and Compact. Keep source tests, browser observation, device
observation and public byte integration as separate evidence.
