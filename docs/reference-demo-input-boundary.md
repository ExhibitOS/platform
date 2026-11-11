# Reference demo public-build input boundary

This is an evidence-bound inventory for Platform merge
`2dd4b749321c76da654efd3d4d49cb0f3a6fa9d6` (tree
`85a6af592d28ccb5912b563be81a8c4ce82d2ec6`). Its accompanying
[`reference-demo-inputs-2dd4b749.json`](reference-demo-inputs-2dd4b749.json)
records Git tree/blob identities, Node/npm and lock pins, the 18 TypeScript
files listed for the public API configuration, publication pins and approved
output hashes. Component trees are conservative source-bound supersets, not a
complete transitive runtime graph, a release manifest or a path-exclusion list.
In particular `apps/web` and `scripts` contain shared and authoring code: their
presence in an inventory does not make all of it a demo dependency.

The current entry point is `npm run build:reference-demo`. It generates notices
and pinned Three Basis browser files, builds the shared Studio contract and
storage packages, compiles the public API validation closure, checks generated
web validators, builds the Viewer and cover companion, exports the pinned
publication and verifies/copies the approved previous bases. Public and native
build outputs use different directories, but contract/storage distributions
and generated web notices are shared in one checkout; concurrent builds need
separate checkouts. A clean checkout and complete locked public dependencies
are inputs, not a private Capture, operations, user archive or local credential.

Shared inputs that a future demo build must retain or receive as verifiable,
versioned public artifacts include:

- Viewer renderer and cover source, static/Vite configuration, public assets
  and validators under `apps/web`, plus any actual transitive imports.
- `packages/studio-contract`, `packages/storage`, the vendored
  `@exhibitos/spec` `0.1.0-draft.17` tarball, schemas and validation assets;
  TypeScript `6.0.3`, Vite `8.3.1`, Three `0.186.1`, the package lock and
  workspace metadata. The 18-file API list is TypeScript's list for this
  configuration; type dependencies and runtime imports are not identical.
- The Platform root `LICENSE` (AGPL-3.0-or-later), the exact Platform source
  reference, the generated `THIRD_PARTY_NOTICES.txt`, and original third-party
  notice and provenance inputs. Their Git objects are in the adjacent record;
  generated output is also covered by the approved export manifest.
- Export/source/copy-base/cache-policy/notices scripts, the approved furnishing
  catalogue and notices under `assets/furnishings`, and dynamic
  `validation-worker`/`viewer-variant-worker`. Basis transcoder JS/WASM and
  loader hashes come from `vendor/notices/basis-provenance.json`; the worker
  resolves Three at runtime and cannot be inferred from the TS graph alone.
- `demos/reference-exhibition/publication.json`, pinned source bytes,
  `previous-copy-bases.json` and their archive inputs. Keep all 10 prior bases,
  their rights checks, approved assets and license notices. The record names
  Git object IDs for the entire demo input tree rather than copying its bytes.

The demo output is not the entire source inventory. PR364 was built with
`apps/api/dist` absent and its 128 exported files matched the previous approved
build byte for byte. Index SHA-256
`2e7174ff9cd805a5e72bf084adda8a6e9169696a214d74052b052547e73fd6fd`;
manifest SHA-256
`2ee42fbd5db4244789f53e7fd90616be6329ae2148dd95b137cc89704f7ed07d`.
The approved baseline deliberately includes `studio.html` and private editor
chunks (`EXHIBITOS_PRIVATE_EDITOR=1`). Preserving those bytes does not establish
an authoring-free public artifact or a Manager/Viewer source separation.
The resulting natural provider build and current public pins were also observed
matching. The local receipts and this inventory are evidence for that exact
source. A subsequent clean source projection on macOS installed from the local
npm cache with network access and other selected worktree/user-data reads
denied, built without the native API dist, and reproduced all 128 files. Five
focused public-mode cover, furnishing, rights and Basis/KTX2 positive/negative
tests passed. The local verification receipt, which is not part of the public
repository, has SHA-256
`75b814543e4713da0a83582973294c2d919d61807a7c491570758a2325170a57`.
A later repeat of the selected file-read and network-denial probes is recorded
in its local `boundary-check.log`, SHA-256
`8353957b70c7afcf401fad47ec258e6fbc299d46d36a4ae2e8019840e48f601a`.
This macOS sandbox allows OS files and the pre-existing toolchain/npm cache to
be read, has no syscall audit of caught failures, and is not a Linux container.
These receipts do not establish every dynamic branch, a complete source
allowlist, Linux reproducibility or a verified independent deployment.

For a later demo repository, evaluate both a demo-owned orchestration pinned to
the exact public Platform commit and its verified inputs, and a versioned public
Platform-produced bundle with its source revision, complete dependency/asset
inventory, licenses and integrity hashes. A bundle boundary has not yet been
implemented or reviewed, and this inventory does not authorize copying all of
the conservative trees. Keep the existing shared renderer/contract source and
Platform history in place. Do not change the current source connection or pins until a clean
checkout of the candidate exact versions reproduces the approved output,
cover/worker/codec/furnishing negative cases pass, and an independent preview,
trigger and provider-specific rollback are verified. Existing Cloudflare
trigger update documentation does not establish that changing a Git repository
source is atomic; the provider owner must verify the actual connection and
rollback path before any cutover.

## Exact r69 dual-original source

The existing reference assembler also recognizes the reviewed r69 v4 index
`7d77d80637fbd1e3354ad142fdedee5a6f7af0f08c6a4daaec96bb253c90e475`.
It retains both typed acquired-original candidates (Wheat JPEG and Old Arrow
Maker GLB), the canonical model and its explicitly selected PNG thumbnail.
Every referenced file is verified against the closed index and immutable
publication pins, including both original hashes, candidate bindings and rights.
This does not authorize an arbitrary caller-supplied v4 publication.

An approved external source bundle can be supplied with
`EXHIBITOS_QUALIFIED_REFERENCE_SOURCE=/absolute/qualified-static-bundle npm run build:reference-demo`.
Its `static-publication-index.json` must match an admitted immutable reference;
the source remains read only. Without this explicit input the existing r67
fixture remains the default. The build uses the current trusted runtime and
reconstructs the official session-only editor decoration, rather than copying
the native bundle's persistent private-editor HTML. Museum media can remain in
the separately approved complete asset bundle instead of the Platform code
commit. Keep that bundle and source/configuration pins with the delivery record
so the same local or approved CI build is reproducible.

The r69 Wheat binding reuses the same previously measured image bytes, cost,
viewport and runtime constraints. Its new publication/candidate/source binding
identities do not broaden device qualification. Native output qualification,
current Viewer/gallery/thumbnail consumption and actual public deployment are
separate stages.
