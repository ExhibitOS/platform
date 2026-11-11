# R97 public reference input closure

The existing `npm run build:reference-demo` entry supports a complete, immutable
public input bundle. This mode reconstructs the already reviewed native R97
artifact; it does not rebuild its Viewer or create a new publication approval.

Use Node 24.21.0 and npm 11.19.0. Install the producer checkout's pinned dependencies
with `npm ci`, then run from that checkout with a fresh `dist-demo` destination:

```sh
EXHIBITOS_REFERENCE_NATIVE_CLOSURE=/absolute/path/to/public-input \
EXHIBITOS_REFERENCE_NATIVE_INTEGRITY_SHA256=823b6d8f4ee85ad82270413ac30f3a9fb093479ae5d85e386ad97146b63dea8c \
npm run build:reference-demo
```

The absolute path is supplied by the caller. The bundle and code contain no
operations-path defaults, credentials, private profile or database dependency.
Do not combine this mode with `EXHIBITOS_QUALIFIED_REFERENCE_SOURCE`. Without
these new variables the existing legacy build remains unchanged.

## Immutable input contract

The bundle has 179 files. Root `integrity.json` has format
`exhibitos-reference-native-input-v1`, `indexSha256`, and exactly 178 `files`
entries, each containing only `path`, `bytes`, and `sha256`. The independent
integrity SHA above authenticates that complete inventory:

- `source/`: all 140 original qualified native static files, including its index
  and manifest, without a hosting `_headers` file.
- `web/`: all 36 qualified static web input files, including `static.html` and
  `static-studio.html` templates.
- `web-inventory.json`: the original complete web inventory outside `web/`.
- `closure.json`: closed publication, Viewer and relative path identities.

`closure.json` has format `exhibitos-reference-native-closure-v1` and only:
`publication: {publicationId,revisionSha256,indexSha256,manifestSha256}`,
`viewer: {sourceCommit,sourceTree,lockSha256,buildId,inventorySha256}`, and
`paths: {source:"source",web:"web",webInventory:"web-inventory.json"}`.
The exact allowed values are `R97_REFERENCE` in
`scripts/qualified-wheat-reference.mjs`.

Publication is `43684ab7-f84d-4f34-b53c-a40348c7a661`, revision
`a70f1e8a1f2230e292fa229ff89ff3248f812e539de573166cb651ed5408a64d`;
index SHA is `cbe71a2a37906a4d618d01bb1524d5f5eadcebcdca938514c82bbd3215464e42`.
Raw manifest SHA is
`8837db6e81291a57df51308263867d7d6c2e71745f91dc47d2ca41c22dba96b8`.
Viewer source is `77492e63dd360bc7982210c54f62243d4558d852`, tree
`0546058e49eaf666fc8a50a8b43a6a736befb097`, build
`b54b543b7b9f5d14a3e0ed750240c087d50baa0302209e6dd4f71a93680f27a1`.
The tool producer commit/tree must be recorded separately from this Viewer identity.

## Result and rejection behavior

The unchanged native shell refresher checks the source, exact web inputs, detail
plan and retained content. The wrapper requires identical raw manifest bytes and
all 140 raw file hashes, then adds only the existing static cache policy's
`_headers`. Hosting output therefore has **141 files**, 194755078 bytes, while the
native manifest retains 139 entries and its original SHA. The headers SHA is
`69b240e17084c040941c2b29caf997c04c7a57245ca6875be12229f8d73d39a0`.

Output uses an exclusive sibling lock, fresh staging and atomic rename. Existing
output is preserved and rejected. Missing pins, extra files/directories, links,
traversal, modified bytes, unqualified metadata, changed content and changed
headers are rejected. No count-only override is supported.

For independent predeployment inspection, `inspectDemo` accepts
`nativeClosure: {inputRoot,inventorySha256}` alongside the approved R97 index pin.
The deployment wrapper reads the same two environment variables. This does not
perform deployment or grant additional publishing authority.

## Rights and retained scope

The exact qualified publication carries current artwork rights. Greek Slave's
Smithsonian CC0 source is bound through the retained worker receipt to its
2017704-byte display SHA
`822dc25f92fa15da7a42e5bf15147fa63e8180eb4e04bf14d9998412ee1a1e15`.
The six repaired painting previews inherit their Met CC0 artwork rights.
Buddha, Winged Victory and Greek Slave model thumbnails retain the explicit
selection and subsequent publication binding; this closure performs no new
selection or rights grant. Source institutional notices and all public artifact
bytes are preserved. The only original detail assets are Wheat and OAM. Greek
original and Hayes original/preview are not added; the Hayes artwork remains
present. No unpublished original, private CMS snapshot or operational receipt is
included in this public input contract.
