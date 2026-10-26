# Exhibition benches and seated viewing

The optional `org.exhibitos.studio/benches` exhibition extension is version 1:
`{version:1, benches:[{id,name,roomId,position,yaw,kind,dimensions,material,viewpointId}]}`.
An absent extension means no benches and does not change legacy exhibitions or artwork files.

- `id`, `roomId`, `viewpointId`: UUIDs; bench IDs are unique. The room and the normal Presentation v1 viewpoint must exist in the same room.
- `name`: nonblank, at most 128 UTF-16 code units.
- `position`: floor-contact centre in room-local metres; +Y up, forward −Z. `yaw` is radians from −π to π (native controls convert degrees).
- `kind`: `slab` or `backed`. Both use five boxes; `backed` adds two back boxes, rising .4 m above the seat.
- `dimensions`: width .6–3 m, depth .3–1 m, height .3–.65 m. **Height means seat surface height**, not total back height.
- `material`: the existing InstallationMaterial, exactly `{preset,color,roughness,metalness}`; paint/wood/stone/metal, sRGB `#rrggbb`, factors 0–1.
- `viewpointId`: the existing Presentation camera holds eye position, target and FOV, without a second camera schema. Its eye must project inside the seat footprint with .05 m inset and sit .5–1.1 m above the seat. These are rendering guards, not ergonomic certification.

Maximum 32 benches, 32 KiB metadata, 32 materials, 224 boxes and 2688 triangles. Generated world geometry must pass the same affine/Float32 hull guards as other decorations. Floor, torso/head and obstacle clearance are checked before explicit seated viewing. The standing eye-height and collision profile are unchanged. Unsupported destinations keep the current view and text access.

`applyBenchCommand` accepts `add-bench` or `set-bench` with `bench` and an optional fresh normal Presentation `viewpoint` (`StudioCamera` plus `id,name`), or `remove-bench` with `benchId`. Add requires a fresh bench ID; set/remove require an existing bench ID. An optional camera is inserted atomically and must have a fresh ID equal to `bench.viewpointId`; it never overwrites an existing/shared camera. To change an authored camera through this narrow path, create a fresh standard camera and relink. Removal retains the viewpoint. Credits, start camera, other viewpoints, artwork and unrelated private extensions are preserved. Full draft validation, authorization, revisions and Undo/Redo remain the caller's responsibility.

Native consumers negotiate optional `bench-inspector-v1` without extending the existing v1 frame selection/action whitelist. `window.exhibitosViewport.benchInspector` takes the existing CatalogBinding fields plus the closed command fields above. It returns the same binding, `benchId` and fully validated candidate. Fresh authenticated scope is required before and after computation; stale frames, replay, disabled editing and overlapping placement/light/bench intents are rejected. Native hosts must verify the same narrow source/result delta before committing one history entry.

Public and OEX projections explicitly collect/remap bench, room and viewpoint identities; UUID-shaped prose is not an identity. Benches use the existing room transform once, shared box geometry/PBR materials and the same walking/presence obstacles. Sit is an explicit action; it pauses input and records the previous camera/view state. Return restores that view with movement stopped and cleared inputs. No camera flight, avatar, sitting animation or extra asset is involved. A persistent return control and keyboard/touch controls accompany text descriptions. Actual browser, native producer, saved-output and physical-device verification remain separate evidence.
