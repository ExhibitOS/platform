# Spatial Scripting software qualification — 2026-10-02

Development source44cefb7 integrates the optional public Spec draft.3 profile,
block editor, shared evaluator and local Viewer adapters. These are synthetic
software results; physical VoiceOver/audio, Windows, iPhone and release
qualification remain separate. No hosted Actions or new paid resources were used.

Node24.21.0/npm11.19.0 locked public installation and `npm run check` passed:
218 tests in39 files, typecheck/lint/production build,10 installed consumer tests
including18 public conformance cases and portable/public mutation parity. The
public artifact has source0405a2e and SHA-256
22c4bc6a931f2c705d0ed2803f51a53b40a575e11c03b7a934be97edba13e5a8.
The old artifact remains retained; draft.3 is a development PR candidate.
E2E passed3 Chromium tests.

The final `EXHIBITOS_SCRIPTING_ONLY=1 node scripts/test-experience.mjs` passed18
actual PostgreSQL/production Chromium groups. Six are scripting-specific:
block editing/order/validation/IndexedDB reload, protected invalid-profile/ETag
rejection, missing-original READY/direct-publication rejection and restoration,
default-off text mode without asset loading, real delayed Three light/group
mutation with stop/Esc restoration and cancellation, and verified PCM with both
consent gates/mute plus retained original transcript. The fixture performs all10
migrations and separate quiesced DB restore/row and publication-byte equality
against retained synthetic blobs. This is not a standalone production blob backup.

Actual OEX validation passed24 groups including new typed room/light/media/
placement reference remapping and preserved author rule ID/UUID-looking prose,
protected export, fresh/same-tenant import, existing draft1 preservation, corrupt
packages, filesystem and DB rollback, real SIGKILL/lease recovery, Studio and
production worker scheduling. The cold synchronized-checkout child startup wait
was increased from10s to60s after a timeout. The required real advisory-lock INSERT,
pre-kill uncommitted data assertions and post-kill restored equality were retained.
No timing-only substitute proves worker recovery.

Earlier attempts revealed a synthetic scene with no light and a request counter
that included JavaScript/CSS. The final harness creates a real point light through
Studio and counts only public asset endpoints. A mismatched API package pin was
updated from draft.2 to draft.3; no Spec registry package was published or assumed.
The final script and OEX results use the new installed artifact. Actual production
screenshots were inspected: original geometry is restored, controls are visible
and hostile-looking artwork text remains inert.

Runtime unit cases additionally verify real camera edge thresholds/occlusion,
idle/current rights revocation, cancel after pending awaits, bounded flashing,
targeted media cancellation and existing audio compatibility. Compiled core
qualification covers FIFO deadlines, time thresholds, deny-at-due, frozen scope,
reentrant cancellation, recursion/queue/lifetime limits and visitor isolation.
No arbitrary code, URL, network/OS action or other-visitor mutation is exposed.

Independent committed archive44cefb7 with no private repositories passed plain `npm ci`, production build,10 installed contract tests and7 compiled evaluator groups. Original license notices were regenerated and retained in the production artifact.
