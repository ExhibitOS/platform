# ADR0023: Explicit approved textured LOD publication

Status: implementation checkpoint; runtime qualification pending.

An immutable OEX import can already approve a full primary and an explicitly declared coarse model through `org.exhibitos.viewer/lod` version 1. Publication may consume this exact approved pair. It does not infer a second asset from a private processing report, create a new upload grant, or automatically publish private multi-asset packages. Existing selected-single-asset delivery remains a separate operation.

Both sources must belong to the current tenant/artwork/revision and approved imported inventory, satisfy current display rights, and match actual bytes/hash. The existing isolated embedded-PNG/glTF validator and watermark producer runs for each source. Authorization, revision and integrity errors block publication; unsupported compatible geometry falls back to the qualified full display alone with no stale coarse declaration.

The initial public pair subset uses one identity scene/node/mesh with up to eight per-frame textured primitives. Coarse positions, normals and UV tuples must be exact retained full tuples; each primitive retains exact measured bounds, compatible winding and nondegenerate triangles. Every embedded PNG and its material/sampler relation is unchanged. Actual source triangle counts must match the declared relation, and both triangle count and payload bytes must decrease. This is format and correspondence compatibility, not a reconstructed error bound, physical accuracy, Hausdorff distance or texture compression certificate.

After both watermark operations, publication independently measures displayed triangle and texture metrics and requires a reducing display pair. The original imported models stay immutable. Public inventory identifies the two generated watermarked display assets, while each private publication row retains its exact original source ID/hash. Anonymous reading and republishing accept a secondary source only when it is the exact coarse member of the immutable imported approval and current source policies still permit display.

Geometry and ArtworkDetail retain the centered-metre affine display contract in ADR0022. No geometry rescaling, camera calibration inference or new A/P/R composition is introduced. Actual full/coarse controls, PNG orientation, disposal/revocation, OEX/CMS/publication roundtrip and representative quality/performance benchmarks remain qualification gates. Unsupported general textured simplification is still full-only; no arbitrary UV clustering is enabled.
