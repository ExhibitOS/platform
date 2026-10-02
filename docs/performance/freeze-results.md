# Signed freeze and offline qualification

2026-10-02; independently executed source
82953c6818f08b4e0d543d1b50bcb322e0b4faf3. Node24.21.0/npm11.19.0,
macOS27.0.1/Apple M1, pinned PostgreSQL18.6, FileBlobStore and production
Chromium. All artworks and accounts are synthetic.

A separate public-product checkout with no operations or Capture code passed
`npm ci --ignore-scripts` (zero audit vulnerabilities), `npm run check`
(124tests/26files, nine public contracts, types/lint/build and11notices),
`npm run test:e2e` (three cases on isolated3021/5191), and `npm run test:freeze`
(26 actual API/filesystem/DB/browser/portable groups). The implementation
checkout independently passed the same26groups before this reproduction.
Root OEX regression also passed its two isolated PNG cases and24 actual groups.
The existing storage regression with all10 migrations passed synthetic quiesced
DB dump/restore, seven object hashes and retained S3 restart
(exhibitos-backup-GWcSCj). This fixture has no nonempty freeze corpus and is not
T07-03 administrative backup acceptance. The actual key initializer separately
passed0600 permissions, derived fingerprint and exclusive overwrite rejection.

The exact root-generated [freeze-run.json](freeze-run.json) has SHA256
12dfe36d6f00d712cd8f63b4a52f487c2718e1b63a0082df531af43ce9b75ce6.
Child reports record [Studio](freeze-studio-run.json),
[offline browser](freeze-browser-run.json) and
[portable runtime](freeze-portable-run.json). Temporary fixture paths are
historical run evidence, not required public-build inputs.

Executed behavior includes owner/tenant/CSRF/revision/approval/display/export
checks; actual signed GLB/PNG/PCM; tampered/missing/duplicate/untrusted/unknown
version rejection; immutable prior scene and actual retained runtime-byte
variation; real SIGKILL after durable object inventory followed by recovery;
Studio download/comparison/unsaved guard; IndexedDB non-overwrite; disconnected
shell reload with no publication-asset HTTP calls; persistent clock rollback;
real cross-tab logout/login with delayed authority responses; actual standalone
retained launcher from a temporary directory without npm/project/API; and active
looping audio plus renderer removal after real grant expiry or reconnect denial.
No HTTP success was substituted for the actual protected services.

Two independent locked builds produced the same10-file core digest
65c4067ccc580433c38a4066ad6ccfaf2cb69e088d2cb9f5a27cf77d60ada0d9.
The signed full runtime adds the generated descriptor and service worker;
identity describes actual browser bytes, not an OCI image.

Independent source review found and resolved unknown-MIME/path traversal and
stale asynchronous profile restoration, with actual filesystem negative and
race regression tests. Direct offline shell registration was completed after
actual disconnected-reload failure. Earlier clock harness used advancing time;
the intentional rollback control now fixes time, while portable expiry uses
real advancing wall-clock time. Temporary E2E proxy/cwd setup was corrected
before the final three cases passed.

Limits: disconnected recipients cannot learn new revocations before reconnect;
display grants are bounded by8hours/session/all relevant rights and require
explicit source renewal. Clock checks are software guards, not DRM. Real audio
active/stop states were observed; human speaker audibility was not certified.
No Windows/physical iPhone/GPU, all-screen-reader/WCAG, production backup or
Docker image qualification is claimed. Current runtime mismatch refuses display
without changing archived bytes; historical reconstruction uses retained runtime.
Browser storage may be evicted, so files and consistent DB/blob/config backup
remain separate requirements. No hosted CI, paid resource or original artwork.
