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
