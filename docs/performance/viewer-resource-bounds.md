# Viewer scene resource bounds

The scene admission limits are application policy, not measured hardware limits.
The old public 256-draw ceiling was a conservative scene counter; its value did
not establish a portable WebGL device limit. The native editor already used 384.
Creation, import, save and export contracts do not acquire these viewing limits.

## Initial bounded policy

| Work | Bound | Accounting |
| --- | ---: | --- |
| Color scene draws | 384 | Conservative inventory across rooms, including hidden objects and reserved previews |
| Standard / native color triangles | 350,000 | Aggregate scene and reservations |
| Compact color triangles | 250,000 | Aggregate; existing 20,000-triangle per-model tier retained |
| Shadow caster geometry | 250,000 | Union of admitted caster geometry |
| Dirty shadow depth triangles | 250,000 | Sum across source maps, including repeated material groups |
| Shadow maps | 2 Detailed, 1 Compact | Detailed uses 512-pixel PCF at up to 4 MiB. Compact reserves 512 KiB for a 256-pixel PCF map when the exhibition has an eligible authored sculpture spot. |
| Shadow casters / receivers / dependencies | 64 / 256 / 2 | Existing independent bounds retained |

The approved physical fixture workload explains the change. Each museum spot
contains 4,260 triangles and originally required 14 opaque draws. Exact-material
batching within its independent fixed and head groups reduces this to seven;
the lens remains separate. Fourteen spots therefore require 98 draws and 59,640
triangles. Including the white rails and grouped dark rail, the new model draw
delta is 78. The prior 256 envelope plus that delta, 18 possible fallback draws
and nine edit guides is 361, below 384. This is a workload allowance relative to
the previous accepted envelope, not a measurement of the complete new scene.

The standard 350,000-triangle allowance covers the prior 250,000 envelope plus
the 62,926-triangle fixture delta and headroom. Compact 250,000 covers its prior
populated 160,000 envelope plus the same delta and headroom. The shadow allowance
covers two approved 100,000-triangle bodies plus 50,000 structure triangles;
weighted dirty depth work must independently fit the same ceiling. Extra depth
work is omitted explicitly while display geometry stays intact.

## Memory and fidelity

Verified fixture source buffers and merged geometry are shared only within one
scene and exact source identity. Geometry is charged once; each instance retains
its own pose, node allowance and lens material. The modeled node allowance is
4,096 bytes per holder. The existing 4 MiB catalogue-other budget is unchanged.
Disposal releases instance resources before shared buffers and source buffers.
No proxy, forced display LOD or shadow mesh copy is introduced. Existing texture,
pixel ratio, per-model, cache, transition and concurrency limits remain separate.

## Failure and observations

Admission, preview reservations and live enforcement use the same color bounds.
Numeric initial, reserved, remaining and checked counts accompany capacity
failures. Public viewing preserves its text route and an actionable persistent
capacity message; arbitrary internal errors are not exposed. Native editing keeps
its existing fallback. A capacity rejection is not proof of unsupported hardware.

The inventory differs from actual per-frame renderer calls. In the installed
Three.js r186 renderer, `info.render.calls` includes color and any dirty shadow
passes because its reset precedes shadow rendering. Trace duration measures CPU
submission time, not GPU duration. Object counts and modeled bytes are not a
physical VRAM measurement. Final scene appearance, navigation and device
performance require their actual consumer checks; a fresh device run is not a
prerequisite for this initial policy decision.

## Primary guidance

Three.js explains that individual meshes incur draw submissions and demonstrates
geometry merging to reduce them in its [geometry optimization manual](https://threejs.org/manual/pages/optimize-lots-of-objects.html).
The [renderer documentation](https://threejs.org/docs/pages/WebGLRenderer) defines
renderer counters and their reset behavior. [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
recommends batching draws and bounding memory; WebGL does not provide a portable
physical VRAM capacity query. These sources support the accounting approach,
not a universal safe frame rate for the numerical policy above.
