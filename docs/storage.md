# Storage development and recovery

For the encrypted full service DB/blob tool and new environment recovery, see
[operator service backup](storage-service-backup.md) and
[ADR0015](adr/0015-operator-service-backup.md). Git bundles and portable exhibition
exports do not contain the complete administrative service state.

This package provides internal storage primitives and metadata tables. Configure one blob backend for each database; switching backends requires a verified object migration before starting workers. It exposes no new HTTP endpoint. Read [ADR 0002](adr/0002-storage-foundation.md) for boundaries and failure semantics.

Use the documented Node 24.21.0/npm 11.19.0 runtime, then:

```sh
npm ci
npm run check
npm run test:storage
```

The integration test requires a running local Docker daemon and CLI on PATH; alternatively set `DOCKER_BIN` to the CLI's absolute path. It creates UUID-named containers and volumes, binds random ports to loopback and uses generated database credentials. Teardown checks its ownership label before removing only its own resources. It never calls prune or deletes existing development volumes. Synthetic backup directories in the OS temporary directory are retained for inspection and may be removed explicitly after review.

For persistent local development:

```sh
npm run storage:init
docker compose --env-file .local/storage.env -f compose.storage.yml up -d
npm run build
# Supply DATABASE_URL through your private environment, then:
npm run storage:migrate
docker compose --env-file .local/storage.env -f compose.storage.yml down
```

The environment initializer exclusively creates mode-0600 `.local/storage.env` and refuses overwrite. Compose binds PostgreSQL and the test S3 server to loopback, retains volumes and S3 files, and pins image digests. It does not start a public deployment. Do not use `down --volumes` on existing data. S3Mock has dummy local credentials and no production authentication. Its persisted on-disk layout is not a supported long-term format; export through the object API before replacing its image.

## Backup scope and consistency

Git bundles do not contain PostgreSQL rows, Docker volumes, object bytes, credentials or `.local` data. `/storage-data`, `/uploads`, `/backups` and local secrets are ignored. Backing up repositories alone cannot restore artwork metadata or bytes.

A consistent storage backup must quiesce all writers/workers and administrators, hold exclusive advisory lock 82002 on a dedicated live PostgreSQL session, produce a custom-format `pg_dump`, enumerate all referenced object keys plus retained trash/quarantine, and copy each object while recording SHA-256 and size. Keep the lock until both database dump and byte inventory are complete. `pg_dump` alone is a consistent database snapshot, not a cross-store snapshot. External writers that do not honor this lock must be stopped. Back up credentials separately with restricted access; never put them in a public repository or object inventory.

Restore into a new empty database and a new empty object root/bucket. Verify every inventory hash/size, restore the dump, verify migration checksums, compare table counts and active object references, then run workers only after review. Never overwrite the live source. A missing/corrupt object invalidates the restore. Preserve the old installation for rollback. This task demonstrates a quiesced S3-configured synthetic database `pg_dump`/`pg_restore` to a new database and filesystem object root, with complete metadata rows and active asset hashes/sizes compared. Filesystem ingest failure recovery is tested separately; a complete filesystem backup workflow is not claimed; it does not deliver a production backup scheduler, encrypted backup service, retention policy or disaster-recovery SLA.

## Failure recovery

Retry ingest using the same tenant idempotency key and identical payload. Changed payloads are rejected. Pending outbox work retries after one second and becomes dead after five failures; operators should diagnose the object/store failure before explicitly requeueing the dead job. Never modify immutable snapshots or object bytes to make a failed job succeed.

`Storage.reconcile(actor)` detects orphan keys; `reconcile(actor, true)` requires admin membership and archives bytes plus a recovery manifest before removing an unreferenced original. `restoreOrphan(actor, manifestKey)` requires the same tenant and admin membership, checks archive identity and byte integrity, and refuses conflicting destination bytes. Trash is retained indefinitely until a future approved retention policy. Active asset source/target keys are excluded even when a job is pending or dead.

Authentication extends the maintenance contract: request/bootstrap/login writers
acquire auth lock 82003 before shared maintenance lock 82002. Membership,
assignment, session and credential changes follow this order. Private asset byte
reads retain shared 82002 while reading and verifying the object. Quiesced backup
holds exclusive 82002 only; it must never acquire 82003 while that lock is held.
Internal Storage resource methods now check enabled users and restrict artist
ownership and curator assignments; database credentials remain privileged.

## Portable OEX data in the backup inventory

Migration009 adds durable `oex_import_jobs` receipts, leases, retries, results and
cleanup inventories. Include these rows in the same quiesced database dump and
include every referenced staging chunk, pending cleanup key, and completed
`oex-import` object in the byte inventory. Stop the HTTP OEX worker before taking
the maintenance lock. Resume it only after new-environment row/key/hash validation
and review of interrupted leases and cleanup ownership. Do not discard failed
staging or job receipts merely because an exhibition already exports successfully.

An OEX file is an authorized logical exhibition snapshot. It does not include
accounts, sessions, service configuration, all CMS revision history, job receipts,
or unrelated object data, and cannot replace this administrative backup. Actual
OEX crash recovery tests do not qualify a new full-service backup scheduler.
