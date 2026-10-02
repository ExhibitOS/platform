# Frozen exhibitions and offline display

A freeze retains an immutable OEX and the exact public browser runtime bytes
(HTML, JavaScript, CSS, notices and standalone server), with signed hashes.
Studio's **전시 버전 고정** panel freezes the server-saved revision. Save local
changes first. Later draft edits create a different revision; they never rewrite
an earlier freeze. Refresh history and compare its revision with the current
saved draft. Download is a separate current-authorization operation.

Configure the authenticated API with BLOB_ROOT, FREEZE_RUNTIME_ROOT pointing to
an actual production apps/web/dist, and FREEZE_SIGNING_KEY_FILE. Apply migration
010 using the documented migration tool; startup does not mutate the database.
Run `npm run freeze:init -- /absolute/private/path/freeze-key.json` once to create
an exclusive mode0600 Ed25519 key. Keep this file outside Git and retain it in
protected configuration backup. The initializer refuses to overwrite it and
prints only its public SHA256 fingerprint. A missing configuration disables
freeze endpoints; a malformed or symlinked configuration fails closed.

An `.oef` is a Platform-owned signed envelope (1.0.0-draft.1), enclosing public
OEX1.0.0-draft.2. It is not a new public Spec format or an account credential.
It fixes the source revision, format artifact, actual migration checksums and
runtime file inventory. No private repository or npm install is needed for the
exported standalone runtime. Signing authenticates the manifest and explicit
offline display grant; operators must obtain the trust fingerprint through an
already trusted source, never trust the file's embedded key by itself.

Online creation/preparation/renewal require current ownership and approval plus
both display and export rights. The explicit display grant is at most8hours and
no later than session or any relevant artwork/audio rights expiry. Studio
requests1hour. A disconnected device cannot discover a subsequent revocation
immediately: it stops at the signed deadline, on detected clock rollback, or on
failed source revalidation. Reconnect rechecks current account and rights before
resuming. A new grant must be obtained explicitly from the source server; neither
a preserved archive nor local clock changes renew it. Delivered bytes are not
DRM, and remote deletion cannot be promised.

For this browser, open `/offline`, prepare the signed-in display account and
trusted source key, then select the `.oef`. Verified archives enter a separate
scoped IndexedDB store. Existing packages are not overwritten on import failure
or renewal. The public service worker preserves application code only; it never
caches private API responses or artwork bytes. Prepare while online and verify
the shell is installed before disconnecting. Browsers may evict site storage;
keep a separate file archive. An incompatible current runtime fails closed; use
the retained standalone runtime for historical reconstruction.

For portable reconstruction, extract only the trusted server launcher from the
verified envelope (operator tooling or the documented validation harness), then:

```sh
node offline-server.mjs exhibition.oef --trust-key PUBLIC_SHA256_FINGERPRINT --port 0
```

Alternatively, in a qualified Platform checkout:

```sh
node scripts/serve-offline.mjs exhibition.oef --trust-key PUBLIC_SHA256_FINGERPRINT --port 0
```

Open the printed loopback `/offline` address, select **운영자가 신뢰 키를 확인한
로컬 오프라인 서버**, prepare the account/key, then **로컬 서명 패키지 준비** and
**고정 전시 열기**. The launcher verifies signatures, all hashes and display time
before serving a closed file inventory; it neither extracts paths nor fetches
remote services. Text, artwork details and transcripts precede optional3D/audio.
Escape and explicit stop/close remain available. After grant expiry, retain the
file for preservation and obtain a newly authorized file for display.

Git backups do not include freeze database rows, retained objects, browser
IndexedDB packages or the signing key. Consistent DB/blob/config backup and
restore require a separate maintenance window; logical OEX export is not a full
service backup. Existing completed freezes are never automatically deleted.

Actual API, disconnected browser, portable reconstruction, history, rights and
negative qualification is recorded in [freeze-results.md](performance/freeze-results.md).
The bounded implementation is qualified on the documented synthetic Mac/Chromium
environment; production backup and physical-device certification remain separate.
