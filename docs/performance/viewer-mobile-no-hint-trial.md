# Current-scene mobile no-memory-hint staging trial

This is a staging candidate for the base iPhone 12 Safari qualification target, not a physical capacity guarantee or a production default. Missing browser memory hints and pointer input do not identify a phone. M1 controlled observations and iPhone 15 availability remain separate evidence.

Build the existing static Viewer entry with `EXHIBITOS_STATIC_TARGET=viewer EXHIBITOS_PRIVATE_EDITOR=1 EXHIBITOS_STAGING_DIAGNOSTICS=1 EXHIBITOS_STAGING_NO_HINT_MINIMUM=1 npm exec --workspace @exhibitos/web -- vite build --config vite.static.config.ts`. The trial requires diagnostics and rejects values other than unset, `0` or `1`. The active trial bit is included in the immutable build identity. No URL, preference or runtime mutation enables it. Normal builds leave the flag unset.

Only an omitted memory hint with `coarsePointer=true` and `finePointer=false` changes:

| Choice | Current resident/transition MiB | Staging resident/transition MiB | Current/staging aggregate triangles | Individual triangles/texture/DPR/heuristic concurrency |
| --- | --- | --- | --- | --- |
| Auto | 192/256 | 336/448 | 100,000/250,000 | 100,000/2048/1.5/3 |
| Compact | 32/32 | 128/160 | 20,000/160,000 | 20,000/512/1/2 |

Explicit Desktop, fine-only/ambiguous/mixed input, known memory (including constrained values) and invalid/nonfinite hints keep their current policies. The actual public artwork fetch/decode/upload scheduler remains one serial slot, not the heuristic concurrency column. Existing pressure refusal, pinning, authorized tiers, rights/hash checks, ready-before-swap, reclamation, cancellation and context-loss handling remain unchanged.

The existing no-hint staging source used Compact100k aggregate before the current scene. Current Compact observation measured114,519 scene triangles with five sculptures and seven furnishings; 160k leaves28% of its allowance free. Replacing only the Hayes20k tier with its eligible100k ordinary tier models194,519 scene triangles; 250k leaves22% of its allowance free. These are scene admission calculations, not successful current mobile or physical draws. Per-model quality does not increase.

The retained controlled omitted-hint M1 Chrome experiment on the older scene refused the ordinary Hayes source with MODEL_RESIDENT_BUDGET at effective87,246,122/154,354,986 resident/transition bytes with configured192/256MiB. Its reviewed336/448MiB successor attached/drew that source at effective229,983,530/347,424,042 bytes. The seven furnishing reservations remained7,515,676 bytes. Those historical effective values are not asserted for the new scene.

Reuse that byte envelope while freezing Auto material planning to192MiB. `materialPlanningCapacity` subtracts the extra artwork bytes only from initial floor/surface planning. All actual environment/shadow/plaque/thumbnail/material/snapshot/furnishing/frame holds stay charged; serial material phases change effective artwork limits after actual settlement. Encoded, decoded, prepared and retained-minimum resources share bounded accounting. Shared ledger totals include persistent furnishings and differ from viewer-only resident estimates. Nothing here measures physical process/GPU memory.

The current PR603 room-contact selector and PR606 contact-cache recovery/known-memory Compact changes remain intact. Existing source checks and historical observer evidence are reused where unchanged. New source review and an immutable diagnostics-enabled web input precede Server composition with the exact current publication. Delivery verifies isolated staging bytes, Studio checks only affected admission/pressure behavior, and Secretary consolidates any physical base iPhone 12 Safari request after readiness. No production promotion follows from a staging pass or an iPhone 15 result. The already qualified public release remains unchanged.
