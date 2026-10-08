# Spatial Scripting execution-core development profile

This implements a standalone declarative program interpreter. It does not yet
provide the Studio block editor, public Viewer adapter or an adopted OES extension.
Existing disabled OES scripts stay disabled. Read [ADR0018](adr/0018-spatial-scripting-core.md).

Run pinned Node24.21.0/npm11.19.0, `npm ci`, `npm run check`, `npm run test:e2e`,
then `npm run test:spatial-core`. The last command builds public sources and runs
a real compiled evaluator against [the synthetic JSON program](../contracts/examples/spatial-program.json)
and the vendored public Spec scene. No Docker, Capture, operations, private data,
network service or audio device is needed by this probe. Installation still needs
public npm or a populated cache. A successful probe proves commands, not playback.

`parseSpatialProgram(json, scope)` accepts bounded untrusted JSON text and returns
`{valid, errors, program?}`. `validateSpatialProgram`/`validateSpatialEvent` additionally
check closed shapes, scene identity and semantic bounds. Schema-only validation
cannot prove scoped references, distinct IDs, byte bounds or strict date range.
The [JSON Schema](../contracts/spatial-scripting.schema.json) is a development
contract whose identity is not a claim that an endpoint hosts it.

A program is `{version:1, rules:[{id, trigger, actions, once}]}`. Conservative rule
IDs and event names are at most64characters. Up to32rules each have1..16actions.
All delays are integer0..3600000ms; elapsed trigger offsets have the same range.
Absolute triggers require canonical UTC1970-01-01T00:00:00.000Z through
2100-01-01T00:00:00.000Z inclusive. Session clocks are safe integer milliseconds,
relative0..315360000000 and UTC0..4102444800000, both nondecreasing.

| Trigger | Payload |
| --- | --- |
| room_enter / room_leave | roomId |
| zone_enter / zone_leave | zoneId |
| artwork_approach / artwork_look / artwork_click | placementId |
| exhibition_start / exhibition_end | none |
| elapsed_time | atMs |
| absolute_time | atUtc |
| custom_event | name |

The host reports proximity/look edges; this core does not measure geometry or
camera visibility. Repeated room/zone enter/leave edges are deduplicated until the
opposite edge. Other host edge events may repeat; `once:true` limits a rule to one
activation. Time thresholds always activate once, even when once:false.

| Action | Payload in addition to delayMs |
| --- | --- |
| set_light | lightId, multiplier0..1 (of authored level) |
| play_audio | mediaAssetId, volume0..1 |
| stop_audio | mediaAssetId |
| show_text | text, locale |
| set_artwork_visibility | placementId, visible:boolean |
| emit_event | name |

Use `new SpatialEvaluator(program, scope, authorizeAction)`, then
`dispatch(event,{elapsedMs,wallUtcMs})` and `advance(clock)`. Clock triggers derive
from the supplied clock and cannot be spoofed by dispatching an elapsed/UTC event.
Results contain immutable actions and bounded diagnostic trace. `snapshot()` is
immutable; `cancel()`/`unload()` permanently release pending work. Preview and
runtime use this same class with different host capability decisions. The host
must not echo internal emit_event output back into dispatch or apply these commands
to another visitor. No command here fetches a file or controls a device.

Authorizing an ID at scheduling time is insufficient: the predicate runs again at
execution. For audio it must reflect current server rights and visitor consent;
server/decoder adapters still verify authorization, hash, budgets and supported
PCM at use. Escape show_text when rendering and preserve source/transcript
alternatives. Do not equate local command capability with an authenticated API.

No new DB or browser state is persisted. Future stored programs will join the
existing consistent revision/DB/blob backup inventory; evaluator/session transient
queues are not a recovery point. No original artwork, voice bytes or credentials
are included. Full integration and release gates remain outstanding.

Local qualification at implementation796ef166 (2026-10-02): `npm run check`201unit tests/36files +9contracts/types/lint/build; E2E3; independent public tracked-only archive `npm ci` and `npm run test:spatial-core`7 actual compiled probe groups PASS. New contract10/runtime19 unit cases cover all trigger/action shapes, clocks/delays, once/re-entry, identity/consent/revocation, queue/pump/lifetime/recursion budgets, cancellation/reentrancy, accessors/sparse/cyclic/aggregate inputs and immutable visitor isolation. This qualification excludes editor/Viewer/server action adapters and actual media execution.
