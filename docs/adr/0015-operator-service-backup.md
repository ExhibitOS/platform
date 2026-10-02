# 0015 — Operator service backup and isolated restore

Status: implementation candidate; actual qualification is recorded separately.

Full PostgreSQL dumps contain every tenant, account hashes, job histories and
immutable exhibition snapshots. They are available through a local operator
CLI, with trusted PostgreSQL operator privileges, never a tenant download API.
Authenticated current tenant administrators receive a scoped read-only
integrity report; server membership and role checks apply.

The backup session obtains exclusive advisory lock82002 before starting a
repeatable-read transaction. It exports that transaction's snapshot for
pg_dump, collects schema/migration/table/sequence/object inventories, and
rechecks those inventories before publishing a complete receipt. It never
obtains auth lock82003 while holding82002. External writers, migrations and
noncooperating workers must be stopped by the operator. This draft supports
application objects in the public schema; extra application schemas fail
closed rather than receive incomplete qualification.

The new exclusive0700 archive encrypts the dump, all object bytes (including
orphans, staging and trash), runtime files, configuration and its manifest
with AES256GCM. Each file uses a fresh random nonce, full128-bit authentication
tag and archive/relative-file-bound additional authenticated data. The32-byte
key is external to the archive. Plaintext work files exist only in a separate
private temporary workspace, removed after normal completion or failure.
Interrupted processes can leave private temporary files; these require
operator inspection and cleanup, never automatic deletion of earlier backups.

Restoration authenticates every enclosed file before target changes. It
refuses the source database identity, existing target public definitions and
nonempty target object storage. It restores into a separately created candidate,
then compares schema, migrations, every row/sequence digest, all object hashes
and reference inventory. Only a matching candidate receives a restored
receipt and named staged runtime/configuration. Failed candidates remain
inactive for inspection; the original and previous archives are preserved.

Historical expired or revoked rights remain data, not backup errors. Restored
API authorization must still deny unavailable rights. Git bundles, logical OEX
exports and browser IndexedDB each have different scope and do not replace
this administrative service backup. Cross-version PostgreSQL, production
datasets, cluster roles, external secrets and offsite media need independent
deployment qualification.

Primary references: [PostgreSQL pg_dump snapshot and trusted-source rules](https://www.postgresql.org/docs/18/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html),
[Node24 authenticated encryption](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html).
