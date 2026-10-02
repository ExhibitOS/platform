# ADR0018: standalone declarative visitor-local execution core

Status: implementation candidate; final qualification pending.

The existing public OES scripts are disabled declarations. Keep their wire
format and behavior unchanged. A standalone development version1 program is a
separate JSON contract, capped32KiB; it is not an adopted/embedded public
extension. Spec adoption and the OES extension16KiB bound must be checked before
transport integration. No Viewer behavior or stored revision is enabled here.

Use closed trigger/action shapes, exact scoped scene references, strict canonical
UTC and integer delays; no expressions, JavaScript, URLs, network/OS actions or
supplied program callbacks. External interchange is bounded JSON text. Descriptor
validation rejects ordinary accessor/cycle/sparse/exotic input without evaluating
values; it does not sandbox already instantiated hostile JS Proxies or trusted
host code. Text is inert data; every eventual renderer must escape it.

One pure evaluator serves preview and runtime. The trusted host supplies normalized
edge events and monotonic session/UTC clocks; it must supply a current synchronous
capability decision for each action, including media rights and audio consent.
Scene reference membership establishes identity, not authorization. Missing or
throwing/denying capability is not permission. Emitted commands affect only this
visitor; there is no shared-state API. Hosts remain responsible for authoritative
server checks/byte integrity and actual action execution. Permission callbacks
are trusted application code, never fields in the serialized program.

Rules follow declaration order and pending commands use deadline/FIFO order.
Action delayMs is cumulative within one rule (AFTER relative to preceding action).
Time thresholds fire once when crossed; elapsed deadlines anchor to their original
threshold, rather than a late render/pump. Absolute UTC maps to relative time via
the supplied clock offset; already-past UTC at initial startup clamps to0.
No ambient Date.now, setTimeout or asynchronous task is used by the evaluator.

Bounds:32rules,1..16actions/rule, pending256,64commands/pump,1024attempts/session,
custom-event recursion depth8, trace128. Forbidden/invalid inputs fail closed;
runaway processing permanently halts and clears owned pending commands. Cancel
and unload permanently clear this evaluator. A new visitor creates a new instance;
pausing timers requires a host policy, not silently sharing another visitor clock.

Block editor, Viewer adapters, stored-profile validation, public Spec distribution,
actual audio/lighting execution and full accessible UI remain later integration.
Core qualification never substitutes their original task gates.
