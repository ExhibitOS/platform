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
The exact allowed values are `R97_REFERENCE` (original b54b rollback) or
`R97_MOBILE_REFERENCE` (approved production mobile policy) in
`scripts/qualified-wheat-reference.mjs`. Both retain the same publication, index
and base native manifest; only their independently pinned web target differs.

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

The unchanged guarded native shell refresher checks the source, exact admitted
web inputs, detail plan and retained content. The wrapper independently derives
the complete refreshed inventory with that same pure HTML generator and requires
its raw manifest and count to match before adding the existing session setting.
It inserts exactly one `<meta name="exhibitos-demo-decoration" content="session-v1">`
before `</head>` in each emitted `index.html` and `studio.html`, updates only
those two refreshed manifest entries, and emits a separate hosting manifest.
This selects the existing Viewer session editor with no browser-copy storage.

The original input manifest remains `8837db6e…`. All 103 content entries, including
the exact index, publication, detail bytes and editor catalogue, are unchanged;
web bytes match only the exact selected approved target. The existing cache
headers SHA remains
`69b240e17084c040941c2b29caf997c04c7a57245ca6875be12229f8d73d39a0`.
Both outputs have 141 physical files and 139 hosting manifest entries.

| Target | Closed input integrity SHA | Refreshed raw manifest | Hosting manifest | Output bytes |
| --- | --- | --- | --- | --- |
| b54b rollback | `823b6d8f4ee85ad82270413ac30f3a9fb093479ae5d85e386ad97146b63dea8c` | `8837db6e81291a57df51308263867d7d6c2e71745f91dc47d2ca41c22dba96b8` | `b6c1bd0277e2f453646d0f0640f91889e17fb4b10e31c5b8fa45bb95879613a6` | 194755198 |
| Mobile production | `53f8e3091baa1f19e37b5d1622f1a520d02e70c6f801e9f4707b6df0fbd5ffdb` | `ceb880c397538b2f7abe931265e5d0ed8c6f2e63e9f8747c12c753bdced8146e` | `6261737a2b5a8852e9f8eb07cedf13c7a332f34149a6ab6c10de2c84697045a2` | 194755758 |

For the mobile production bundle, use the same build command above with its
integrity SHA. Its built Viewer source is
`cdf4728c0e568b2852f95fc4b2542b28e7cf2068`, tree
`9fa86180ffddf3d810fbc9266626f8c7e22d15a2`, build
`776bfe96635d1251ba49a405f458e72954551bc187a2cd398387fba48e84b71f`,
and web inventory
`be3e36e385d100e18676350243d52fc4331127b42c1bd96c9a394011e3068c20`.
PR612 merge `03b444bc9f28e8b3937d24fc26e492d46dfd0546` has that same tree;
it is recorded separately from the already built source identity. This is the
ordinary production policy with diagnostics off, not the experimental staging
build. Existing accepted physical observations are reused within their bounded
scope; this composition proves bytes and configuration, not physical memory or
whole-tour behavior.

Output uses an exclusive sibling lock, fresh staging and atomic rename. Existing
output is preserved and rejected. Missing pins, extra files/directories, links,
traversal, modified bytes, unqualified metadata, changed content, missing/changed session markers and changed
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
