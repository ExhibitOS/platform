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


## First-release scope decision, 2026-10-15

The user replaced the previous broad first-release and iPhone-final processing direction. First release: iPhone Capture originals/optional reduced check → Mac Swift RealityKit final Processing → Mac Studio/CMS publication; Mac Manager lifecycle/recovery. Viewer implementation targets Safari/Chrome, officially qualified on macOS/iOS only after actual tests. Windows/Linux Chrome remain compatibility candidates; native apps, Android Capture, iPhone final/Node reconstruction, general multi-cloud deployment, XR/Federation and advanced institutional integration are deferred. Reuse existing Node contract/output/backup tools. Preserve all prior source/results/raw data/keys/backups. Do not reinstate deferred scope as a first-release gate without another user request.
