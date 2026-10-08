# Public draft contract consumer

This repository vendors an immutable public `@exhibitos/spec` npm tarball for
Node-only development checks. Package version 0.1.0-draft.3 supports OES/OED1.0.0-draft.1 and OEX1.0.0-draft.1/draft.2; neither is stable. Provenance, bytes, SHA-256,
upstream commit and license mapping are recorded in [artifact.json](artifact.json).
The original license texts remain inside the archive and installed package.

```sh
nvm use
npm ci
npm run conformance
npm run test:contracts
```

Without nvm, put an installed Node 24.21.0/npm 11.19.0 runtime on PATH. No
spec checkout, operations checkout, token, actual artwork or Capture data is
needed. Public npm dependencies are resolved by the exact lockfile; the contract
itself is installed only from the vendored digest-pinned file. All 3 consumers run
the same 18 packaged positive/negative cases plus direct OES version/scale, OEX
byte corruption and OED unknown-field rejection tests, and the packaged CLI.

The pinned public package supplies conformance fixtures and server runtime
validation for rights, import and Studio drafts. Studio bundles public JSON
schemas and an Apache-licensed document validation adaptation without Node
file/hash APIs; its source notice and parity checks are in
[the browser validator guide](../apps/web/src/drafts/README.md). The artifact
itself does not implement the product, Capture or reconstruction. Node
conformance does not verify native Swift code, Apple API availability, device
support, signing, actual capture or worker execution.

Artifact updates require an intentional upstream source/version decision,
new tarball/hash/provenance/license review, regenerated lockfile and all consumer
checks in a fresh checkout. Never edit files inside the archive or installed
package to make a consumer pass. Breaking changes require coordinated schema,
fixture and consumer migration with compatibility evidence. Original synthetic
assets listed by upstream are CC0; other code/schema/documentation is Apache-2.0.
These licenses do not grant rights to actual user artworks or private Capture code.

OEX media draft.2 adds bounded validated read/write and PCM16 WAV without changing OES or old OEX schema/example bytes. The public release tag and downloaded artifact hash are pinned in artifact.json. Previous draft.1 tarball remains retained for rollback; reverting the dependency cannot undo imported DB/data changes.

Spatial Scripting version1 is an optional16KiB Exhibition profile. Draft.3 is pinned to reviewed development source0405a2e and draft PR8; no release tag or stable registry release is claimed. Its exact UUID semantics are compared with the portable product validator. Previous archives are retained for rollback.
