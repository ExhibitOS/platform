# Hosted service backup connection — implementation boundary

This T10-05 increment provides a **private adapter**, not a complete Manager
remote recovery feature. Real Render permissions, quiescence, dump, encrypted
backup, independent restoration, migration, update and rollback are unqualified.
No remote resources have been read or changed by this increment.

## Implemented

`scripts/remote-backup-worker.mjs` accepts only an operation and canonical local
paths. Input never accepts `quiesced`, a database URL, a binary, a PG environment,
a profile role or a target-isolation assertion. The standalone command refuses
with `REMOTE_BACKUP_EXECUTOR_REQUIRED`; native integration must supply a fixed,
trusted executor through the imported function.

A source executor must implement `withQuiescedSource(callback)` and invoke the
callback only while its source fence is held. The callback receives the selected
Render external connection in memory. The worker requires the Render external
host shape and certificate/hostname verification (`sslmode=verify-full`), and
constructs a small fixed environment. It does not inherit user PG overrides,
select an arbitrary executable or invoke the existing container adapter that
rewrites `PGHOST` to loopback.

The worker calls existing `service-backup.main(argv, environment)` to create,
then authenticate the encrypted archive in a separate fresh workspace. It checks
the authenticated manifest's backup ID and returns only the backup ID, file
count and authenticated manifest SHA. No transport credentials, provider tokens,
admin passwords or signing keys are added to archive configuration. The existing
physical source identity, exported snapshot, lock, inventory and authenticated
encryption remain unchanged.

Restoration requires `withIsolatedDestination(callback)`. A remote target retains
verified TLS. The existing local non-TLS policy is accepted only for a callback
connection explicitly bound by the native executor to its owned isolated local
profile, a canonical UUID, verified isolation and the exact observed port, with
literal `127.0.0.1` or `::1`. These are private executor facts, not serialized user
authorization. Missing logical isolation is refused. The native guard must remain
held through the existing fresh/empty-target, original-identity refusal and
complete inventory verification. Callback fields are **not** a cryptographic
certificate or a new backup/public-file format.

## Required native connection; not yet implemented

1. The Manager coordinator must bind its existing selected hosted-work record,
   provider token, runtime/image pin, local path selection and operation lock.
   `hosted.rs` already demonstrates `env_clear()` plus bounded stdin/outputs.
   The future fixed recovery runner can reuse its bundled Node and vendored
   deployment adapter without returning a connection secret to the renderer.
2. The deployment private recovery bridge must observe the selected service
   suspended, its owner/free-plan/DB binding, nonexpired DB, explicitly confirmed
   narrow external CIDR, TLS and operator confirmation that other writers have
   stopped. It performs GET only. No routine may infer global quiescence merely
   from suspension. Stop/status/retry/resume coordination remains to be connected.
3. Its in-process `consume` callback should launch the **native-verified pinned**
   maintenance image using a fixed Docker command and script. Transfer the URL
   only on the child's private stdin, not Docker arguments, general env files,
   logs or a public result. Inside that immutable image, a fixed script imports
   `readRemoteBackupInput`/`runRemoteBackup`, supplies the already-authorized
   callback executor, and invokes the existing core. `Dockerfile.maintenance` now includes fixed COPY entries for the worker and
   entry. An immutable image has not been rebuilt/verified, so the route is not
   deployment-qualified.
4. Reuse lifecycle `maintenance::input_path`,
   `restoration::{directory,private_bytes,fresh_root}`, `LifecycleService::lock`,
   `begin_maintenance` and the bounded `run_observed_stream`/owned-helper
   cancellation pattern. The currently named
   `run_maintenance_helper_with_input` is Windows-only; it must not be claimed
   as an available macOS entry. A narrowly shared implementation may reuse its
   existing private-input semantics on macOS after review.
5. Reuse fixed image inspection/never-pull, fresh candidate ownership labels,
   `restoration_network::choose` and `verify_observed`. Do not modify the running
   installation. Existing local restoration does not publish the database port;
   its stored HTTP port is not a DB port. A smallest candidate connection can use
   a helper in the verified candidate DB's network namespace, where a literal
   loopback and observed PostgreSQL port belong to that isolated candidate. Such
   a command must be bound to the exact native-owned container ID and labels,
   not accepted as a user-selected network argument. This has not been run.
