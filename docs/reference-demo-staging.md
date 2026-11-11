# Experimental R97 web composition

`scripts/stage-reference-demo.mjs` is a separate offline experimental composition
entry. It does not change production reference pins, the ordinary build entry,
provider configuration or deployment admission.

Supply JSON on stdin with exactly these fields:

- `scope`: `experimental-staging-only`.
- `inputRoot`, `inventorySha256`: the unchanged complete public R97 input bundle
  and its independent `823b6d8f…` inventory pin.
- `webRoot`, `webInventoryPath`, `webInventorySha256`, `webBuildId`: Main's reviewed
  immutable standard web-input packet, using a distinct experimental build ID.
- `webSourceCommit`, `webSourceTree`: the exact reviewed web producer identity.
- `outputDir`: a fresh canonical absolute output path with an exclusively owned
  parent, outside the input and web roots. Do not use the retained public output.

After compiling the existing shared contract dependency if needed, run:

```sh
node scripts/stage-reference-demo.mjs < staging-request.json
```

The existing refresher validates the complete source and web inventories, exact
index/publication/detail bindings and all retained content. The shared established
Demo session overlay adds the same `session-v1` configuration to both HTML
entries, updates the two manifest entries and emits truthful new raw-staging and
hosting manifest hashes, then adds the existing cache headers. All emitted files
are compared against the independently derived inventory before atomic rename.
The receipt includes the full hosting inventory, unchanged publication/index,
web source/tree/build, base native manifest, and new staging/hosting manifests.

The caller must retain Main's source review, build flag/check evidence and web
inventory pin alongside this receipt. The producer does not infer compile flags
from a Git ID or treat a staging artifact as production approval. Delivery owns
experimental staging transport and its independently reviewed final pins; actual
mobile diagnostics remains a separate consumer observation. No API, profile,
model conversion, original approval or additional Viewer/runtime build occurs.

Malformed requests, production scope, same production build ID, modified input,
extra or linked files, overlap, existing output and writer collisions fail. Only
the invocation's own staging and lock are removed on failure. Existing public
R97 output, original immutable inputs and earlier evidence are preserved.

## Native runtime inputs are a different closure

The 36-file immutable web input above is the HTML/JavaScript shell used when
refreshing an already complete static publication. It is not the full Native
runtime `dist-static` directory used to create a new export. Native export also
needs the declared floor maps, footstep samples/notices, surface maps/notices and
catalogue previews. The packager verifies all 43 current declared resource files
before creating a runtime destination and rechecks the copied runtime directory.

When reusing an immutable shell, the producer must supply these unchanged
catalogue/spec resource bytes as separate pinned inputs before invoking the
packager. An incomplete shell-only input must fail rather than become a runtime
whose exporter fails after writing a partial publication. This does not modify
existing runtime packets, failed stages, original grants or publication records.

## Exact Hayes content continuation

The Native closure also admits one exact publication `094e0295-1dba-4d3c-8ebc-d534c1f7b347`
with index `4072e5df4e44b0a760711612f5fbae6c0c01c134650b5062cba370e7360d2211`
and native manifest `917192929b0885d69861b759316fbffcc443f04e617d3cab7a784170a0453231`.
It retains both original detail tuples and adds the selected Hayes thumbnail.
Only the already qualified mobile Viewer build `776bfe96635d1251ba49a405f458e72954551bc187a2cd398387fba48e84b71f`
is admitted for this content. The earlier R97 publication and both of its exact web targets remain supported.

This bundle contains 141 source files plus 36 web files and two control files
(179 integrity rows, 180 physical files including `integrity.json`). The deterministic
session hosting output contains 142 files. Cache directives are unchanged, while
the content-addressed publication JSON and Hayes PNG paths change the header hash.
No editable-head lighting trial, caller-selected publication, new original grant,
experimental Viewer build or arbitrary combination gains admission. Production
transport and actual Viewer acceptance remain separate from local composition.
