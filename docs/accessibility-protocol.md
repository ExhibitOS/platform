# Production accessibility browser protocol

`runAccessibilityBrowser` in `scripts/accessibility-browser.mjs` consumes the actual
published synthetic fixture and production origin created by the isolated PostgreSQL
experience integration runner. It never replaces publication metadata or authorization
with mock responses. The runner retains its original private-data and current-rights
tests; this browser protocol checks the anonymous alternative view.

The text entrance is checked before any renderer is enabled: named heading/list/regions,
zero canvas and zero GLB/PNG/WAV requests, keyboard Tab/Enter operation of opening,
artwork description/transcript/detail, close with returned focus, credits and exit.
A separate explicit disabled-WebGL control confirms text detail remains usable.
DOM/ARIA snapshots are structural evidence, not a native screen-reader execution.

Five separate cold browser contexts each at1200×900 and390×844 disable cache and apply10Mbps throughput
with100ms latency through Chromium CDP. Each records measured entrance readiness,
resource transfer/body sizes, navigation timings and horizontal overflow. The entrance
p95 target is5000ms. Emulated viewport/network/media preferences do not qualify a
physical mobile device, GPU or working-set/RSS limit. Temporary reports/screenshots
are written under a unique `/private/tmp` directory, with exact source head and dirty
source status so a later clean run can be distinguished.

Native VoiceOver, physical keyboard/speaker/mobile and other browsers require separate
observations. Browser assertions alone cannot claim those gates passed. Explicit3D
opt-in remains keyboard reachable; renderer tests belong to the existing Viewer suite.
The OS reduced-motion media query is checked against the actual settings checkbox
and shell state in each fresh context. Manual overrides apply only to the current
page session; OS changes must not overwrite the chosen value, and reload returns to
the OS preference. No persistent local-storage setting is promised.
High-contrast settings are measured in gallery and text detail. Sampled text/button foreground
and effective opaque background colors must reach4.5:1; focus outlines require3:1
against their adjacent parent background and at least2px visible outline. Every enabled
visible text-view control must appear in the actual Tab traversal. These bounded checks
use the [WCAG contrast minimum guidance](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)
as a numeric criterion, not an overall WCAG conformance claim. Explicit keyboard3D
activation, reduced-motion renderer propagation and return to text with focus restoration
are exercised after all zero-media default checks. Measured results must be recorded
before acceptance. This document describes the protocol, not an already successful run.
