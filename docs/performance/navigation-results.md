# Navigation verification

Status: implemented and verified within the documented geometry/input scope. The physical Chrome qualification below resolves the ordinary macOS Chrome mouse gate; earlier native failures and physical-mobile/GPU/RSS limits remain. Filtered browser checks alone never qualify mouse capture.

## Exact source and executed checks

Independent public-only checkout at `0e56bdcf12213a5982378d0c78dbdf738348b367`, Node24.21.0/npm11.19.0. `npm ci` passed at its ancestor2c84484; lockfile/dependencies are unchanged through this source. `npm run check` passed: 52 unit tests, eight packaged contracts, typecheck/lint/build. The unit suite includes13 actual Rapier0.21 simulation groups and three separately mocked input-lifecycle groups. Production notices contain11 original runtime licenses and the correct Rapier0.21 Apache-2.0 license. Source review approved this exact source separately from test execution. `npm run test:e2e -- --config .local/playwright-navigation.config.ts` passed all three foundation browser checks using isolated local ports3029/5199; this auxiliary config only redirects the documented servers and proxy.

`EXHIBITOS_NAVIGATION_FILTER='^(?!browser pointer lock)' node scripts/test-navigation.mjs` passed two actual isolated PostgreSQL/publication groups and13 production Chromium153.0.8010.12 browser groups. The named filter excludes native acquisition; injected refusal, window blur and hidden events are labeled, while keyboard, canvas focus and independent two-pointer touch use browser input. [Root raw report](navigation-root-results.json) records exact clean source, positions, inputs, fixture/profile and screenshots. Original agent [partial report](navigation-results.json) and [refusal fallback report](navigation-refusal-fallback.json) retain their dirty-source relationship and are not substituted for the root result.

## Behavior actually covered

Actual standing capsule wall/artwork bounds, real door crossing and adult window refusal; speeds0.7/1.3/1.6m/s with acceleration/deceleration and15/30/60/120/144Hz simulated schedules, normalized diagonal input and bounded10s frame stall; grounded room/floor limits and safe spawn/settings;20/25cm ascent and descent versus26cm+ refusal;20/35degree ramps versus45degree refusal; bounded triangle/adjacency mesh, door/blocked-artwork connectivity and narrow floor gaps.

Independent review and targeted probes found three errors during qualification: missing step graph connectivity; a higher floor projection falsely bridging an offset10mm lower gap; and25cm top-spawn descent stalling while26/30cm descent passed. Actual regressions reproduced these failures. Height-qualified continuous coverage, approach/lift/traverse/landing sweeps and pre-move drop checks corrected them. Both25cm directions and larger-drop refusal are now directly tested; tests did not relax the advertised threshold.

Production browser checks cover explicit lazy physics entrance, pause/resume position, settings focus, eye height independent of body dimensions, reduced-motion look, walls/rotated art, door/window, disposal/quality replacement, missing assets and unsafe spawn fallback, two-pointer release/cancellation and persistent refused-capture fallback. Tests do not establish physical mobile/GPU/RSS or graphics60FPS support. Existing [Viewer baseline](viewer-baseline.md) retains its measured limits.

## Historical native gate

[Native refusal evidence](navigation-native-capture.json) records real WrongDocumentError in independent minimal pages and production, using bundled headless/headed Chromium and isolated standard Chrome154. A subsequent native computer-use observation reported the Mac locked; this is environment evidence, not a proven explanation for every refusal. The earlier Oct02 foreground observations below updated the unlock condition; the later direct-user Chrome qualification resolves the ordinary macOS Chrome gate. Mocked request promises and injected events cannot replace native acquisition. Keyboard/touch/stationary alternatives are implemented and tested independently.

The [protocol](navigation-protocol.md), [usage and geometry limits](../viewer-navigation.md) and [ADR0010](../adr/0010-viewer-first-person-collision.md) define supported scope. Floor apertures, non-supported transforms/complexity and arbitrary curved/stair spaces are not silently certified. No API/migration/hosted workflow change or private dependency is introduced.

## Native qualification adapters

The default test still requires real browser pointer lock. For supervised input,
`EXHIBITOS_NAVIGATION_NATIVE_INPUT=1` exposes bounded capture/movement/Escape
stages while retaining actual lock, yaw and paused-state assertions. A fresh
Playwright browser process may not be addressable by native app automation.

`EXHIBITOS_NAVIGATION_NATIVE_EXTERNAL=1 node scripts/test-navigation.mjs` instead
serves the same approved synthetic publication using the production build and
writes a temporary `fixture.json`. It verifies anonymous metadata, all public
asset hashes and revision headers, and records source/build hashes. Open its
printed URL in an existing normal browser and record actual lock acquisition,
mouse yaw change and Escape unlock/pause. It launches no browser and expires
after five minutes by default. During an interactive human check,
`EXHIBITOS_NAVIGATION_NATIVE_TIMEOUT_MS=900000` allows fifteen minutes; values
outside1000–1800000ms are rejected. Writing `{"complete":true}` to the printed completion path
requests cleanup only; it never asserts native success. These adapters do not
remove the pending native gate or change the production implementation.

