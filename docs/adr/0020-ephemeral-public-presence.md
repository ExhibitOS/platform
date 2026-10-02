# 0020 — Explicit ephemeral public presence

Status: development implementation; production qualification is separate.

Use a same-origin `ws` 8.22.0 noServer upgrade bridge on the existing Fastify API. Admit guests only after the existing current-public publication authority succeeds. Keep anonymous visitor identity and presence transient; protected editor/account capabilities remain outside this room protocol.

A local candidate spike exercised Colyseus core 0.18.18/ws-transport 0.18.4/sdk 0.18.4 and direct Fastify 5.12.5/ws 8.22.0 with twenty loopback joins, echo and cleanup. Both candidates worked. The local observed join times were 54.16ms and 9.62ms respectively; this isolated observation is not a general performance or support comparison. Choose direct ws because the platform already owns HTTP origin checks, public revision authority and a small closed presence contract. A separate matchmaker/schema/SDK would add machinery without a required capability at this stage.

Use server-generated visitor IDs, bounded rooms and sessions, rotating hashed resume credentials, finite validated geometry and rate/backpressure limits. A reconnect resumes a current room snapshot, not a durable history. The solo Viewer must operate without a socket, avatar resource allocation or presence redraws; failed presence must not block the loaded exhibition. No chat, recording, persistent presence or paid service is introduced.

The bridge is single-process. Multiple replicas require a distinct authenticated coordination design and consistent room routing; do not run independent replicas and claim room continuity. Deployment proxy/TLS/WAN and physical accessibility qualification remain separate. Existing offline and publication contracts are compatible: no required OES field, private dependency or new paid infrastructure.
