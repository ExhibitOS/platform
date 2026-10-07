# Runtime schema qualification

`qualify-runtime-schema.mjs` is an operator prerequisite for independently observing a target catalog. It does not authorize Manager updates or attest a signed runtime artifact. A bootstrap catalog can omit additional tables in an installed service; use the full restored source context for compatibility work.

## Full restored context with bounded storage

Build storage with `npm run build`. Prepare an independently authenticated service manifest, stopped restored source services, exact local PostgreSQL/maintenance image IDs, and a fresh private result path. The operator must prevent other privileged writers throughout the test. Run:

```sh
python3 scripts/test-restored-runtime-schema.py \
  --source-root <canonical-restored-installation> \
  --manifest <authenticated-manifest-within-source-root> \
  --manifest-sha256 <trusted-exact-manifest-sha256> \
  --postgres-container <exact-64-character-stopped-container-id> \
  --runtime-container <exact-64-character-stopped-container-id> \
  --postgres-image sha256:<exact-existing-image-id> \
  --maintenance-image sha256:<exact-existing-maintenance-image-id> \
  --expected-source-schema <authenticated-source-schema-sha256> \
  --output-directory <new-canonical-private-result-directory>
```

The driver supports the existing PostgreSQL18 `/var/lib/postgresql/18/docker` layout and `database` internal hostname. It pins Compose ownership, immutable images, source volume names, private regular manifest/environment files, and stopped services. It observes the complete physical source tree before and after, and refuses an existing active writer. These observations do not exclude a later privileged writer; run only in an isolated operator environment.

It copies the entire source cluster into a **256MiB tmpfs**. Source DB/blob mounts remain readonly; no ports or new persistent volumes are created. It first requires exact original inventory/schema equality, then executes deliberately failing synthetic SQL and verifies transaction rollback by complete original inventory equality. It observes a successful additive SQL migration twice, verifies original rows/sequences/blob bindings and historical migration rows, and refuses replay against the original pre-migration manifest. The original services are never started. A stopped scratch DB releases its tmpfs even on failure; inspected container metadata is retained on failure and original volumes/images are preserved. Private reports may include paths and synthetic catalog metadata; never commit private environment values or original manifests.

The script is a synthetic qualification driver, not a general migration command. It preserves every additional public table in the restored source. Non-public custom schemas are unsupported and refused. Transformations of original rows are not qualified by the additive preservation contract.

## Direct operator adapter

Explicitly provide `EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL`. For restored mode, set `EXHIBITOS_SCHEMA_MODE=restored`, `EXHIBITOS_SCHEMA_MANIFEST_SHA256`, `EXHIBITOS_SCHEMA_SNAPSHOT_SYSTEM_IDENTIFIER`, `EXHIBITOS_SCHEMA_ORIGINAL_MIGRATION_DIRECTORY`, `EXHIBITOS_SCHEMA_MIGRATION_DIRECTORY`, and `BLOB_ROOT`; send raw authenticated manifest bytes on standard input. The outer maintenance advisory lock spans original inventory, SQL migration, target observations, and preservation. Original inventory and preservation verifiers borrow the same client and release only their own reentrant lock acquisitions.

Fresh mode requires `EXHIBITOS_SCHEMA_SOURCE_SYSTEM_IDENTIFIER` and an empty public schema in a different disposable cluster. Its output sets `originalDataPreserved=false`; it cannot replace the restored-context result.

Both modes return a canonical catalog (`schemaVersion`, `schemaDigest`, `migrations`) and `targetSchemaSha256`. `artifactAuthenticated`, `compatibilityQualified`, `configurationVerified`, `preflightVerified`, and `updateExecuted` remain false. A caller must independently bind the complete SQL artifact and signed plan, retained native identities and full recovery proof before admitting a real update. SQL transaction rollback here does not prove full host/configuration/image rollback, cold recovery, crash recovery, GUI behavior, or Windows compatibility.

## Genuine development artifact

After a clean committed checkout and a passing storage budget, run
`python3 scripts/build-schema-qualification.py --output-directory <fresh-private-directory>`.
It builds the complete allowlisted Platform source with Dockerfile.local plus the
synthetic additive SQL used by the restored-context driver, and exports a tagless
linux/arm64 OCI without loading or starting it. The original migration files stay
byte-identical. The report pins source, generated Dockerfile, SQL, OCI bytes and
BuildKit image digest. Build cache and export bytes must both be budgeted. This
development fixture is separate from production release authority.

Use the Manager OCI inspector with the full restored-context target catalog, its
exact private bytes pin, the authenticated original manifest and observed target
schema hash. Then independently verify an ephemeral development Ed25519 envelope
against the entire OCI byte stream. These bindings do not admit a native update:
Rust typed compatibility, full failure recovery and original-scope cold/crash
checks remain required. Never replace them with a green artifact receipt.


## Inventory collection against a retained target catalog

`collectServiceInventory(client, blobs, {migrationCatalog: catalog.migrations})`
can collect actual database rows, sequence state, schema, migration history and
blob/reference inventory using an explicit target migration catalog. The existing
`{migrationDirectory: '/absolute/migrations'}` form remains supported. Choose exactly
one form. Explicit catalogs must be nonempty, ordered, unique, bounded lists of
SQL names and SHA256 digests; tenant filtering is not accepted with this form.
The collector copies the catalog before database work so asynchronous caller
mutation cannot change the expected scope. Missing/replaced/unknown observed
migration rows still produce inventory issues. No SQL files are copied or executed.

Catalog input is metadata rather than authentication or admission. A native
consumer must bind it to the retained signed OCI bytes, observed target schema
and original authenticated manifest before calling `verifyMigratedInventory`.
That verifier still checks original rows/sequences/history/blobs, target schema
and both repeatable-read observations. Collection alone never proves an update
completed or grants permission to apply one. This is additive to the existing
storage API and retains the original exact-restoration contract.
