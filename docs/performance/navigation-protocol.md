# Walking and collision qualification protocol

Status: T04-02 test protocol, not a result or supported-device claim. The [Viewer baseline](viewer-baseline.md) measures loading/rendering; it does not demonstrate walking or physical mobile controls.

## Reference worlds and shared code

Use the real first-person controller and production Viewer, not a test-only position updater. Fixtures are original synthetic geometry and qualified GLB/PNG. Record exact commit, browser, physics version, fixed timestep, capsule dimensions, scene units and collider transforms. Existing Studio authoring orbit controls must continue to work independently.

Include an enclosed room with floor/ceiling and a solid wall, an adjacent room with a real door cutout, a window too small for the standing capsule, rotated wall/artwork bounds, a raised platform/step below and above the supported height, and slopes below and above the climb limit. Keep actual door clearance, floor support, walkable bounds and physical dimensions visible in test metadata. Unloaded artworks retain collision bounds. A camera eye-height setting must not implicitly shrink the physical standing capsule. General curved surfaces and arbitrary stair authoring must not be inferred from rectangular fixture support.

Record the actual representation of walkable regions/navigation graph or mesh and its relationship to collision. Coordinate clamping alone is not navmesh verification. Verify room connectivity through the door, inaccessible areas, floor edges and absence of uncontrolled falling. Invalid start cameras must resolve to a validated safe location or an explicit failure with stationary/list alternative.

## Movement and numerical checks

Measure world displacement and stopping time at speeds0.7/1.3/1.6m/s with documented acceleration/deceleration, default eye height around1.65m and allowed settings. Diagonal movement must not exceed the chosen speed. Movement must remain first-person rather than orbiting a target. No jump, forced run, head bob or automatic zoom is necessary for basic walking.

Run the same commands through actual physics at equivalent elapsed time with at least15/30/60/120FPS schedules; compare trajectories/endpoints within a declared meaningful tolerance. Add a bounded frame stall and verify no wall/artwork tunneling or uncontrolled catch-up jump. Distinguish intentionally dropped simulation time from ordinary frame-rate invariance; preserve the observed difference. Fixed stepping alone is insufficient unless collision and displacement are actually checked.

Assert solid wall/artwork penetration does not occur at maximum speed, diagonal/sliding contact remains bounded, narrow openings reject the capsule and a clear door permits actual room crossing. Test supported step ascent/descent, above-limit step refusal, supported slope climbing and steep-slope refusal. Verify the capsule returns to supported floor contact without out-of-bounds escape. Record exact supported values and observed failures instead of claiming all stairs/slopes.

## Actual browser input and lifecycle

Use production Chromium key and pointer events, plus real pointer-lock acquisition initiated by an explicit user gesture where the environment supports it. Exercising an event handler alone must be labeled separately. Verify focused-canvas WASD/keyboard look, mouse movement, explicit pause/resume and stationary controls. Held movement followed by settings/input focus, window blur, document hidden, pointer-lock loss or mode change must clear input and prevent stuck walking; returning focus must not resume without the intended user action.

Emulate narrow touch input using actual pointer down/move/up/cancel and capture loss: left movement and right look must coexist, releasing/cancelling either pointer must clear its state, and controls must avoid accidental page scroll while preserving ordinary UI interaction. Emulated touch is not real iOS/Android device qualification. Keyboard-only controls must remain usable when pointer lock is denied. Reduced-motion preference must be respected without introducing a forced animated camera transition.

Actual camera/world position, collision state and physical eye height are the assertion source, not labels alone. Verify coarse/full loading and cache teardown remain intact while moving or changing mode, and invalid/missing assets do not remove collision obstacles. Preserve current server rights/hash checks; movement does not grant artwork access.

## Reporting

Retain actual unit/simulation and production-browser commands, exit codes, source commit, fixture identity, observed positions, schedules, screenshots and input sequence. Separate source review from executed tests. Keep physics WAsm/native allocation and physical-mobile/GPU/RSS limitations explicit. New runtime licenses and original notices must be present in the production artifact. Physical device or account requirements must be reported to the user if they introduce a new human-only blocker. Do not mark the task done from this protocol or a planned test list.
