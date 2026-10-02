# Opening controls UX qualification

Baseline: Platform `64d2f33`, flat opening controls. The updated controls group voice, guided movement, chat, participants and host moderation into named cards. Korean status labels replace internal state names. Separate consent and server-authorized moderation behavior remain unchanged. Narrow screens use one column; labels and buttons have larger targets, and keyboard focus has a visible outline.

## Actual checks

Node24.21.0/npm11.19.0, local synthetic PostgreSQL18.6 and installed Chrome. `npm run check`:47 files/255 unit tests plus10 consumer tests, lint/typecheck/build PASS. `npm run test:e2e`:3 PASS. Final `npm run test:opening`:10 groups PASS, including host and guest at320/390/1280 CSS pixels, no controls-region horizontal overflow, button targets >=24px wide/44px high, checkbox labels >=44px high, Tab focus inside controls with :focus-visible and >=2px outline. Root visually inspected actual320px and1280px host screenshots. Scoped ESLint PASS after the final focus assertion.

The same integration run checked actual production RTC synthetic waveform decoding, microphone stop on mute/leave, peer block, reconnect consent reset, guide consent and publication revocation, followed by a separate database restore with retained blobs. No new dependencies, fonts, animations or rendering loops were added. Wire contracts and server authority are unchanged.

## Research and limits

Design checks reference official W3C [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). This is a scoped controls improvement, not a full Platform WCAG audit. No new physical VoiceOver, human audio, WAN/TURN, Windows or release acceptance is claimed. Original integration/release gates remain.

Local execution logs: `/private/tmp/exhibitos-opening-ux-check.log`, `exhibitos-opening-ux-e2e.log`, `exhibitos-opening-ux-final.log`. Six actual controls screenshots: `/private/tmp/exhibitos-opening-ux-{0,1}-{320,390,1280}.png`. These temporary files are local supporting material, not guaranteed permanent hosted artifacts; the test harness reproduces them using synthetic fixtures.
