# Viewer no-memory-hint staging candidate

This candidate is not a qualified iPhone budget or a production default. Missing memory hints do not identify a device. The mobile policy uses the base iPhone 12 support floor as the qualification target; actual base iPhone 12 Safari results are required before promoting applicable limits. M1, omitted-hint emulation and iPhone 15 results remain separate evidence.

Enable only for a static staging build with both `EXHIBITOS_STAGING_DIAGNOSTICS=1` and `EXHIBITOS_STAGING_NO_HINT_MINIMUM=1`. The latter is rejected without diagnostics and is part of the immutable build identity. Normal production builds leave it unset. No URL or saved-setting switch enables the trial in a production artifact.

| Browser input / Viewer choice | Current resident / transition MiB | Trial resident / transition MiB | Current aggregate → trial triangles | Individual triangles / texture edge / DPR / heuristic concurrency |
| --- | --- | --- | --- | --- |
| Omitted memory, coarse input, Auto | 192 / 256 | unchanged | 100,000 implicit → unchanged | 100,000 / 2048 / 1.5 / 3 |
| Omitted memory, explicit Compact, any pointer input | 32 / 32 | 128 / 160 | 20,000 implicit → 100,000 | 20,000 / 512 / 1 / 2 |
| Omitted memory, fine-only input, Auto | 320 / 416 | unchanged | 200,000 → 400,000 | 150,000 / 2048 / 1.5 / 3 |
| Omitted memory, fine-only input, explicit Desktop | 320 / 416 | unchanged | 250,000 implicit → 400,000 | 250,000 / 2048 / 1.5 / 3 |
| Omitted memory, coarse input, explicit Desktop | 192 / 256 | unchanged | 250,000 implicit → unchanged | 250,000 / 2048 / 1.5 / 3 |
| Omitted memory, ambiguous pointer input, Auto | 96 / 96 | unchanged | 100,000 implicit → unchanged | 100,000 / 2048 / 1.5 / 3 |
| Known memory or invalid/nonfinite value | existing selected policy | unchanged | unchanged | unchanged |

At known 4 GiB, Auto/Compact remain 48/64 MiB with 20,000/512 limits; weaker known devices retain the existing 32 MiB Compact fallback. Explicit quality choices and the known-memory policies keep their existing behavior. The actual public scheduler remains one shared bounded fetch/decode/upload slot; the table's concurrency is the existing profile heuristic, not additional parallel workers.

## Effective allocation and evidence

Configured resident ceilings are not available artwork bytes or physical memory. `GeometryPreview` subtracts environment, shadow, plaques, thumbnails, retained materials, furnishing reserves, snapshot and transient material-load holds. Effective resident is `max(1, configured resident - reservations)`; effective transition is at least that resident limit and otherwise subtracts the same applicable holds from configured transition. Holds may release after actual material completion. Framebuffer limits are separate.

The retained r67 known-memory Compact consumer demonstrated two concrete bounds: the old 20,000 scene aggregate retired all seven furnishings at 34,506 triangles, and an old effective resident limit of 41,092,394 bytes refused a 44,887,699-byte minimum workload. The separately qualified 128/160 MiB Compact branch kept seven furnishings at 94,493 scene triangles. Its actual effective resident/transition were 88,016,170/121,570,602 bytes after 46,201,558 scene reservations; settled modeled resident headroom was 28,539,188 bytes. These values motivate the omitted-hint candidate but do not measure a phone or guarantee equal reservations in another run.

The desktop candidate changes only aggregate geometry. The observed 94,493-triangle gallery plus two ordinary 150,000-triangle works totals 394,493, within 400,000. This is admission arithmetic, not an actual two-large-work draw result. Its resident/transition byte ceilings stay 320/416 MiB; actual effective values and supported simultaneous work must still be observed with an existing eligible fixture. A source that exceeds existing per-asset limits does not become eligible because the scene allowance grows.

Existing approved inventory/rights/hash/byte/decode checks, authored full/coarse selection, ready-before-swap, reclamation, live reservations, actual-pressure refusal, context-loss handling and original-detail qualification are unchanged. No artwork IDs or source hashes grant new eligibility. In particular, an authorized 4096px original-detail result is not an ordinary 2048px tier.

## Qualification boundary

Source tests cover opt-in/default separation, known/weaker-device preservation, aggregate versus per-asset limits and pressure rejection. Independent delta review precedes the exact staging candidate and affected Studio browser consumer. Reuse the existing r67 fixture and route for the omitted-hint Compact branch; use an already authorized multi-large-work input for desktop when available. Record configured and effective values, first display, return/reload and fallback separately from actual GPU/process memory (unavailable unless measured).

Keep the released r67 artifact unchanged. Stage-only source integration does not authorize publishing this candidate as an unqualified production default. Secretary coordinates any later necessary base iPhone 12 device/iOS observation after reviewed staging and exact inputs are ready; the previously cancelled iPhone 12 entrance comparison is not reinstated as a prerequisite for source preparation.
