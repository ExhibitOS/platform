# ExhibitOS Platform agent guide

## Scope

This repository owns Studio, CMS, Viewer, Runtime, HTTP API, and realtime services.
Public format contracts belong to ExhibitOS/spec. Manager lifecycle clients and
deployment adapters belong to their respective repositories.

## Work rules

- Read the repository README and relevant architecture decisions before changing code.
- Preserve existing user changes. Work on `codex/<task>` branches and report the
  commit or pull request with actual validation results.
- Keep builds independent of private Capture implementations and operations.
  Do not add private submodules, private package dependencies, or CI checkouts.
- Use synthetic or explicitly redistributable fixtures. Never commit original
  artwork, Capture datasets, access tokens, signing keys, or local credentials.
- Keep changes aligned with the assigned task. Do not describe plans or
  scaffolding as completed product features.
- Implement and verify authorization on the server when adding protected
  resources; hiding client controls does not enforce permissions.
- Use Node24.21.0/npm11.19.0 (`.nvmrc`), `npm ci`, `npm run check`, and
  `npm run test:e2e` as documented in README. Report actual results and limits.
  Hosted CI remains gated on verified billing; do not enable automatic triggers
  or dispatch paid/unknown-quota runs without resolving that gate.

## Licensing

Project code is AGPL-3.0-or-later; assets have independent rights. Preserve
third-party notices. When adding bundled browser implementations, update
`scripts/write-notices.mjs` and verify the production notices artifact.

## Handoff

Record changed behavior, why it changed, checks and their results, known
limitations, and compatibility impact. Implementation coordination records live
in operations; product builds must not depend on those records.
