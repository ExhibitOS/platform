# Workspace furnishing owner preview

The native viewport opts into the owner preview with its authenticated session and device budget. `GeometryPreview` requires that opt-in for the workspace furnishing extension and rejects it for public sources. For each scene it creates one owner scope and one peak-byte ledger, counts existing scene geometry, mounts registered room-local placements through the owner-only display check and model routes, and calls `enforce()` immediately before rendering. Scene teardown aborts pending work and disposes mounted resources. Subsequent artwork placement previews reserve their decode and geometry against the same owner scene while it exists.

Authority is the current 036 immutable version's display grant and expiry, owner session and original bytes/hash. The service does not provide a separate dynamic rights-revocation or catalog-deletion state. Revalidation is periodic, hides a model during checks and fails closed; it is not an instantaneous server-pushed revocation guarantee. Resource cleanup or decoder termination that cannot be proven keeps the corresponding reservation until scene teardown.

This connects a local preview path only. Public projection, OEX import, a qualified 037 runtime, actual user GLB rendering and EXB restoration require their own evidence. Synthetic tests do not qualify a GPU or native runtime.
