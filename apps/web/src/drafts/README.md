The document-only artwork/exhibition validation modules are adapted from the
Apache-2.0 ExhibitOS/spec 0.1.0-draft.1 pinned artifact. Copyright 2026 ExhibitOS
contributors. Original headers and full license are retained in production
THIRD_PARTY_NOTICES.txt. The public exported JSON schemas remain authoritative.

Adaptations replace filesystem schema reads with public JSON imports and Node
Buffer byte lengths with TextEncoder, and omit file-byte validation, sealing,
publication and freeze hashing. validateLifecycle here accepts authoring drafts
only; it checks the full nested exhibition/artwork document semantics including
references, geometry, rights intervals and accessibility. The server uses the
original pinned validator. Parity fixtures cover meaningful negative semantics.

This module stores draft metadata, geometry and asset descriptors. It does not
store asset bytes, produce an OEX, publish an exhibition, or validate actual asset
content. Local backups and rescue exports are metadata JSON only.
