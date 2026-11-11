# Native artwork cards

The existing 256 × 256 artwork-card recipe uses the fixed desktop texture edge
and resident estimate allowance (2048 pixels and 96 MiB). This is scoped to one
transient artwork render; it does not change Viewer budgets or the furnishing
card's existing 1024 pixel / 32 MiB allowance. The camera, light, PNG format and
recipe/tool identifiers are unchanged.

The retained approved Hayes display model has three RGB8 2048 × 2048 PNG maps
and 100,000 triangles. Its decoded geometry arrays total 3,958,464 bytes; the
existing RGBA-with-mipmaps estimate for its three textures is 67,108,864 bytes.
The combined estimate is 71,067,328 bytes. These are source-derived estimates,
not measured process or GPU peaks. They exceed the previous card allowance and
fit the existing fixed desktop allowance. No source model or texture is replaced.

The 16 MiB encoded fetch cap, guarded embedded-resource decoder, source/revision
and display authority checks, 150,000 triangle ceiling, cancellation, PNG result
limit, final source recheck and renderer/resource disposal remain in effect.
Oversize textures, invalid dimensions and excessive combined residency are
refused. Actual product rendering, candidate review/selection and binding
readback require the corresponding qualified runtime and current owner.
