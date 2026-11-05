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