6. `LifecycleService::restore_backup` is not a drop-in consumer for a hosted
   service archive: its authentication phase requires local Manager installation
   files and image-layout records. Reuse the lower guards and existing core
   restore instead of fabricating those files. Preserve source role/ACL semantics;
   do not silently add `--no-owner` or `--no-acl`. Prepare required candidate roles
   before restore using the existing operator-owned candidate path. Keep the
   source and failed candidate inactive/preserved on failure.
7. After actual restore/inventory equality, connect existing migration checks,
   runtime readiness/auth and explicit activation. A Render deploy rollback does
   not restore its DB. Actual interruption/update/restore/rollback evidence is
   still required; this module's mocked tests do not replace it.

## Verification scope

Node24 focused unit tests: eight private-worker cases, four fixed-image entry
cases, six deployment-bridge cases and six Manager runner cases pass. Worker tests inject an existing-core stand-in; deployment tests use
synthetic HTTP responses. They establish guard routing, fixed environment,
secret-free error/results and no automatic remote mutation. They do **not** run
SQL, pg_dump, TLS handshakes, encryption, native execution or a real restore.
Existing core tests/evidence retain their original source/environment scope.

## External conditions

Render's default created source here has `ipAllowList: []` (internal only).
Automatic allow-all access and third-party public-IP services are not introduced.
If an approved narrow CIDR cannot be derived reliably with the two providers,
the user must add that range in the official Render screen. Actual function,
namespace and snapshot permissions must be read from the selected account before
claiming compatibility; non-superuser status alone does not prove that
`pg_control_system()` is unavailable. The physical identity guard is preserved.

Free Render Postgres expires after 30 days, with access stopped at expiry and a
14-day upgrade grace period before deletion. It has no managed backup/PITR, but
Render documents local external `pg_dump`. One active free DB per workspace
prevents promising a second simultaneous free remote clone. No recurring free
renewal, paid upgrade or source deletion is automated. No actual expiry date was
queried in this increment. Static Pages viewing remains independent.

