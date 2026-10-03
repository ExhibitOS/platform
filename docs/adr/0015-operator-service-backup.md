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

## Deployment artifacts (draft2)

Operator-selected local deployment files (for example an OCI archive, pinned
bundle manifest and Compose definition) are encrypted from file streams with
expected SHA-256 and size. Inputs are canonical regular single-link private
files, at most32 artifacts and8GiB each. Changed/mismatching files fail before
completion publication. Artifacts are opaque bytes: authentication does not
establish the trust, licensing, compatibility or executable safety of an image.
A trusted installer must independently validate bundle/image provenance before
import or activation; the backup reader never runs an archive.

Archives containing this separate deployment role use1.0.0-draft.2. New readers
accept prior draft1 archives, while older readers reject draft2. The supplied
maintenance image must therefore be rebuilt and qualified before Manager uses
this format; existing image receipts do not qualify the new reader. Archives
without deployment files retain draft1. Fresh restoration stages authenticated
files under deployment/ only after DB/blob inventory equality, using exclusive
file copies rather than allocating a whole image in memory. Activation and
Docker/Podman image import remain separate Manager responsibilities.

CLI configuration BACKUP_DEPLOYMENT_FILES is a JSON object mapping logical
relative names to {path,bytes,sha256}. The operator supplies expected digests
from a trusted bundle; never substitute an untrusted downloaded checksum.
The key must not be selected as an artifact. Files and key paths belong in a
private environment file, not command lines, Git or logs. Deployment image
archives, runtime credentials and decrypted candidates remain Git-excluded.
