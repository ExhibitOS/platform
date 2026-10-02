# Service backup qualification — October2,2026

Root independently cloned tracked public Platform sources into
`/private/tmp/exhibitos-service-backup-independent-20261002`, installed the
locked Node24.21.0/npm11.19.0 dependencies and executed the final harness
at8bbd2ca. No Capture or operations checkout was present or required.

`npm ci` passed with zero audit vulnerabilities. `npm run check` passed all
137 unit tests/30 files, nine public packaged contract tests, types, lint and
production build with original notices for eleven bundled runtime packages.
The full check ran at8894eb7; subsequent changes only correct/extend the
integration harness. The final harness also passed ESLint. Required
`npm run test:e2e -- --config .local/playwright.service.config.ts` passed three
Chromium tests on isolated3035/5195 ports using the real local API/proxy.

The root actual PostgreSQL/File/S3 suite passed36 groups with exit0.
The exact [report](service-backup-run.json) SHA256 is
`7da669d8cb5e88bc7072aa5f4068e765aab99ccb0aa767ee909f2983b9a32207`,
recorded2026-10-02T13:04:16.631Z. Each source adapter corpus contained50 tables,
40,111 rows (including40,003 bigint/numeric cursor-batching fixtures),47 objects
and17,838,545 object bytes. The target was a separate PostgreSQL container and
new FileBlobStore. Both original DB/store and original signing-key path were
unavailable before actual operator CLI recovery.

Verified behavior includes the exported-snapshot/actual waiting HTTP writer
boundary, every raw SQL row/schema/migration/object digest, authenticated
encryption of DB/runtime/configuration, current tenant-only read-only integrity,
restored public exhibition/GLB/PNG/PCM bytes over HTTP, old signed freeze and new
grant authorization, preserved staging/cleanup/trash/orphans, queued/uploading
job continuation and an actual SIGKILL-interrupted freeze receipt retry.
Expired current rights deny anonymous publication and grant renewal while
remaining legitimate backup history. Wrong keys, corrupted/missing ciphertext,
missing committed source blobs, nonempty DB/object targets, incompatible local
migrations and actual SIGKILL-incomplete CLI archives were rejected. The
synthetic private values were absent from CLI output and the public report.

Source review approved the scoped implementation after fixing manifest-reader
size parity and exclusive integrity scans; the oversized manifest regression
also passed. Failure in maintenance cleanup destroys a potentially locked
database connection rather than returning it to the pool.

Earlier diagnostic runs exposed a CLI stream-close hang and fixture setup
errors (missing required artist biography, S3Mock bucket environment and the
publicationId response field). These were corrected before the final exit0
report; failed or partial runs are not acceptance proof.

Scope is synthetic isolated development recovery, pinned PostgreSQL18.6 and
S3Mock5.2.3, with filesystem targets. Production datasets/SLA, arbitrary S3
providers, extensions/custom schemas, cross-version PostgreSQL, cluster roles,
OS/keychain/IAM secrets, external configuration not explicitly supplied and
browser IndexedDB are not certified. Optional current runtime/configuration
coverage is recorded by the encrypted file manifest. Git bundles remain a
separate backup. No actual user data or earlier backup was deleted; no hosted
CI or paid service ran. [Operator steps](../storage-service-backup.md) explain
quiescence, key recovery and failed candidate handling.