## Oct02 foreground observation

At actual product source `6c9dd1d78e6d7b7cabd323fbe550b4e7ec376e2b`,
normal Chrome native app access confirmed an unlocked desktop. The approved
synthetic production fixture passed its two publication checks and all four
anonymous asset hash/revision-header checks. Native capture clicks displayed
Chrome's cursor/Esc banner twice. Two native app drags left actual camera yaw
unchanged, so mouse look remains unqualified; neither an input-adapter limitation
nor a product defect has been established as the cause. Native Escape paused the
actual controller, with zero velocity and explicit resume. The final UI was left
paused. [Raw DOM/controller observations](navigation-native-foreground.json)
retain the unsuccessful movement result and the limits of DOM-scope pointer-lock
inspection. Physical relative-mouse qualification is still required before
acceptance. No injected native success or operator-cleanup pass is claimed.

The only product changes from the previous tested physics/input code are two
Viewer/Studio explanatory paragraphs: Viewer collision/limited-step support and
stationary fallback are distinguished from authoring preview limitations. Actual
typecheck/lint/build and normal-Chrome DOM/screenshot checks passed for these
paragraphs; the earlier full suite was not rerun or claimed at this latest head.

## Physical user check in embedded browser

At sourcef6ad1a6, the user reported actual walking, Q/E rotation and Escape
pause in the Codex in-app browser, but capture-button activation and mouse
rotation did not work. The observed controller ended at yaw0.1810, horizontal
position[-1.2176,2.5032], pausedtrue and zero velocity. The yaw belongs to the
reported keyboard rotation and is not mouse proof. [User report and observed
state](navigation-human-iab.json) preserve that distinction. The same approved
production scene is being checked in ordinary Chrome to distinguish embedded
browser restrictions from a product defect. Neither cause nor full native
acceptance is established yet.

## Capture lifecycle correction

Source `a02075a2fdff2cbcea70a92efdd8751e92ac7b54` supports document
`pointerlockchange`/`pointerlockerror` completion for legacy void-returning
requests, deduplicates event plus Promise outcomes, serializes pending native
requests, and releases a late success after pause/resume or disposal. An old
Promise completion cannot release a newer capture. These are compatibility and
lifecycle fixes; they do not establish why the embedded browser refused native
capture or demonstrate physical mouse rotation.

A fresh public-only clone with Node24.21.0/npm11.19.0 passed `npm ci`,
`npm run check` (62 unit tests, eight public contract checks, typecheck, lint,
production build and 11 original runtime notices), and `npm run test:e2e`
(three actual Chromium tests). The 13 input unit tests use modeled EventTargets,
not native pointer lock. Production navigation regression and physical Chrome
qualification are recorded separately.

A legacy native request cannot be cancelled. If an implementation emits neither
a completion event nor a Promise outcome, its one pending record and two event
guards remain until an outcome or document teardown, including after controller
disposal. A timeout is not treated as completion and cannot authorize overlapping
native requests. No physical mouse success is inferred from these safeguards.

The same clean source passed two actual isolated PostgreSQL/publication groups
and 13 production Chromium navigation groups with
`EXHIBITOS_NAVIGATION_FILTER='^(?!browser pointer lock)' node scripts/test-navigation.mjs`.
This includes injected refusal with usable keyboard fallback, focus/visibility
pausing, stationary/quality disposal and independent two-pointer touch.
[Exact-source raw browser results](navigation-capture-fix-results.json) retain
the explicit native exclusion; all historical failed capture evidence remains.

## Physical Chrome qualification

At clean documentation head `766a64e0933ccecfbf08ca2fd2b175a8bebeb55b`
(product input code a02075a), the user followed the ordinary macOS Chrome
physical-only sequence: walking start, mouse capture, mouse left/right without
Q/E, Escape. Their direct result was “마우스 회전 됨 정지 됨”. Root then read
actual pausedtrue, zero velocity, yaw1.34366/pitch-0.23200 and explicit-resume
status. [Source, production hashes and human evidence](navigation-human-chrome.json)
record the result and its provenance. This qualifies mouse rotation and Escape
stop in this ordinary Chrome scene. No continuous native event trace was
collected; post-action yaw alone does not attribute the input. The direct user
report establishes that attribution. Earlier embedded-browser failure,
automation drag failure and scope limits remain recorded.

A separate fresh public-only clone at766a64e plus the reviewed test-script diff
passed installation, production build and a focused navigation run covering
two PostgreSQL/publication groups and entrance/refusal browser groups. The
refusal group now exercises Promise rejection and legacy void/event error,
two consecutive attempts for each, actual visible feedback and keyboard yaw.
These test adapters inject failure only and are not native-success evidence.
Script syntax, ESLint and diff checks passed. The human fixture's build was
preserved throughout this additional check.
