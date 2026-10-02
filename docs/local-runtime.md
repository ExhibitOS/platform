# Local container runtime

This adapter packages the public Platform sources as a real Node24.21.0 OCI image
and a two-service Compose bundle. It uses the [official Node image](https://hub.docker.com/_/node),
whose multi-architecture index digest is pinned in `Dockerfile.local`, and the
PostgreSQL index digest in `database/images.json`. Builds require the public npm
registry and the public Spec artifact committed in this repository. Capture and
operations are excluded by the build context allowlist.

Run with the pinned Node/npm toolchain and a running local Docker or compatible
engine:

```sh
node scripts/package-local-runtime.mjs /absolute/new-private-output-directory
```

The destination must not exist. The result contains `bundle/manifest.json`,
`bundle/compose.yaml`, and a real `bundle/platform-image.tar`. The manifest binds
the exact Compose bytes and image archive SHA-256/size to the immutable image ID
returned by the selected engine. Docker29's containerd image store returns the
OCI index digest; this is not the lower-level image configuration digest. The
actual save/load and start tests qualify this engine's ID without substituting a
mutable image tag. Cross-engine archive ID compatibility remains a separate gate.
Packaging does not publish an image or create a signed release.
The initial bundle exposes only `http://127.0.0.1:13200`; it is not a network or
TLS deployment.

The Manager owns the mode-0600 `runtime.env` immediately outside `bundle/`.
Required fields are `EXHIBITOS_PORT=13200`, `POSTGRES_PASSWORD`, `DATABASE_URL`
(database host `database`, user/database `exhibitos`), `TENANT_ID` (a fresh UUID),
`ADMIN_SUBJECT`, and `ADMIN_PASSWORD`. Credentials must be generated, stored
privately, and supplied through the environment file; never put them in command
arguments, artifacts, logs, or version control. Preserve this configuration when
restarting or upgrading an existing installation. There is no default password.

On startup the adapter applies and checks the ten public SQL migrations,
performs the existing one-time admin bootstrap only if the database has no
credentials, and preserves a generated Ed25519 signing key under `/data/config`.
The authenticated API binds to container loopback. A same-container streaming
proxy serves the closed production static-file set and forwards the browser's
Host/Origin/cookie/CSRF headers without enabling forwarded-header trust. Readiness
is evaluated by `/api/v1/readiness`, separately from process liveness.

Compose uses named database, object, and configuration volumes. Platform runs as
the image's nonroot `node` account with a read-only root filesystem, bounded tmpfs,
and no added capabilities. Host publication is strictly loopback. Stop/restart
retain all three volumes. Never use `down --volumes` or prune on an existing
installation. Back up the runtime configuration and signing key with the encrypted
[service backup procedure](storage-service-backup.md) before a restore or upgrade.

The local adapter currently contains Platform and database services. Realtime,
network deployment, verified release signatures, automatic updates, production
recovery, Windows qualification, and native Manager GUI qualification remain
separate gates. Engine checks below cover Linux arm64 containers on macOS only. Test results
must distinguish the actual engine/architecture exercised from untested candidates.

## Local verification

```sh
npm ci
npm run check
npm run test:e2e
node scripts/test-local-runtime.mjs
```

The final command requires Docker/Compose, or Podman with a compatible Compose
provider selected through `CONTAINER_ENGINE`, and an unused loopback port13200. It
builds a real image, checks private artifact hashes and nonroot production
dependencies, starts a synthetic isolated installation, tests server-side auth
and a real GLB import worker, and verifies stop/restart retains metadata, bytes,
signing authority, account and session. The container's actual readiness health
probe must become healthy. It also proves installed-origin worker control and
HTTP-cache-disabled offline draft recovery while excluding authenticated private
asset bytes from CacheStorage. Teardown verifies labels and removes only its own
synthetic volumes; existing installations are never targeted. Generated private
fixtures, image archives and the result JSON remain in a restricted temporary
directory for review. `EXHIBITOS_PROXY_ONLY=1` selects only the two actual HTTP
boundary tests; that shorter mode does not qualify an installed container.

## Podman producer and consumer

The producer accepts `CONTAINER_ENGINE=podman` (or its absolute executable path).
It records `preferredEngine` and normalizes only the optional sha256 prefix of
the actual immutable engine image ID. Docker29 may identify an OCI index while
Podman identifies the image configuration; an existing Docker archive reference
is not silently treated as an equivalent Podman ID. Generate a bundle with the
intended producer, or explicitly verify a converted archive and its native ID.

Podman production uses `--format docker` to preserve the Dockerfile HEALTHCHECK;
Podman's default OCI output omits that extension. Original archive bytes/hash,
Compose hash and engine image digest remain checked independently. Manager also
normalizes the ID prefix without accepting a different digest.

macOS Podman requires a Linux VM. The current development check uses rootless
Podman6.1.3 and the independent Apache-2.0 Compose5.5.1 CLI, selected with
`PODMAN_COMPOSE_PROVIDER`. The separate podman-compose1.6 provider does not meet
this adapter's Compose2-or-later JSON contract. No Docker Desktop server or
privileged Podman socket helper is required for the Podman lifecycle operations.
Keep a new verification VM's configuration/data separate from existing machines;
use a named connection and share only a designated scratch directory. The actual
fixture needed2GiB RAM; a1GiB startup attempt did not complete SSH connection.
Do not change an existing machine's rootful/default connection or delete its data.

The verified public shell/static files use `public, max-age=0, must-revalidate`,
allowing the Studio worker to install only build-hash-verified bytes. API responses
retain their existing no-store policy. Actual installed-origin offline reload and
private-byte cache exclusion are checked separately from a successful HTML GET.
