# Viewer measurement and acceptance protocol

Status: measurement protocol for T04-01; this document is not a measured result or a supported-device claim. The existing [foundation baseline](baseline.md) measures the entry page only. Viewer measurements must be stored separately with exact tested commit and asset hashes.

## Reference scene

Use a redistributable synthetic public exhibition: one room, ten sculpture placements, ten painting placements and four lights, with meter dimensions and transforms applied once. Include a sufficiently dense static GLB and a high-resolution PNG so generated coarse variants exercise real geometry/texture reduction, rather than a bounding-box substitute. Record both source and qualified coarse/full asset byte counts, hashes, triangle counts, texture dimensions and generator profile. Runtime or benchmark builds must not depend on private Capture or operations.

## Cold and warm entrance

Use production builds and actual published metadata/asset endpoints. Record machine/OS, exact Node/npm/Playwright/browser, viewport/device scale, reduced-motion state, WebGL renderer and network profile. Run at least five samples per desktop/narrow profile, separating cold and warm results. The starting proposal is browser-emulated10Mbps bandwidth and100ms latency. Explain whether browser HTTP cache, service worker and in-memory decoded cache are enabled; do not combine cache scopes. Protected/public API responses and artwork bytes remain subject to the documented current-rights checks and no-store policy.

Define entrance usable before timing: valid immutable metadata loaded, the entrance-priority qualified artworks actually decoded/rendered, controls usable and no blocking error. Record the number/IDs of entrance assets, first-coarse presentation, full-detail upgrades, outstanding deferred gallery assets and corresponding timestamps. Full-gallery eager preload must not be required for entrance use. Measure initial app+metadata+entrance transfer separately from complete-gallery transfer; retain request-level status, body byte counts and hash identity. Warm reuse must respect renderer/session/publication identity and recheck authoritative availability as designed.

The initial targets are sample entrance p95≤5seconds and initial transfer≤15MB. With five samples, nearest-rank p95 is the sample maximum; it does not estimate production population p95. Any failure remains a measured failure with remediation, rather than silently changing the usable definition or target.

## Rendering and memory

After all reference placements are loaded under a recorded quality profile, capture at least60seconds of actual scene rendering. Record real renderer.render invocations and their timings, rendered scene/triangle/texture counts, quality/resolution changes and frame intervals. An idle requestAnimationFrame counter or DOM-only FPS is insufficient to demonstrate scene performance. If a deterministic camera trace is used, record it separately from production reduced-motion behavior. Frame-time p95, frame count and elapsed time must be reproducible from retained raw samples. Headless/software-WebGL results are not physical GPU or real-mobile qualification.

Report browser JS heap and renderer geometry/texture counts or estimated GPU allocations as explicit proxies. These do not prove the target sustained mobile tab working set≤400MB. Actual tab/process working set requires an available, documented measurement source on a reference device; unavailable measurements remain unverified. Desktop60FPS/mobile30FPS are proposal targets and may be claimed only for the measured environment and actual scene workload.

## Failure and lifecycle qualification

Use real corrupt/hash-mismatched and missing asset responses, interrupted/network-denied transfers, abort/cancel and explicit retry. Verify entrance priority, bounded concurrency/byte/decode budgets, coarse-to-full selection, safe fallback when a coarse variant fails, shared asset reuse across placements, and disposal on replacement/unmount/account/publication changes. Stale async results must not populate a disposed renderer. GPU-unavailable/lost UI must retain a keyboard-usable text alternative; event-handler tests are distinct from physical GPU loss.

Verify all variants are declared bounded public inventory with exact revision/hash/size, use only safe mapped endpoints and current rights, and preserve physical units. Previously received bytes are not remotely erasable, but reuse must not invent permission to fetch revoked or unrelated resources. No original artwork, private Capture asset or credential belongs in reference artifacts.

## Reporting

The report must list tested source/final commit, command and exit status, complete reference fixture identity, raw cold/warm samples,60second actual rendering samples, memory measurement method, supported profile and all limits. Keep the foundation report unchanged. Use a separate Viewer baseline artifact and update the support matrix only with actual proven environments. If an external device/account is needed to complete a required gate, record the exact remaining requirement and notify the user according to the project authorization policy.
