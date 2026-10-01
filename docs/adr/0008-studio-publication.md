# ADR 0008: immutable anonymous publication with current rights

Status: accepted after independent source review and actual clean-clone validation

Publication stores an explicitly authorized, validated public projection separate from private authoring. Stable public IDs are remapped, unknown namespaces and CMS identity bindings stripped, and qualified derivative inventory is fixed with exact hashes. A mutable availability row and append-only lifecycle/audit events provide reversible withdrawal without changing or deleting immutable metadata. Editing a published source requires a new draft, including after withdrawal.

Anonymous access combines immutable publication grants with current governing artwork/asset rights and approval, under shared policy/maintenance locks. Byte reads recheck wall-clock expiry after storage I/O. Withdrawal/revocation/changed approval fail closed for metadata and all assets with no-store and no304 responses. Explicit restoration requires current validity and does not republish newer private draft content. This is future access control; received bytes are not revocable remotely.

Additive migration007 and object retention extend consistent DB/blob backup coverage. The public page reuses the bounded geometry renderer with a dedicated anonymous adapter that checks revision/size/hash and never fetches private authoring endpoints. Full Viewer, unsupported audio/media and commercial licensing are separate work. See [usage and wire contract](../studio-publication.md).
