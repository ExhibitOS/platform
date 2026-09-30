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
- Toolchain and validation commands are not yet established. The foundation
  task will pin versions and document commands here and in the README; until
  then, report exactly which applicable checks were actually run.

## Handoff

Record changed behavior, why it changed, checks and their results, known
limitations, and compatibility impact. Implementation coordination records live
in operations; product builds must not depend on those records.
