# Consumer conformance evidence — platform

This section records the historical draft.1 qualification. The current runtime
uses the immutable draft.2 pin in artifact.json; its OEX media qualification is
recorded in docs/oex.md and the OEX result document when accepted. Draft.1 remains
a compatibility fixture, not the current runtime dependency.

Date: 2026-10-01. Implementation source: `953ba56` on
`codex/contract-consumer`. Environment: macOS 26.2/build 25C56, Darwin 25.2.0 arm64,
Node 24.21.0/npm 11.19.0. Package/contract stability remains draft.

## Immutable public input

- Package: `@exhibitos/spec@0.1.0-draft.1`; format contract 1.0.0-draft.1.
- Source: public spec commit 8ee5741860b626448dcba0c82657de6621e1c058.
- Tarball: 66,715 bytes, SHA-256
  `8d0c41c8d787a612fcf38b80589e9225e8458b611cce36419987b503df4aeaec`.
- Upstream tag is not yet created; the proposed tag is recorded without claiming
  it exists. License mapping and the original tarball name are in artifact.json.
- The tarball and its SHA-qualified vendor path are pinned in package-lock.json
  as a development-only local-file dependency. All other dependencies come from
  the public npm registry and retain their original notices.

## Actual validation

All 15 shared cases passed with valid=true and errors=[] in this repository.
Eight consumer tests passed: installed package/version/license identity, exact
shared corpus coverage, OES positive plus unknown-version/scale rejection, OEX
positive plus byte-corruption rejection, OED positive plus undeclared-field
rejection, packaged CLI, tarball byte-corruption SHA gate, and all 5 documented
JSON schema imports with import attributes.

This implementation was cloned independently into a temporary path. The clean
checkout had no node_modules, operations, spec checkout or private implementation.
Using an environment cleared with `env -i`, two distinct empty user/global npm
config files, and no credential variables, `npm ci`, `npm run check` and
`npm run conformance` all passed. The install used populated integrity-checked
public npm cache artifacts in explicit offline mode; it does not claim an empty
cache can install offline. On a new machine, ordinary `npm ci` fetches the public
registry dependencies and uses the vendored contract tarball locally.

```sh
nvm use
npm ci
npm run check
npm run conformance
```

An isolated invocation may set `npm_config_userconfig` and
`npm_config_globalconfig` to two different empty files. npm refuses loading the
same path (including /dev/null) as both configs. No home variable needs changing.

Platform-specific checks: fresh clone `npm run check` passed app/tooling typecheck,
ESLint, 3 API/web unit tests, production build and all 8 consumer tests. All four
production web file SHA-256 values matched the pre-consumer baseline, so the
Node-only contract tooling did not enter the browser bundle. An E2E attempt in
the nested workspace timed out while its watch server repeatedly restarted;
no product source was changed to mask this. A short independent temporary clone
ran all 3 E2E checks successfully on the preceding candidate. The corrected
artifact changes JSON exports/development tooling only; coordination performs
final-head E2E after these PRs are reviewed to avoid concurrent port use.

## Limits and recovery

These checks verify the public draft boundary and synthetic fixtures only. They
do not implement Studio, authenticated APIs, import jobs, real Capture, workers,
production export, user rights grants or device support. No paid resource,
private artwork, proprietary fixture or native implementation was used.

An unreleased initial candidate was superseded before PR merge after an installed
schema export bug was discovered and corrected upstream. Consumers now validate
all documented aliases against the corrected immutable artifact; no archive or
installed package content was edited to bypass validation. Updates require
intentional new provenance/digest/lockfile and consumer regression evidence.
Source changes are reversible by an ordinary reviewed revert.
