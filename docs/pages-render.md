# Cloudflare Pages and optional Render deployment

The first public deployment uses Cloudflare Pages for the approved static exhibition and optional Render Node API/Realtime with Render Postgres. Ubuntu and Railway deployment remain preserved development work, outside the first-release requirement. Capture and final Mac Processing roles are unchanged.

## Manager flow

Choose static only or static with dynamic services, connect each provider using its own masked token, select an account/workspace and approved exhibition export, then deploy and open the observed public URL. Static only needs no Render account, database or API address. Credentials and deployment recovery references remain in macOS Keychain; disconnecting removes the local connection and does not delete remote resources. The current implementation accepts the existing approved static export folder through the native picker. Automatic export selection from the local CMS catalog is not yet connected.

The static exporter builds a closed public artifact from an already approved publication. It preserves publication ID, revision, lazy assets and LOD, checks current public rights, and excludes originals, administrator state and secrets. Build the Viewer runtime with `apps/web/vite.static.config.ts`, then use `scripts/export-static-publication.mjs`; its command-line usage explains the required existing publication and fresh output folder. No Git integration or public user repository is needed for Pages direct upload. Pages checks reject a file above 25MiB or an artifact above 20,000 files; they do not reduce quality or drop files.

## Optional dynamic runtime

Render builds the official Platform main branch with `npm ci && npm run build` and starts `node scripts/render-runtime.mjs`. Health is `/api/v1/readiness`. Manager supplies the selected Pages origin and private runtime configuration through provider environment secrets. PostgreSQL stores application records and private object bytes, including migration `015_hosted_objects.sql`. The signing identity is supplied from durable secret configuration and is never regenerated at startup. Render ephemeral disk is not used for durable artwork or keys. `scripts/service-backup.mjs` supports the existing encrypted backup/restore format with `BACKUP_BLOB_BACKEND=postgres`; private object bytes are also included in the database dump. This intentionally retains the existing authenticated object inventory and can increase backup size.

Public artwork stays on Pages. Optional API routes use a fixed same-origin Pages proxy to the observed Render address; static asset routes remain independent. Render reads only the exact approved public snapshot selected at deployment, without granting private CMS or host authority. Static viewing remains usable when the dynamic connection fails. The first-release optional Viewer surface is a connection indicator; this change does not enable deferred avatar, meeting or voice UI.

## Free configuration and current limits

Use explicit free plans and no payment method. A token is not permission to upgrade. Render free web services can sleep and share 750 hours per workspace each month. Free Postgres is limited to one instance per workspace and 1GB, and expires 30 days after creation. Manager shows the actual provider expiry when returned; an absent expiry is unknown. Back up before expiry: access may already be unavailable afterwards. No permanent free database, automatic extension or unlimited replacement is promised. Resource deletion is never automatic.

The new Postgres adapter has passed actual isolated migration, authentication, restart and encrypted backup/fresh-database restore tests. Those local tests do not qualify Render itself. External database backup connectivity, cloud migration/update/rollback, actual account limits, Safari authentication/WebSocket behavior and public URL acceptance remain separate checks. New databases use an empty external IP allowlist; do not broaden it silently to make a local backup work. No third hosting or storage provider is required.

Implementation/API tests and browser simulations are not actual provider deployment evidence. Until account tokens are entered in Manager, no new public URL or database expiry can be reported.

Official limits: [Pages](https://developers.cloudflare.com/pages/platform/limits/), [Render free services](https://render.com/docs/free), [Render API](https://render.com/docs/api). Provider details were checked on 2026-10-17.
