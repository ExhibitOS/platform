# Restored-context development runtime exercise

The operator driver `scripts/test-restored-runtime-schema.py` optionally accepts
`--runtime-image sha256:<immutable image>` together with `--expected-target-schema <catalog hash>`. Independently authenticate and inspect the complete OCI and SQL
identity before importing the image into the local development cache. This mode
runs the actual embedded runtime and storage packages from that image; it does not
overlay their compiled code. Only the trusted host exercise/qualification scripts
and exact original SQL prefix are mounted readonly.

The driver copies the complete stopped original PostgreSQL cluster into bounded
256MiB tmpfs and reads source blobs/configuration readonly. The runtime uses its
own bounded copies of those files. After original inventory verification, target
SQL migrations execute, the actual API/web start, health and three readiness
observations succeed, and runtime shutdown completes. Full target catalog and
original rows/sequences/history/blobs are verified afterward. File copies and
original source configuration/blobs must still match exactly.

The scratch database's SQL maintenance fence is released only during runtime
startup/execution because legitimate runtime recovery takes shared maintenance
locks; it is reacquired after shutdown before catalog/preservation observation.
The trusted adapter must exclude other scratch writers. This is not a claim of a
spanning SQL lock, global privileged isolation, Manager update admission,
selected-host activation, or failed-update/cold/crash/Windows recovery. Its receipt
keeps compatibility/preflight/update flags false. Failed fixtures and originals
are retained; successful helper metadata is captured before bounded tmpfs cleanup.

## Selected native OEX validation payload

`scripts/package-native-runtime.mjs <destination> <config.json>` creates a local
validation payload. Set `normalOexSelected: true` in the configuration to include
the pinned Spec artifact and the selected native OEX supplemental migrations and
capability declarations. The destination must be new. This payload is not a
signed or distribution-qualified release.

To build from a pinned `ExhibitOS/default-furnishings` release, set
`defaultFurnishingsRoot` to the absolute path of its offline checkout. The
producer verifies the checkout commit, manifest hash and each supported model
and notice against the pins in `scripts/package-native-runtime.mjs`. A
mismatched release fails packaging. Installed runtimes use the bundled files
offline. Omitting the option retains the four Platform-source defaults.

Release `v1.1.0` retains the four `v1.0.0` entries and includes the black
aluminum artwork frame for runtimes with
`workspaceFurnishingArtworkFrameModelsSelected`. The runtime copies its
renderable model, CC0 notice and acquired original into the sealed payload.
Only the renderable model is used for display. The release records recipe
provenance. In Manager, the frame appears in the ordinary artwork-frame
list and uses the existing attachment rules for a planar 0.6 × 0.8 m image. Its
installed catalog UUID is independent of any workspace intake. The prior
`v1.0.0` input remains usable for the four existing defaults.

For a newly provisioned empty workspace, the authenticated native owner can select
`normal-oex-028-v4`; the runtime applies the exact 026–030 supplemental migrations
in the same fenced transaction. The separate 030 concrete capability identifies
its parent 028 capability, migration digest, `fine-gallery-concrete` version 1,
and the notice, color, roughness, and normal roles. Existing resource validation,
rights, immutable rows, and workspace ownership remain in force. Capability files
are inventory declarations, not authorization to start an operation.

Normal startup recognizes exact existing 026–029 and 026–030 catalogs without
rewriting their ledgers or upgrading an existing workspace. The 030 capability is
fresh-only; it does not imply that an older installation has acquired the new
admission. A Manager using a new payload must verify its exact source, manifest,
producer, capability and migration identities, and check the applied ledger
before relying on that admission. Older payloads and their pinned identities remain
separate. Actual import, Studio save, export, and Viewer consumption require their
own execution evidence.

### Ordinary furnishing admission

The proposed local native furnishing path accepts only a live, authenticated
Manager admission tied to the issued writer lease and the selected payload.
`fresh-empty` is restricted to initialization; `clean-reopen` and
`verified-restore` use the reopen path. The workspace transaction takes the
exclusive maintenance fence and rejects any retained furnishing worker token
before owner changes. It never clears unknown claims as part of ordinary
startup. Manager owns the durable clean-completion and verified-restore proofs;
new owner traffic or an available lock alone does not establish them.

This source change does not qualify an existing package or enable a release.
The updated exact source needs its own reviewed package and paired Manager pins,
then normal start, stop, reopen and restore qualification. The previously
excluded native EOF/runner exercise remains skipped; no owner-loss or physical
worker-drain claim follows from the admission handshake or synthetic tests.
