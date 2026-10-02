# ADR0019 — Optional spatial profile and local Viewer adapters

Status: development implementation; production release gates remain separate.

Use the public Apache-2.0 Spec draft.3 optional version1 profile, with exact
UUID references and16KiB embedded bound. Keep the existing base OES wire version
and disabled scripts unchanged. The AGPL portable validator retains browser-safe
JSON boundaries; public installed fixture/mutation parity guards semantics.
No Node filesystem validator is included in browser code.

Studio applies closed block edits to the existing validated/CAS draft transaction.
Simulation and live Viewer share SpatialEvaluator ordering and budgets. The host
normalizes camera edges, grants current capability at each action, checks public
rights before effects and every2s while enabled, and guards asynchronous work with
abort/generation tokens. The Viewer starts off, requires explicit activation,
keeps effects local and restores originals on cancellation. There is no evaluator
network or OS action; the trusted host alone fetches existing verified media.

A separate explicit end-event control dispatches exhibition_end. Immediate stop
cancels all pending/end effects and restores the scene. Declarative light effects
are additionally limited to one change per500ms per light, suppressing fast
flashing. Hidden artwork retains collision and accessible original listings.
Audio requires original zone/voice transcript, two explicit sound consents,
current rights, verified bytes/PCM and bounded buffers/sources. Original text is
retained independently of playback. Missing original text blocks server READY
and direct publication, not merely a client button.

Publication and OEX extraction remove this profile from generic entity remapping.
Only its typed room/zone/placement/light/media references are remapped. Author
rule IDs, custom names and UUID-looking prose survive unchanged. Programs are
revision metadata under existing service DB/blob and local draft backup scopes;
transient visitor queues are deliberately not persisted. Old public archives and
wire examples remain available for rollback. No private repository is required
for product builds.

Qualification uses synthetic PostgreSQL, production Chromium and actual Three/
WebAudio, plus independent public artifact installation. It does not replace
VoiceOver, physical audibility, Windows, sensor capture or deployment gates.
