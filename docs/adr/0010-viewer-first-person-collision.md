# ADR 0010: fixed-step first-person collision

Status: implemented candidate; simulation and non-native production-browser checks passed, native pointer-lock acquisition remains unqualified. See [executed evidence](../performance/navigation-results.md).

The first-person controller uses pinned Apache-2.0 `@dimforge/rapier3d-compat`0.21.0. Rapier's [official character-controller documentation](https://rapier.rs/docs/user_guides/javascript/character_controller/) describes translation shape casts, move-and-slide, autostep and slope/snap-to-ground settings. Application code supplies desired movement and gravity and applies the corrected translation. It is a collision engine; choosing it alone does not prove the application's camera, input lifecycle or navigation mesh.

A standing capsule has dimensions independent of the adjustable camera eye height. Meter-based public room/surface/placement transforms are applied once. Exact rectangular opening partitions retain door/window clearance and static artwork bounds remain collidable before artwork bytes arrive. Safe supported spawn, floor-edge protection, connected walkable regions/mesh and validated step/slope limits must be demonstrated with actual physics, not inferred from scene labels.

The candidate advances fixed60Hz steps with bounded elapsed-time accumulation and acceleration/deceleration at0.7/1.3/1.6m/s, default1.3m/s. Frame stalls intentionally cap elapsed simulation rather than forcing a large catch-up movement. The resulting trajectory and collision must be compared across frame schedules. Reduced-motion does not require head bob or an animated mode switch.

Walking begins by explicit user action after controller readiness; stationary/list controls remain available when initialization or pointer lock fails. Focus/visibility/capture loss pauses and clears held inputs. Focused keyboard controls and independent touch movement/look complement opt-in mouse capture. Authoring retains its existing orbit preview. Physics initialization should not become mandatory full-gallery preload or grant any access to protected artwork.

New browser runtime license text must be included in production notices. No private Capture or operations dependency is introduced. Actual acceptance follows the [navigation protocol](../performance/navigation-protocol.md); supported geometry, values, navmesh method, measured trajectories and physical-device limits must be reported after verification. This decision does not certify all stairs, curved rooms, mobile GPU or physical tab working set.
