# Painting resolution: producer boundary under review

This is a source-only design at Platform `6a9eee5deda7abd8e7034d92792208055c54357b` (tree `3fe8fce6b698706a7d6ad71c5acab1e5a8a66cc4`). It does not enable a larger image or establish an accepted resource budget.

## Current boundaries

* `prepared-image.ts` accepts a client-declared RGB8 preparation receipt, limits the encoded PNG to 8 MiB, and checks dimensions at 2048 per edge and 4,194,304 pixels. Settings and pixel hashes record provenance; they do not authorize a larger image or prove pixel equivalence.
* `derivative.ts` accepts 512 or 2048 as `maxTextureSize`; its worker has a 128 MiB heap setting and five-second timeout. `validation-worker.ts` admits those sizes and uses the strict PNG decoder, whose default is 4,194,304 pixels. The decoder verifies chunks, CRC, supported color data, bounded inflation and scanlines.
* `demo-display-derivative.ts` selects 2048 for ordinary primary images and 512 for coarse images. An exact approved image is checked against approval limits and decoded before clean bytes are reused; embedded watermarking uses the derivative path. Rights and current approval are checked by the existing caller.
* The existing display cache recipe includes source SHA, maximum texture size and watermark. It distinguishes derivative results; a cache key is not an authorization decision.
* Main owns `demo-display-policy.ts`, publication, approved pair qualification, OEX, shared contracts and Viewer loading. Current exact approval and Viewer loading still impose 2048 and other limits; changing only the producer cannot qualify an end-to-end larger image.

## Proposed boundary, not yet agreed

Main's existing approval path could return a narrowly scoped internal capability only after current revision, rights, source hash and byte count have been verified. A producer could consume that capability for an explicitly selected full image, with fixed reviewed edge, pixel and resource limits. No capability means the existing behavior. Arbitrary caller numbers, a client settings digest, an inventory claim or a cache hit must not grant admission. The exact type, scope, lifetime, caller and values require agreement with Main; the Manager preparation path needs its own trusted opt-in and matching receipt/capability negotiation.

If implemented, the selected limit and any additional behavior affecting output must be reflected in cache identity. Preview and coarse lanes remain separately bounded. Preserve the 8 MiB encoded bound, original bytes and rights, ICC evidence, strict decoding, no upscaling and existing 2048 compatibility. An exact-file approval must continue binding the actual bytes; watermarking cannot silently bypass its policy. Do not infer safe limits from the three artworks' target pixel counts.

## Evidence needed before choosing limits

Studio and Manager should agree on a synthetic measurement design covering boundary and over-boundary dimensions and pixels, encoded size at and over 8 MiB, RGB8 and supported alpha behavior, malformed chunks/CRC and compressed expansion, no-upscale and aspect ratio, ICC receipt/readback, unchanged default and watermark/cache separation. Measure worker wall time and peak memory, including decoded buffers and derivative output, under its actual process limit; test cancellation and failure without partial output. Main must separately establish publication/OEX and Viewer admission, selected-image decode, GPU maximum texture size, peak/resident/mipmap budgets and compact fallback. A passing synthetic result alone does not approve real artwork or public release.

Implementation waits for the agreed capability and bounded values, Manager input contract, Main consumer boundary and review of measurement evidence. Actual image conversion, exhibition edits, public output and deployment are outside this design unit.