Official sources, checked 2026-10-18:
[Free limits](https://render.com/docs/free),
[logical backup/export](https://render.com/docs/postgresql-backups),
[external connections](https://render.com/docs/postgresql-creating-connecting),
[empty IP list](https://render.com/docs/blueprint-spec),
[connection-info API](https://api-docs.render.com/reference/retrieve-postgres-connection-info),
[rollback semantics](https://render.com/docs/rollbacks).

## Persistent data and signing identity audit (source only)

A full database archive is sensitive even with provider configuration excluded.
The schema stores account password hashes/salts and institution/session token
hashes; `auth_sessions.csrf_token` is stored as an actual application CSRF token.
These remain part of the authenticated service inventory, not silently removed
to make a “secret-free database” claim. This increment did not inspect any row
values. Arbitrary authored JSON/blob contents also cannot be certified free of
user-supplied secrets from a schema review alone.

No dedicated schema column in migrations001–015 stores Cloudflare/Render API
tokens, the transport DB password or the freeze private signing key. Current
hosted code keeps provider tokens and its workspace/project-specific runtime
configuration in macOS Keychain (`org.exhibitos.manager.hosted`), and sends
runtime secrets to Render service env. DB connection credentials come from the
private connection-info API; they are not the application's auth password hash.
A normal database-only pg_dump does not export cluster role-password records.
This distinction does not establish absence of secrets from arbitrary row data.

`render-runtime.mjs` requires DATABASE_URL, ADMIN_PASSWORD, TENANT_ID,
FREEZE_SIGNING_KEY_BASE64 and origin/client-origin configuration. It derives the
freeze runtime from the installed `apps/web/dist`, so the hosted runtime does
not require FREEZE_RUNTIME_ROOT. Existing freeze runtime/OEX bytes, signatures,
public-key authority and immutable snapshots are stored in hosted_objects plus
the DB inventory. The source private signing key itself is used in process;
freeze rows carry public verification authority/signatures, not that private key.

`Freezes.validSignature` requires the original authority public key, key ID
**and origin**. Recovery must read the existing workspace/project Keychain entry
without creating/replacing it, or recover the existing Render env secret under
the authenticated native provider boundary and match its derived public key to
the preserved authority. The existing `runtime_configuration` creator must not
be called as a fallback when the recovery key is missing: it can create a new
key. A new random key or localhost origin cannot be presented as restored old
signing authority. Existing public static Pages bytes remain independently
viewable; restoring DB bytes alone is not signing/runtime recovery.

For an isolated drill, verify stored signatures with their preserved public keys
and use the original logical authority while keeping actual sockets private.
Before reactivating the same Render service, preserve its confirmed original
origin/key and update only the explicitly selected restored DB binding. If both
Keychain and existing Render env signing key are unavailable, report signing
recovery blocked; do not include the private key in the archive contrary to the
hosted secret policy, automatically rotate it, or claim full recovery. Provider
reconnection/key access and any necessary recovery decision remain user-return
conditions. No secret values were read for this audit.

## Exact next runner wiring

The native job/UI integration below is a connection plan. The fixed Manager Node runner and maintenance image entry now have source and synthetic checks, but no immutable image has been built or executed for this increment:

- A native `hosted_recovery` operation should load the existing safe hosted-work
  target and hold the current path/profile/operation guards. It must not call
  `restore_backup` with a fake local-installation manifest.
- A fixed Manager Node recovery runner can import its already-vendored deployment
  `withRenderRecoveryConnection`. That function's callback is the source
  capability; it runs only after the actual selected Render metadata and operator
  acknowledgement checks. The callback launches the fixed maintenance image's
  worker with credentials on its **private child stdin**. This private input is
  distinct from the public operation/path-only request.
- The immutable helper script must construct the callback executor itself. It
  cannot accept an executor role, `isolationVerified` or a `quiesced` boolean from
  renderer JSON as authority. For a local target, UUID/port literals in that fixed
  script come from the native guard's observed owned candidate, not an arbitrary
  caller-selected profile. Native must check the exact container/image/labels
  and retain the same guard until child completion. Only its private connection
  bytes cross stdin; no password/key appears in the fixed script arguments.
- For the local drill, the helper may join that exact verified candidate DB
  container's network namespace and use its observed loopback port. This avoids
  publishing a DB port or confusing the existing profile's HTTP port with a DB
  endpoint. That network argument must be generated from the observed immutable
  container ID, never from input. It is not yet implemented or qualified.
- The native process can reuse the `cancellation.rs::run_observed_stream` bounded
  stdin mechanism and existing maintenance checkpoint/owned-helper cancellation
  semantics through a narrowly shared macOS wrapper. `hosted.rs`'s short API
  process timeout is not a suitable implicit backup deadline: preserve existing
  service-backup limits and its cancel/uncertain-result semantics in the new
  explicit operation rather than claiming it is already connected.
- Authentication/readiness/restore activation remain separate from archive
  creation. No successful callback or mocked unit authorizes a live service
  restart, DB switch, migration, provider rollback or deletion.

## Fixed image entry and runner source increment

The fixed `remote-backup-entry.mjs` takes only private connection/key/budget
bytes from the native-owned runner. It creates the ephemeral key in a dedicated
`/run/exhibitos` tmpfs and invokes the existing core within native-owned private
`/work` volume storage. Work is not an unbounded RAM filesystem: a large dump,
archive and authenticated plaintext could exceed memory. The entry uses no
caller paths/scripts/role/quiesced flags. After core creation and authentication,
it transfers only existing ciphertext/markers to fresh `/output/archive`,
streams/readbacks hashes in bounded chunks and publishes `complete.json` last.
It never copies plaintext manifest, dump, configuration or key onto that bind.
Failure preserves the partial archive/work; it removes only its own ephemeral
key inode. Native must still enforce the exact image/job/volume/mount/endpoint
binding and host-private output permissions.

The private `maxDumpBytes` is native-budget derived, at least1MiB and no more
than the pre-existing32GiB dump cap; it can only lower that cap. Native removes
its6GiB floor and64MiB metadata allowance **once**, then provides private
`jobBudgetBytes`. The existing create snapshot wrapper sums the exact validated
`inventory.objects[].bytes` (B) in the same repeatable-read transaction and sets
`Dcap = min(nativeMaxDumpBytes, floor(jobBudgetBytes / 4) - B)`. Unsafe totals or
less than1MiB for the dump fail before dump/object writes. No separate live SQL
estimate or compressed-dump ratio is treated as object-space proof. Normal CLI
arguments/defaults, inventory/identity/snapshot/crypto and archive format remain
unchanged; this budget uses only a private third options argument to `main`.

The fixed helper sets `TMPDIR=/work` so the existing core scratch uses its owned
volume, rather than the256MiB `/tmp` tmpfs. Core removes scratch after create,
before authentication: create peaks around2(D+B), verify around2(D+B), and host
ciphertext copy around3(D+B). Four copies are a conservative bound, not a claim
that four plaintext copies coexist. Metadata reserve covers the existing bounded
manifest and per-file encryption overhead. Unrelated disk consumption, actual
Docker volume placement/free-space and real hosted data still need native/remote
qualification; synthetic arithmetic is not an actual space-availability proof.

Current archive adapter scope is DB plus all objects, including previously
frozen runtime objects. It does not automatically capture the active Render
source/build, original Pages package or signing key. Runtime/release identity
must be matched to trusted pinned artifacts before using the existing optional
runtime/deployment roles or preserved release flow. Do not label the current
maintenance image's runtime as the old deployed server's runtime without that
matching evidence. The end-to-end recovery/update/rollback objective remains.

## Existing command integration and next local qualification (not executed)

`test:service-backup` now runs the two focused Node regression files after the
existing build and before the unchanged actual service-backup suite. Vitest's
existing apps/packages TypeScript include does not discover these scripts. The
closed Docker context allowlist includes exactly the worker and fixed entry in
addition to the pre-existing service-backup script; tests and arbitrary scripts
are not added to the maintenance build context.

Next local qualification is a plan, not evidence: build a unique immutable
maintenance image from this source and inspect architecture and script hashes;
reuse the synthetic PostgresBlobStore corpus/migration and owner-labelled isolated
PostgreSQL18 backends; use a private fixture CA and a TLS server whose certificate
SAN matches a closed-network Render-shaped alias. Test-only read-only trust mounts
and Node extra-CA startup configuration permit the **same** production image's
verify-full/hostname validation without contacting Render or weakening production
TLS/URL guards. Those extra test mounts do not qualify the exact native launch.
No existing TLS fixture was found, so fixture CA/server setup remains to be written
and reviewed before execution. The production Docker command is unchanged.

Run fixed-entry create/authenticate/output copy with private synthetic stdin,
confirm ciphertext-only output and no key/plaintext host export, stop the source,
then reuse existing service-backup CLI fresh-target restore and compare complete
schema/table/object hashes and distinct physical identity. Existing wrong-key,
corruption and occupied-target conditions remain. Only unique fixture-owned
resources may be cleaned according to existing owner-label guards. No original
runtime, provider service, DB, image, key or user backup is deleted. Local TLS and
real cryptography do not establish actual Render account/role/IP/expiry behavior,
Manager restart/cancel correctness, original signing-origin recovery or complete
migration/update/rollback. Heavy execution awaits the coordinator's slot.

### Encrypted and authenticated manifest hashes

The original complete receipt's `manifestSha256` is the encrypted `manifest.gcm`
SHA. The worker's `authenticatedManifestSha256` is the decrypted, authenticated
`manifest.json` SHA; these are intentionally different. The fixed entry compares
complete.json with the actual ciphertext copy/readback SHA and retains the
plaintext authenticated SHA in its safe result. Regression fixtures now use two
different hashes and reject ciphertext mutation before publishing complete.json.

### Fixed image trust bundle correction

Actual local qualification built and inspected immutable image
`sha256:c21c33eed4f83d8bc7eaae13c68d72c417fe35e36c1e01bee1f9270d166f708e`
from source0c8612f, but then failed because its expected system CA file did not
exist. It did **not** reach SQL backup/verification/restore. The earlier fixture
CN length failure and both failed receipts/images/certificates remain preserved.

The source now exports pinned Node24.21.0 `tls.rootCertificates` during build,
validates each CA, and copies the PEM into the final image at
`/etc/ssl/certs/ca-certificates.crt`. The generated maintenance-ca.json records
Node version, count and PEM SHA. No CA network download, user trust input, apt
installation or custom production root is added. The image's fixed SSL_CERT_FILE
also appears explicitly in the worker's closed verify-full child environment;
PGSSLROOTCERT=system and hostname verification remain required. Node's original
license is retained with a separate Mozilla provenance notice and complete MPL2
text. The notice cites the verified upstream sources; this is not a claim that
Node's main license alone covers every CA source-license requirement.

Local Node24.21.0 export check observed121 certificates,181305 PEM bytes and SHA
`1f20173c6c5bd4e836fbd5d025ec4eb7464e1521439cde2fea0aca3122c7a1a9`.
The actual corrected image must still be built and its exported bundle/count/SHA
checked; the local binary check alone does not establish image or Render TLS
success. Existing certificates should be reused in the next local continuation.

### Actual closed local TLS / SQL / encrypted archive qualification

The coordinator's run17277 completed with `LOCAL_TLS_SQL_CRYPTO_RESTORE_PASS`:
source302bb52, immutable arm64 image
`sha256:e14e5267fe2a1a705caee87000abfaa1e4035b8f3fb5d3c2cf6ebbf9d1d69dee`.
The corrected image's three helper-script hashes and121-root CA bundle were
checked against the fixed source/export metadata. This used synthetic local
PostgreSQL18 plus same-DB objects, not a Render account or production database.
The fixed entry created and authenticated the real encrypted dump/object archive
(2 payload files), the source was stopped before restore, and an independent
fresh target matched the entire schema/table/object inventory. Wrong-key verify
and occupied-target restore were rejected. The authenticated plaintext manifest
SHA is `410f7aa42cb5daf4b2257ea68370006087f8317f3d418e38e71e20281b4183d9`;
normalized inventory SHA is
`bf5805187b5171e1e6fc9bd7730e854ac68acb724f27b55716a08fe17d3b247b`.

Prior failures remain evidence, not successful steps:77-byte certificate CN
exceeded the observed OpenSSL64-byte bound (fixed by a22-byte CN and unchanged
full-host SAN); the first immutable image lacked its expected system CA file
(fixed by the pinned Node export); then default Docker address pools were fully
subnetted. The latter was diagnosed from the actual daemon error before using
internal-only10.0.0.0/24. The coordinator compared that candidate against57
observed Docker networks and62 Docker/host private route ranges; all were
disjoint at admission (set SHA
`b74f613655f3b790e19c18ed76225f324fbe019c9a2fe356420bd3abf73a614c`).
No host ports, existing network deletion, engine configuration changes or
automatic cleanup were used. This one observed fixture subnet is **not** a
portable product default or a guarantee against later route changes.

Coordinator observation after terminal success: all five owned test containers
were Exited0; the host output contained only the five expected ciphertext/marker
files at0600. Resources, original failure receipts, certificates and synthetic
private keys remain in the private verification directory. None of those
operational originals/keys/archives are copied into the public repository.
Only this projected summary and the original receipt SHA reference are stored.
Actual Render API/permissions/IP/expiry, exact Manager native launch/cancel/UI,
signing-key/origin recovery, current runtime/Pages recovery, operational
migration/update/rollback and full T08 qualification remain unverified.

### Current configuration / authority / runtime boundary

Manager `0ea2369` added the load-only original runtime configuration path;
`f9933cb` retains an immutable per-job source-bound original configuration copy
in the existing Keychain and uses Add-only archive keys. Deployment `10bfe39`
compares original tenant/admin/client/static pins, public Ed25519 authority and
origin with provider environment before and after the helper. No creator or
current publication export is a recovery fallback. These are source/local checks;
actual Keychain, native launch and Render execution remain unverified.

The current source sends only `{origin,keyId,publicKey}` into the fixed helper,
not the signing key. `service-backup.mjs` verifies every row of
`public.exhibition_freezes` using the existing `freezeCanonical`, manifest SHA
and Ed25519 signature, inside the same snapshot callback/PoolClient used for
inventory and `pg_export_snapshot`. Tuple pagination reads64 rows at a time.
Normal local calls without this private option retain their existing behavior.
The private fixed entry now requires this public authority: runner and image
must be packaged together, and an older image cannot prove the new check.

Sixteen worker/entry tests and seven Manager runner tests passed. A real local
PostgreSQL18 check used a separate owned synthetic database:65 signed rows,
two pages and snapshot export passed; wrong origin and second-page signature
tamper were refused, inserted rows rolled back, source database DML was absent
and the owned server stopped normally. This used a read-only source overlay
on the previous qualified image, so it does not qualify a newly built image or
whole backup/restore. Exact source/proof references are in
[adapter evidence](remote-backup-adapter-verification-2026-10-18.json).

Still incomplete: restore-loading the protected backup-time configuration,
active Render deployment/commit and trusted runtime/Pages byte binding, new
image dump/encryption/fresh restore, real Render/native/OS checks and the
existing migration/update/rollback acceptance. The DB archive, original
configuration, runtime master and derived/static artifacts stay distinct.
