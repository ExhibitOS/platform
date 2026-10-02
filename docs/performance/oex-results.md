# Portable OEX qualification

2026-10-02; tested source `61ee70649a0748022e45101c5c48604a03854b4f`.
Node24.21.0/npm11.19.0, macOS27.0.1/Apple M1, pinned PostgreSQL18.6,
FileBlobStore and actual production Chromium. All content is synthetic.
The public-only independent checkout contains no operations or Capture dependency.

## Executed results

- `npm ci --ignore-scripts` and `npm run check`: PASS;104 unit tests across20 files,
  nine installed contract tests, types/lint/build and11 original runtime notices.
- `npm run test:oex`: PASS; two actual isolated PNG decoder tests and24 real
  database/filesystem/HTTP/browser groups. The implementation worktree independently
  passed the same24 groups before the root clean-checkout reproduction.
- Existing regressions: foundation Chromium E2E3, import11, auth18, CMS26 and
  publication16 PASS. Storage's actual nine-migration synthetic DB dump/restore,
  seven object hashes and retained S3 inventory restart PASS.
- Independent read-only review approved the authorization/transaction boundaries,
  immutable imported approvals, shared-owner aliases and explicit typed references.

The exact root [OEX report](oex-run.json) SHA256 is
`84d924724184851f8b998ff132e2cc6a72b8822aba72a7936ce81628195a00c1`.
Its24 checks include fresh-tenant/same-ID restoration, source metadata/provenance
and GLB/PNG/PCM hashes, raw original draft.1 compatibility, valid240-character
shared paths, malicious ZIP/DEFLATE, actual SQL rollback/SIGKILL/lease recovery,
source survival, unsaved-input protection, same-job edited reopen, explicit
READY/publication, real A→B→A session changes, truncated HTTP upload retry and
production worker startup/shutdown/missing-migration denial.
A custom roomUUID-shaped licenseId/holder/creditLine is preserved through actual
import, reexport, READY and anonymous published artwork/audio snapshots.

## Failures corrected before acceptance

An early imported local draft changed its server draft ID and failed later PUT;
local copies now preserve the authoritative ID and reopen an existing bound
record without replacing history. A test job-list race selected a different job;
actual created IDs now scope the browser checks. Imported approval projection
previously regenerated native metadata and failed READY equality; trusted immutable
imported snapshots now retain source evidence while checking current metadata,
artist, rights and every approved asset. Shared paths now use bounded generated
names with the original audited path. Generic ID-suffix rewriting changed custom
license tokens; both import and publication now map explicit reference fields only.
Old regression harnesses now expect nine additive migrations and explicitly enter
optional3D after restoring publication visibility. Targets and product authorization
were not relaxed to make failed checks pass.

## Scope and recovery limits

This profile is bounded GLB/PNG/PCM portability, not arbitrary codecs, ZIP layouts,
physical-device qualification, standalone offline runtime or full service backup.
Imported exhibitions remain private until explicit authorized publication. Current
rights can deny display/export; delivered bytes are not DRM. The closed inventory
excludes credentials and raw Capture members but cannot recognize all sensitive
prose or embedded bytes. Review actual content before external transfer.

OEX receipts, staging/imported objects, DB/blob/IndexedDB/config remain outside
Git backups. Consistent administrative backup and offline/freeze acceptance are
separate tasks. Actual synthetic fault tests do not create a production restore
point. Code rollback cannot erase migration009 or imported data; preserve them
and use the [storage recovery inventory](../storage.md). No actual data or prior
backup was automatically deleted; no hosted CI or new paid resource was used.
