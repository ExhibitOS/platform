# Accessible entrance: executed candidate evidence

Root ran a public-only clean clone at product `b9f9f32` and test harness
`0efd393a9042b975a3d6aa7271bc9a438dd1aade`, Node24.21.0/npm11.19.0,
macOS27.0.1 arm64 and production Chromium153.0.8010.12. This is an implemented
candidate, not a completed MVP or overall WCAG certification.

`npm ci` and `npm run check`: PASS95unit/19files,8public contracts, type/lint,
production build and11original runtime notices. Actual fixture uses isolated
PostgreSQL8migrations, server authorization and approved synthetic GLB/PNG/WAV,
not browser-fabricated publication responses.

`npm run test:accessibility` / native-fixture variant: PASS12database/API groups,
8production accessibility groups and4actual teleport groups. [Raw accessibility](accessibility-results.json)
and [teleport](teleport-results.json) retain exact source, measurements, ARIA
snapshot and rendered-canvas hashes; temporary screenshot paths use basenames
and the unchanged original raw hash is recorded.

The text entrance requested0publication media bytes and0canvas, including a
controlled disabled-WebGL case. Keyboard Tab/Enter/Escape exercises artwork
text/transcripts/dialog close and focus return, credits/home exit and list-order
next/previous/all-list restoration.13enabled visible controls were reachable
with measured focus outline. Sampled text/button contrast exceeded4.5:1, focus
outline contrast3:1; these samples do not certify every color combination.
Live OS motion preference, current-page overrides, reset on reload, high
contrast detail and explicit3D/text-return behavior passed.

Five cold samples per viewport at10Mbps/100ms with cache disabled:
1200x900 entrance p95 **1106.78ms**,390x844 **1105.16ms**. No horizontal overflow
or GLB/PNG/WAV request occurred in these text samples. This two-artwork fixture
is not the separate twenty-artwork3D reference or physical mobile hardware.

Actual GLB/PNG-loaded canvas screenshots were hashed before/after first unsafe
and vertical-direction teleport attempts: rendered image identical and no
controller state created. A valid authored destination reached actual grounded,
paused, zero-velocity state with no capture/audio; a later invalid destination
preserved the exact pose and composited image. Unit coverage independently uses
actual Rapier floor/capsule validation, room rotation, uppercase references and
vertical direction refusal.

Previous experience regression at the product-equivalent `b9f9f32` passed12API
and15browser groups including actual Web Audio, detail preview, lifecycle,
synthetic microphone and real60s AudioWorklet cutoff. Required foundation E2E3
passed with isolated3008/5178 ports after correcting an initial temporary-config
working-directory error. No user server was reused or stopped.

Native VoiceOver has a bounded **human-performed pass** on this Mac's installed
Chrome. The user explicitly permitted temporary activation and restoration. Root
observed master off→on, original caption checkboxon, and the synthetic page's
actual native accessibility tree. The control interface could not observe the
separate rotor/caption window and selecting VoiceOver timed out; those attempts
are not a spoken-reading pass. The user then directly tested title, artwork
description/transcript and closing back to the artwork button, reporting
“모두 작동하고 VoiceOver를 껐음”. Root subsequently observed native keyboard focus
on the matching sculpture-detail opener with no dialog. Original masteroff was
observed before the human test and the user reports turning itoff after. Caption
was unchanged, settings view returned to General, temporary utility/tab closed
and the isolated fixture exited cleanly. This is human-reported speech/navigation
plus independently observed focus, not an agent-captured audio/caption transcript
or all-screen-reader certification. Physical microphone/speaker/mobile/GPU/RSS
remain separate qualifications.

The existing3D software-renderer FPS and physical working-set limitations in
[Viewer baseline](viewer-baseline.md) remain in force. An initial new3D measurement
ran alongside a navigation suite; that performance run is retained locally and
excluded from acceptance. Serial remeasurement at0efd393 completed: optional3D cold p95 desktop7049.62ms/narrow7644.27ms; SwiftShader desktop26.77FPS/narrow42.18FPS. Desktop3D rendering and bothoptional3D load targets missed; text fallback is independently measured above. The installed Chrome hardware measurement below resolves the Mac GPU diagnostic; physical mobile qualification remains unavailable. No paid CI, new dependency, private build input, DB migration or actual
data deletion was introduced.

## Installed Chrome twenty-artwork reference

Root ran `EXHIBITOS_VIEWER_CHANNEL=chrome EXHIBITOS_VIEWER_HEADED=1 node scripts/test-viewer.mjs` serially in the public-only clone at clean fc939500ac50a6e5f850a0f4851fffcf9eaed656; exit0, all14 actual API/browser groups passed. Chrome154.0.8037.93 reported `ANGLE Metal Renderer: Apple M1` for both traces, with no known software renderer detected. [Raw reference](accessibility-reference-results.json) retains all twenty cold/warm samples, browser-clock diagnostics, request inventories, 60-second render samples and original raw hash. Historical Viewer baseline files are unchanged.

At10Mbps/100ms, five cold samples per viewport: desktop text p951450.91ms / optional3D3322.60ms; narrow text1142.21ms / optional3D3377.57ms. Warm3D p95desktop2938.95ms / narrow3297.43ms. Largest initial transfer1656019bytes. All samples had20actual text list items and zero publication artwork requests before explicit3D entry. Retained Node-observed five-second/15MB loading gates pass; browser-clock timings are separate diagnostics.

Full twenty-artwork qualified-coarse gallery rendering: desktop3601frames/60009.8ms =60.0069FPS (frame p9517.6ms; render-call p951.0ms), narrow3601/60010.4ms =60.0063FPS (17.5ms;1.1ms). This qualifies this Mac/Chrome/reference workload against the recorded desktop60FPS and narrow30FPS proposals. It does not qualify a physical iPhone or mobile400MB working set; recorded JS heap and renderer resource estimates are proxies. The [serial software diagnostic](accessibility-software-results.json) retains its failed loading/desktopFPS targets; software and hardware results must not be combined. Temporary fixture/browser cleanup completed on runner exit.
