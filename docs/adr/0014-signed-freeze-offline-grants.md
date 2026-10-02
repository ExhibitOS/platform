# 0014 — Signed retained runtime and bounded offline display

Status: accepted for the bounded synthetic profile; actual evidence in
[freeze-results.md](../performance/freeze-results.md).

An immutable freeze retains exact OEX and browser runtime bytes. The signed
manifest binds source revision, public format artifact, migration checksums and
per-file inventory; it uses deterministic sorted JSON and Ed25519. Browser code
and the dependency-free portable launcher share the same strict verifier, with
an independently established trusted public-key fingerprint. Embedded keys do
not establish trust.

Offline delivery requires explicit display and export rights and current
approval, with a signed grant bounded by eight hours, session expiry and all
relevant rights expiry. A browser preserves verified scoped copies separately
from drafts, detects clock rollback, rechecks current source authority on
reconnection, and stops text/3D/audio on expiration or denial. A disconnected
recipient cannot learn immediate remote revocation; this limitation is visible
in the UI. Retaining bytes does not itself authorize renewed display or provide
DRM. Historical reconstruction uses the retained runtime rather than silently
substituting the newest build.

Creation commits an owned pending-object receipt before writes, without a
source foreign key that would self-deadlock the outer locked Studio transaction.
The immutable record and completion receipt commit together after final rights
and lease checks. Recovery touches only expired owned pending prefixes; completed
archives are not automatically removed. The separate grant is replaceable by
explicit authorization, while signed manifests and original bytes remain fixed.

This adds migration010 and Platform envelope1.0.0-draft.1 without changing public
OES/OEX schemas. Runtime identity describes actual browser bytes, not an invented
OCI image. Installation/deployment adapters can introduce additional packaging
later while preserving these hashes. Signing-key backup and DB/blob/cache backup
are separate from Git bundles.
