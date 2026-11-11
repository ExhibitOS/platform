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
