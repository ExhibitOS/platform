# ADR 0009: qualified progressive Viewer assets

Status: accepted after exact-head source review and independent production Chromium qualification at8b6ccc883f1b9e50011983d89eb9145ec6e82491. Software desktop FPS target miss and physical-device limits remain explicit in the measured baseline.

The anonymous Viewer uses the immutable publication projection and existing publication_assets inventory. It does not add a private dependency or replace the current-rights gate. A versioned optional Artwork extension declares one measured full display asset and at most one genuinely reduced coarse display asset. Original download/export remains separately authorized. Older snapshots without the extension remain compatible with bounded decoded-resource checks.

The server generates a bounded static GLB clustering derivative or smaller qualified PNG in an isolated child. It independently measures the full asset even when simplification refuses or fails. V8 heap and timeout bounds do not imply a native/WASM resident-memory cap. Both variant inventories retain exact byte lengths and hashes and are served only under current artwork/asset rights and approval.

The browser schedules nearby entrance assets before explicitly requested remaining batches, bounds concurrent loading and response lengths, and checks revision/MIME/hash before decoding. Compact and desktop profiles bound per-asset geometry/texture, pixel ratio and decoded-resource estimates. Coarse-first loading and explicit full upgrades avoid mandatory all-gallery preload. Resource replacement, cancellation and teardown must dispose stale decoded results. Graphics failure retains a text alternative.

An ephemeral publication/session cache differs from browser HTTP/offline caching; reuse must recheck authoritative availability. Estimated geometry/texture allocations differ from physical process working set. Actual production Chromium qualification, failure cases and retained cold/warm/60second render samples are acceptance gates described in the [measurement protocol](../performance/viewer-protocol.md), not inferred from this decision. See [candidate usage and contract](../viewer.md).
