# Public draft contract consumer

This repository vendors an immutable public `@exhibitos/spec` npm tarball for
Node-only development checks. Package version0.1.0-draft.1 and format contract
version1.0.0-draft.1 are distinct; neither is stable. Provenance, bytes, SHA-256,
upstream commit and license mapping are recorded in [artifact.json](artifact.json).
The original license texts remain inside the archive and installed package.

```sh
nvm use
npm ci
npm run conformance
npm run test:contracts
```

Without nvm, put an installed Node24.21.0/npm11.19.0 runtime on PATH. No private
spec checkout, operations checkout, token, actual artwork or Capture data is
needed. Public npm dependencies are resolved by the exact lockfile; the contract
itself is installed only from the vendored digest-pinned file. All3 consumers run
the same15 packaged positive/negative cases plus direct OES version/scale, OEX
byte corruption and OED unknown-field rejection tests, and the packaged CLI.

The package is a development dependency. It is not imported by any browser or
service runtime and does not implement Studio, iOS Capture, reconstruction or
production import/export. Node conformance does not verify native Swift code,
Apple API availability, device support, signing, actual capture or worker jobs.

Artifact updates require an intentional upstream source/version decision,
new tarball/hash/provenance/license review, regenerated lockfile and all consumer
checks in a fresh checkout. Never edit files inside the archive or installed
package to make a consumer pass. Breaking changes require coordinated schema,
fixture and consumer migration with compatibility evidence. Original synthetic
assets listed by upstream are CC0; other code/schema/documentation is Apache-2.0.
These licenses do not grant rights to actual user artworks or private Capture code.
