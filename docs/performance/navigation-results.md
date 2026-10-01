# Navigation candidate verification

Status: implemented candidate, native pointer-lock acquisition UNQUALIFIED. Do not treat filtered browser checks or this record as completion of the walking task.

## Exact source and executed checks

Independent public-only checkout at `0e56bdcf12213a5982378d0c78dbdf738348b367`, Node24.21.0/npm11.19.0. `npm ci` passed at its ancestor2c84484; lockfile/dependencies are unchanged through this source. `npm run check` passed: 52 unit tests, eight packaged contracts, typecheck/lint/build. The unit suite includes13 actual Rapier0.21 simulation groups and three separately mocked input-lifecycle groups. Production notices contain11 original runtime licenses and the correct Rapier0.21 Apache-2.0 license. Source review approved this exact source separately from test execution. `npm run test:e2e -- --config .local/playwright-navigation.config.ts` passed all three foundation browser checks using isolated local ports3029/5199; this auxiliary config only redirects the documented servers and proxy.

`EXHIBITOS_NAVIGATION_FILTER='^(?!browser pointer lock)' node scripts/test-navigation.mjs` passed two actual isolated PostgreSQL/publication groups and13 production Chromium153.0.8010.12 browser groups. The named filter excludes native acquisition; injected refusal, window blur and hidden events are labeled, while keyboard, canvas focus and independent two-pointer touch use browser input. [Root raw report](navigation-root-results.json) records exact clean source, positions, inputs, fixture/profile and screenshots. Original agent [partial report](navigation-results.json) and [refusal fallback report](navigation-refusal-fallback.json) retain their dirty-source relationship and are not substituted for the root result.

## Behavior actually covered

Actual standing capsule wall/artwork bounds, real door crossing and adult window refusal; speeds0.7/1.3/1.6m/s with acceleration/deceleration and15/30/60/120/144Hz simulated schedules, normalized diagonal input and bounded10s frame stall; grounded room/floor limits and safe spawn/settings;20/25cm ascent and descent versus26cm+ refusal;20/35degree ramps versus45degree refusal; bounded triangle/adjacency mesh, door/blocked-artwork connectivity and narrow floor gaps.

Independent review and targeted probes found three errors during qualification: missing step graph connectivity; a higher floor projection falsely bridging an offset10mm lower gap; and25cm top-spawn descent stalling while26/30cm descent passed. Actual regressions reproduced these failures. Height-qualified continuous coverage, approach/lift/traverse/landing sweeps and pre-move drop checks corrected them. Both25cm directions and larger-drop refusal are now directly tested; tests did not relax the advertised threshold.

Production browser checks cover explicit lazy physics entrance, pause/resume position, settings focus, eye height independent of body dimensions, reduced-motion look, walls/rotated art, door/window, disposal/quality replacement, missing assets and unsafe spawn fallback, two-pointer release/cancellation and persistent refused-capture fallback. Tests do not establish physical mobile/GPU/RSS or graphics60FPS support. Existing [Viewer baseline](viewer-baseline.md) retains its measured limits.

## Remaining native gate

[Native refusal evidence](navigation-native-capture.json) records real WrongDocumentError in independent minimal pages and production, using bundled headless/headed Chromium and isolated standard Chrome154. A subsequent native computer-use observation reported the Mac locked; this is environment evidence, not a proven explanation for every refusal. Unlock and actual foreground capture/mouse/Esc testing remain necessary. Mocked request promises and injected events cannot replace native acquisition. Keyboard/touch/stationary alternatives are implemented and tested independently.

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
after five minutes. Writing `{"complete":true}` to the printed completion path
requests cleanup only; it never asserts native success. These adapters do not
remove the pending native gate or change the production implementation.
