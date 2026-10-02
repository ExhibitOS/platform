# ADR0013: Portable OEX with private atomic import

Status: implementation candidate; actual integration acceptance pending.

Adopt the digest-pinned public Spec0.1.0-draft.2 artifact to package approved
artwork and PCM WAV alongside the exact saved exhibition revision. Keep old OEX
reads and OES identities intact. Server current authorization and export grants
remain distinct from format validation and publication display grants.

Use a tenant/actor-bound durable import receipt, bounded chunked staging, isolated
archive and artwork parsers, typed ID mapping and a single metadata transaction.
Precommit exclusively owned cleanup inventories before object writes so crashes
and SQL rollback remain recoverable. Import creates new private CMS/Studio/audio
records; never overwrite an existing project or create a Publication. Source
archive/hash and ID map preserve the distinction between original and derived
identities. Preserve omitted image dimensions and truthful synthetic provenance.

Run a local worker with the configured API and bounded tenant staging quotas.
Explicit retry/cancel and durable cleanup receipts handle transient failure.
The UI downloads only an explicit server revision and opens completed imports as
new local copies, preserving previous local history and unsaved-input protection.

Recovery retains previous artifact pins and original exhibition data. Code rollback
does not undo migration009 or imported bytes. New job and object data must enter
the existing consistent DB/blob backup policy before persistent production use.
OEX is not full service backup, physical-device qualification or offline runtime.
