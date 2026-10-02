# 0021 — Moderated openings with direct-only opt-in voice

Status: development candidate, final qualification pending.

Use the existing same-origin ws upgrade dispatcher for a separate closed opening protocol. Current publication rights, live session/tenant/owner authority and an exact immutable revision govern host admission. Authenticate and enforce CSRF first, finish that transaction, then check anonymous publication and issue the in-memory grant. Holding the exclusive authenticated policy lock while opening an independent anonymous shared transaction self-deadlocks; the real PostgreSQL qualification exposed and corrected this. Grant issuance, consumption and periodic host checks revalidate authority after the transaction boundary.

Native RTCPeerConnection with empty ICE servers is the initial bounded transport. Two actual installed Chrome contexts with synthetic getUserMedia input demonstrated loopback DTLS/Opus and decoded waveform in both directions. The first spike closed one connection before observing the other; the corrected verifier keeps both alive until all observations finish. Received RTP bytes alone are insufficient decoding proof. The same waveform gate fails unsupported bundled Chromium candidates rather than being replaced by byte counters.

Paid managed voice and provisioned STUN/TURN are deferred: there is no verified provider quota/account billing or justified monthly budget allocation. This choice supports direct reachable peers only and does not fulfill general internet NAT relay support. Keep six voice participants, five peer links each, per-direction consent and explicit microphone activation. No recorder, persistent chat or automatic permission re-request. Failed voice retains chat/text/solo alternatives. See opening.md for retention, moderation and education instructions. No required public OES schema change or private build dependency.

API references: [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/) and [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/). Standards describe the APIs; actual browser/device support is bounded by the executed qualifications.
