# Viewer measurement and acceptance protocol

Status: measurement protocol for T04-01; this document is not a measured result or a supported-device claim. The existing [foundation baseline](baseline.md) measures the entry page only. Viewer measurements must be stored separately with exact tested commit and asset hashes.

## Reference scene

Use a redistributable synthetic public exhibition: one room, ten sculpture placements, ten painting placements and four lights, with meter dimensions and transforms applied once. Include a sufficiently dense static GLB and a high-resolution PNG so generated coarse variants exercise real geometry/texture reduction, rather than a bounding-box substitute. Record both source and qualified coarse/full asset byte counts, hashes, triangle counts, texture dimensions and generator profile. Runtime or benchmark builds must not depend on private Capture or operations.

## Cold and warm entrance

Use production builds and actual published metadata/asset endpoints. Record machine/OS, exact Node/npm/Playwright/browser, viewport/device scale, reduced-motion state, WebGL renderer and network profile. Run at least five samples per desktop/narrow profile, separating cold and warm results. The starting proposal is browser-emulated10Mbps bandwidth and100ms latency. Explain whether browser HTTP cache, service worker and in-memory decoded cache are enabled; do not combine cache scopes. Protected/public API responses and artwork bytes remain subject to the documented current-rights checks and no-store policy.

Define entrance usable before timing: valid immutable metadata loaded, the entrance-priority qualified artworks actually decoded/rendered, controls usable and no blocking error. Record the number/IDs of entrance assets, first-coarse presentation, full-detail upgrades, outstanding deferred gallery assets and corresponding timestamps. Full-gallery eager preload must not be required for entrance use. Measure initial app+metadata+entrance transfer separately from complete-gallery transfer; retain request-level status, body byte counts and hash identity. Warm reuse must respect renderer/session/publication identity and recheck authoritative availability as designed.

The initial targets are sample entrance p95≤5seconds and initial transfer≤15MB. With five samples, nearest-rank p95 is the sample maximum; it does not estimate production population p95. Any failure remains a measured failure with remediation, rather than silently changing the usable definition or target.

## Default text entrance and optional 3D timings

The twenty-artwork reference now opens its real publication heading and list before the user explicitly selects `3D 관람 시작`. Every cold/warm sample records `textEntranceMs`, twenty actual list entries, the finished app/metadata request inventory, and zero published artwork requests started before opt-in. This measures the accessible text fallback on the same twenty-artwork publication; it is separate from the optional 3D entrance target. It does not turn a failed 3D or rendering target into a pass.

Keep the existing `entranceMs`/`p95EntranceMs` and `targetPass` definition unchanged: Node-observed navigation through explicit 3D entry, four decoded entrance artworks and enabled controls. Those measurements include automation round trips and polling observation delay. A browser-owned MutationObserver separately watches the actual production `data-viewer-state` (`loadedAssets=4`, no failed assets) and enabled rotation control, then records the next animation frame with `performance.now()`. `browserReadiness.readySinceNavigationMs` uses the document navigation time origin; `optInToReadyMs` starts at the observed explicit button click. Both are diagnostics with different clock/boundary definitions, not replacements for the retained gate. No application state, GPU or readiness metadata is injected.

## Installed Chrome reference

The default runner remains headless bundled Chromium. To measure installed Chrome in a separate headed browser session, use the existing fixture runner with:

```sh
EXHIBITOS_VIEWER_CHANNEL=chrome EXHIBITOS_VIEWER_HEADED=1 EXHIBITOS_VIEWER_REPORT=/private/tmp/exhibitos-viewer-chrome.json node scripts/test-viewer.mjs
```

Use the repository's documented exact Node/npm and a current production build. The only accepted channel override is `chrome`; headed accepts `0` or `1`. Missing Chrome is a failed/unavailable environment, not permission to substitute another browser silently. The report records channel, headed/headless mode, browser version, OS and actual WebGL vendor/renderer per trace. `softwareRendererDetected` checks the returned renderer string for known software implementations. An unreported renderer or a false software flag alone does not prove physical hardware acceleration. A headed Chrome launch may still use SwiftShader; preserve that observation and all measured failures. A narrow viewport on this Mac is not a physical iPhone/Android performance result.

## Rendering and memory

After all reference placements are loaded under a recorded quality profile, capture at least60seconds of actual scene rendering. Record real renderer.render invocations and their timings, rendered scene/triangle/texture counts, quality/resolution changes and frame intervals. An idle requestAnimationFrame counter or DOM-only FPS is insufficient to demonstrate scene performance. If a deterministic camera trace is used, record it separately from production reduced-motion behavior. Frame-time p95, frame count and elapsed time must be reproducible from retained raw samples. Headless/software-WebGL results are not physical GPU or real-mobile qualification.

Report browser JS heap and renderer geometry/texture counts or estimated GPU allocations as explicit proxies. These do not prove the target sustained mobile tab working set≤400MB. Actual tab/process working set requires an available, documented measurement source on a reference device; unavailable measurements remain unverified. Desktop60FPS/mobile30FPS are proposal targets and may be claimed only for the measured environment and actual scene workload.

## Failure and lifecycle qualification

Use real corrupt/hash-mismatched and missing asset responses, interrupted/network-denied transfers, abort/cancel and explicit retry. Verify entrance priority, bounded concurrency/byte/decode budgets, coarse-to-full selection, safe fallback when a coarse variant fails, shared asset reuse across placements, and disposal on replacement/unmount/account/publication changes. Stale async results must not populate a disposed renderer. GPU-unavailable/lost UI must retain a keyboard-usable text alternative; event-handler tests are distinct from physical GPU loss.

Verify all variants are declared bounded public inventory with exact revision/hash/size, use only safe mapped endpoints and current rights, and preserve physical units. Previously received bytes are not remotely erasable, but reuse must not invent permission to fetch revoked or unrelated resources. No original artwork, private Capture asset or credential belongs in reference artifacts.

## Reporting

The report must list tested source/final commit, command and exit status, complete reference fixture identity, raw cold/warm samples,60second actual rendering samples, memory measurement method, supported profile and all limits. Keep the foundation report unchanged. Use a separate Viewer baseline artifact and update the support matrix only with actual proven environments. If an external device/account is needed to complete a required gate, record the exact remaining requirement and notify the user according to the project authorization policy.
