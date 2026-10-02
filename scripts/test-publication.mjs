// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { fixtureURL, validateExhibition, revisionHash } from "@exhibitos/spec";
import { migrate, FileBlobStore, sha256, Storage } from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
const docker = process.env.DOCKER_BIN ?? "docker", name = `exhibitos-publication-test-${randomUUID()}`, password = randomBytes(24).toString("hex");
const image = JSON.parse(await readFile(new URL("../database/images.json", import.meta.url))).postgres;
const run = (...args) => execFileSync(docker, args, { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }).trim();
let pool, app, started = false;
const checks = [];
const test = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
try {
    run("run", "-d", "--name", name, "--label", `exhibitos.publication.test=${name}`, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, image);
    started = true;
    pool = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "postgres", statement_timeout: 10000 });
    for (let n = 0;; n++) {
        try {
            await pool.query("SELECT 1");
            break;
        }
        catch (e) {
            if (n >= 90)
                throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname, "006_studio.sql");
    const existing = (await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")).rows;
    await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname);
    await test("additive publication migration preserves all earlier migration checksums", async () => { assert.deepEqual((await pool.query("SELECT name,sha256 FROM schema_migrations WHERE name<'007' ORDER BY name")).rows, existing); assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 8); });
    const tenant = randomUUID(), pass = "Synthetic-publication-password123", origin = "http://127.0.0.1:3000", headers = { host: "127.0.0.1:3000", origin };
    await bootstrap(pool, tenant, "synthetic.publication.admin", pass);
    const blobs = new FileBlobStore(await mkdtemp(`${tmpdir()}/exhibitos-publication-blobs-`));
    app = buildApp({ pool, blobs, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
    const expected = async (p, status, code) => { const r = await p; assert.equal(r.statusCode, status, r.body); if (code)
        assert.equal(r.json().code, code); return r; };
    const json = async (p, status = 200, code) => (await expected(p, status, code)).json();
    const login = async (subject) => { const r = await expected(app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { subject, password: pass, tenantId: tenant } }), 200); const cookie = r.headers["set-cookie"].split(";")[0]; return { cookie, ...(await app.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie } })).json() }; };
    const request = (actor, method, path, payload, extra = {}) => app.inject({ method, url: `/api/v1/tenants/${tenant}${path}`, headers: { ...headers, ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrfToken } : {}), ...(Buffer.isBuffer(payload) ? { "content-type": "application/octet-stream" } : {}), ...extra }, ...(payload === undefined ? {} : { payload }) });
    const anonymous = (url, extra = {}) => app.inject({ url, headers: { host: headers.host, ...extra } });
    const admin = await login("synthetic.publication.admin"), actors = { admin };
    for (const role of ["artist", "other", "viewer", "curator"]) {
        await expected(request(admin, "POST", "/users", { subject: `synthetic.publication.${role}`, password: pass, role: role === "other" ? "artist" : role }), 201);
        actors[role] = await login(`synthetic.publication.${role}`);
    }
    const rights = { holder: "Synthetic owner", ownership: "owner", licenseId: "CC0-1.0", permissions: { display: true, download: false, export: false, commercial: false }, creditLine: "Synthetic public display credit" };
    const metadata = { title: "Synthetic sculpture <script>plain text</script>", description: "Synthetic accessible description", dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, rights, provenance: { source: "human-authored", sourceUnits: "m", scaleApplied: true, notes: "PRIVATE AUTHORING NOTES" } };
    const artist = await json(request(actors.artist, "POST", "/cms/artists", { name: "Synthetic public artist", bio: "PRIVATE ARTIST BIO" }), 201);
    const imports = new Imports(pool, blobs);
    const createApproved = async (type) => {
        const m = { ...metadata, title: type === "image" ? "Synthetic public painting" : metadata.title, dimensions: { ...metadata.dimensions, depth: type === "image" ? 0.02 : 1 } };
        const art = await json(request(actors.artist, "POST", "/cms/artworks", { ...m, artistId: artist.id }), 201);
        let bytes = await readFile(fixtureURL(`fixtures/synthetic/${type === "image" ? "painting.png" : "sculpture.glb"}`));
        // The original redistributable PNG has ancillary metadata outside the qualified import profile.
        if (type === "image") {
            const chunks = [bytes.subarray(0, 8)];
            for (let offset = 8; offset < bytes.length;) {
                const length = bytes.readUInt32BE(offset), end = offset + length + 12, kind = bytes.toString("ascii", offset + 4, offset + 8);
                if (["IHDR", "IDAT", "IEND"].includes(kind))
                    chunks.push(bytes.subarray(offset, end));
                offset = end;
            }
            bytes = Buffer.concat(chunks);
        }
        const mime = type === "image" ? "image/png" : "model/gltf-binary";
        const job = await json(request(actors.artist, "POST", "/imports", { artworkId: art.id, idempotencyKey: randomUUID(), mime, sha256: sha256(bytes), bytes: bytes.length, scaleMeters: 1, rights }), 201);
        await expected(request(actors.artist, "PUT", `/imports/${job.id}/bytes`, bytes), 200);
        await expected(request(actors.artist, "POST", `/imports/${job.id}/complete`), 200);
        assert.equal(await imports.work(), true);
        const done = await json(request(actors.artist, "GET", `/imports/${job.id}`));
        assert.equal(done.state, "approved", JSON.stringify(done));
        await expected(request(actors.artist, "POST", `/cms/artworks/${art.id}/approve`, { revision: 1, assetId: done.assetId }), 200);
        return { id: art.id, assetId: done.assetId, metadata: m, ...await json(request(actors.artist, "GET", `/studio/artworks/${art.id}`)) };
    };
    const works = [await createApproved("sculpture"), await createApproved("image")];
    const candidate = JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8"));
    candidate.id = randomUUID();
    candidate.revisionId = randomUUID();
    candidate.artworks = works.map(w => w.artwork);
    for (const [i, p] of candidate.placements.entries()) {
        p.artworkRevisionId = works[i % works.length].artwork.revisionId;
        p.assetId = works[i % works.length].artwork.primaryAssetId;
    }
    candidate.extensions = { "private.example/authoring": { note: "PRIVATE EXTENSION" }, "org.exhibitos.studio/presentation": { version: 1, startCamera: { roomId: candidate.rooms[0].id, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 }, viewpoints: [], credits: "Synthetic public curator" } };
    const time = new Date().toISOString(), draft = { schemaVersion: "1.0.0-draft.1", kind: "exhibition-draft", id: randomUUID(), exhibitionId: candidate.id, editVersion: 1, createdAt: time, updatedAt: time, candidate };
    const saved = await json(request(actors.artist, "POST", "/studio/exhibitions", { draft, requestId: randomUUID() }), 201), path = `/studio/exhibitions/${draft.exhibitionId}`;
    await test("READY enforces saved exact CMS approvals and private authoring authorization with repair guidance", async () => {
        await expected(request(null, "GET", `${path}/ready`), 401);
        for (const actor of [actors.other, actors.viewer, actors.curator])
            await expected(request(actor, "GET", `${path}/ready`), 403);
        const bad = structuredClone(draft);
        bad.id = randomUUID();
        bad.exhibitionId = randomUUID();
        bad.candidate.id = bad.exhibitionId;
        bad.candidate.artworks[0].dimensions.width = 99;
        const wrong = await json(request(actors.artist, "POST", "/studio/exhibitions", { draft: bad, requestId: randomUUID() }), 201);
        const report = await json(request(actors.artist, "GET", `/studio/exhibitions/${bad.exhibitionId}/ready`));
        assert.equal(report.status, "BLOCKED");
        assert.ok(report.issues.some(i => i.code === "ARTWORK_SNAPSHOT_CHANGED" && i.remediation));
        await expected(request(actors.artist, "POST", `/studio/exhibitions/${bad.exhibitionId}/publications`, { requestId: randomUUID() }, { "if-match": wrong.etag }), 422, "PUBLICATION_NOT_READY");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM studio_publications WHERE exhibition_id=$1", [bad.exhibitionId])).rows[0].n, 0);
        assert.equal((await json(request(actors.artist, "GET", `${path}/ready`))).status, "READY");
    });
    await test("READY blocks unsupported audio and unapproved arbitrary artwork without creating public rows", async () => {
        for (const modify of [d => { d.candidate.mediaAssets = [{ id: randomUUID(), path: "audio/synthetic.wav", mime: "audio/wav", bytes: 1, sha256: "0".repeat(64), rights }]; }, d => { delete d.candidate.artworks[0].extensions; }]) {
            const invalid = structuredClone(draft);
            invalid.id = randomUUID();
            invalid.exhibitionId = randomUUID();
            invalid.candidate.id = invalid.exhibitionId;
            modify(invalid);
            const remote = await json(request(actors.artist, "POST", "/studio/exhibitions", { draft: invalid, requestId: randomUUID() }), 201);
            const p = `/studio/exhibitions/${invalid.exhibitionId}`, report = await json(request(actors.artist, "GET", `${p}/ready`));
            assert.equal(report.status, "BLOCKED");
            assert.ok(report.issues.every(i => i.remediation));
            await expected(request(actors.artist, "POST", `${p}/publications`, { requestId: randomUUID() }, { "if-match": remote.etag }), 422, "PUBLICATION_NOT_READY");
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM studio_publications WHERE exhibition_id=$1", [invalid.exhibitionId])).rows[0].n, 0);
        }
    });
    const publishInput = { requestId: randomUUID() };
    let pub, projection, assetUrls;
    await test("publication needs server role/ownership, CSRF and exact saved ETag, then creates a remapped immutable anonymous projection", async () => {
        for (const actor of [actors.other, actors.viewer])
            await expected(request(actor, "POST", `${path}/publications`, publishInput, { "if-match": saved.etag }), 403);
        await expected(request(actors.artist, "POST", `${path}/publications`, publishInput), 428, "IF_MATCH_REQUIRED");
        await expected(request(actors.artist, "POST", `${path}/publications`, publishInput, { "if-match": '"studio-r1-' + "0".repeat(64) + '"' }), 412, "REMOTE_CONFLICT");
        await expected(request(actors.artist, "POST", `${path}/publications`, publishInput, { "if-match": saved.etag, "x-csrf-token": "invalid" }), 403, "CSRF_REJECTED");
        pub = await json(request(actors.artist, "POST", `${path}/publications`, publishInput, { "if-match": saved.etag }), 201);
        await expected(app.inject({ method: "POST", url: `/api/v1/tenants/${randomUUID()}/studio/publications/${pub.publicationId}/unpublish`, headers: { ...headers, cookie: actors.artist.cookie, "x-csrf-token": actors.artist.csrfToken }, payload: {} }), 403, "FORBIDDEN");
        const res = await expected(anonymous(`/api/v1/publications/${pub.publicationId}`), 200);
        assert.equal(res.headers["cache-control"], "no-store");
        projection = res.json();
        assert.equal(validateExhibition(projection.exhibition, { publicationTime: pub.publishedAt }).valid, true);
        assert.equal(revisionHash(projection.exhibition), pub.revisionSha256);
        assert.equal(projection.publication.revisionSha256, pub.revisionSha256);
        for (const secret of ["PRIVATE", tenant, actors.artist.userId, artist.id, draft.id, draft.exhibitionId, ...works.flatMap(w => [w.id, w.assetId, w.artwork.revisionId]), "org.exhibitos.studio/cms", "object_key", "previewUrl"])
            assert.equal(JSON.stringify(projection).includes(secret), false, secret);
        assetUrls = projection.assets.map(a => a.url);
        for (const a of projection.assets) {
            const r = await expected(anonymous(a.url), 200), inventory = projection.exhibition.artworks.flatMap(x => x.assets).find(x => x.id === a.assetId);
            assert.equal(r.headers["cache-control"], "no-store");
            assert.equal(r.headers["x-exhibitos-publication-revision"], pub.revisionSha256);
            assert.equal(sha256(r.rawPayload), inventory.sha256);
            assert.equal(r.rawPayload.length, inventory.bytes);
        }
        await expected(anonymous(`/api/v1/publications/${pub.publicationId}`, { "if-none-match": pub.revisionSha256 }), 200);
    });
    const unavailable = async () => { for (const url of [`/api/v1/publications/${pub.publicationId}`, ...assetUrls]) {
        const r = await expected(anonymous(url, { "if-none-match": pub.revisionSha256 }), 404, "PUBLICATION_UNAVAILABLE");
        assert.equal(r.headers["cache-control"], "no-store");
    } };
    await test("published source cannot mutate, receipts recover exact retries, and publication/asset/event history is immutable", async () => {
        assert.deepEqual(await json(request(actors.artist, "POST", `${path}/publications`, publishInput, { "if-match": saved.etag }), 201), pub);
        await expected(request(actors.artist, "POST", `${path}/publications`, publishInput, { "if-match": '"studio-r1-' + "0".repeat(64) + '"' }), 409, "REQUEST_CONFLICT");
        await expected(request(actors.artist, "PUT", path, { draft: { ...draft, candidate: { ...candidate, title: "Mutation blocked" } }, requestId: randomUUID() }, { "if-match": saved.etag }), 409, "PUBLISHED_DRAFT_IMMUTABLE");
        assert.deepEqual((await json(request(actors.artist, "GET", path))).draft, draft);
        for (const [table, col] of [["studio_publications", "id"], ["publication_assets", "publication_id"], ["publication_events", "publication_id"]])
            await assert.rejects(pool.query(`DELETE FROM ${table} WHERE ${col}=$1`, [pub.publicationId]), /immutable revision/);
        await expected(anonymous(`/api/v1/tenants/${tenant}${path}`), 401);
    });
    await test("unpublish invalidates every anonymous metadata/asset request, restore rechecks grants and appends audit history", async () => {
        for (const actor of [actors.viewer, actors.other])
            await expected(request(actor, "POST", `/studio/publications/${pub.publicationId}/unpublish`, {}), 403);
        await expected(request(actors.artist, "POST", `/studio/publications/${pub.publicationId}/unpublish`, {}), 200);
        await unavailable();
        await expected(request(actors.artist, "POST", `/studio/publications/${pub.publicationId}/unpublish`, {}), 200);
        await expected(request(actors.artist, "POST", `/studio/publications/${pub.publicationId}/republish`, {}), 200);
        assert.deepEqual((await json(anonymous(`/api/v1/publications/${pub.publicationId}`))).exhibition, projection.exhibition);
        assert.deepEqual((await pool.query("SELECT action FROM publication_events WHERE publication_id=$1 ORDER BY created_at,id", [pub.publicationId])).rows.map(x => x.action), ["published", "unpublished", "republished"]);
        await expected(request(actors.artist, "PUT", path, { draft, requestId: randomUUID() }, { "if-match": saved.etag }), 409, "PUBLISHED_DRAFT_IMMUTABLE");
    });
    await test("current asset rights narrowing/expiry and archive fail closed without reading a mutable private draft", async () => {
        const asset = works[0].assetId, original = (await pool.query("SELECT r.* FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.id=$1", [asset])).rows[0];
        for (const changed of [{ ...rights, permissions: { ...rights.permissions, display: false } }, { ...rights, expiresAt: "2000-01-01T00:00:00Z" }]) {
            await pool.query("UPDATE rights SET metadata=$2 WHERE id=$1", [original.id, changed]);
            await unavailable();
            await expected(request(actors.artist, "POST", `/studio/publications/${pub.publicationId}/republish`, {}), 404, "PUBLICATION_UNAVAILABLE");
        }
        await pool.query("UPDATE rights SET metadata=$2 WHERE id=$1", [original.id, original.metadata]);
        await pool.query("UPDATE artworks SET deleted_at=now() WHERE id=$1", [works[0].id]);
        await unavailable();
        await pool.query("UPDATE artworks SET deleted_at=NULL WHERE id=$1", [works[0].id]);
        await pool.query("UPDATE exhibitions SET metadata=$2 WHERE id=$1", [draft.exhibitionId, { private: "PRIVATE MUTABLE DRAFT" }]);
        assert.deepEqual((await json(anonymous(`/api/v1/publications/${pub.publicationId}`))).exhibition, projection.exhibition);
        await pool.query("UPDATE exhibitions SET metadata=$2 WHERE id=$1", [draft.exhibitionId, draft]);
    });
    await test("derivative integrity and expiry during storage reads fail closed; maintenance retains public bytes", async () => {
        const asset = (await pool.query("SELECT * FROM publication_assets WHERE publication_id=$1 LIMIT 1", [pub.publicationId])).rows[0], bytes = await blobs.get(asset.object_key);
        await blobs.remove(asset.object_key);
        await blobs.put(asset.object_key, Buffer.from("corrupt synthetic derivative"));
        await expected(anonymous(`/api/v1/publications/${pub.publicationId}/assets/${asset.id}`), 404, "PUBLICATION_UNAVAILABLE");
        await blobs.remove(asset.object_key);
        await blobs.put(asset.object_key, bytes);
        const grant = (await pool.query("SELECT r.* FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.id=$1", [asset.source_asset_id])).rows[0];
        const originalGet = blobs.get.bind(blobs);
        let fetchedBeforeExpiry = false;
        await pool.query("UPDATE rights SET metadata=$2 WHERE id=$1", [grant.id, {...grant.metadata, expiresAt: new Date(Date.now()+2000).toISOString()}]);
        blobs.get = async key => {
            const value = await originalGet(key);
            if (key === asset.object_key) {
                fetchedBeforeExpiry = true;
                await new Promise(resolve => setTimeout(resolve, 2200));
            }
            return value;
        };
        try {
            await expected(anonymous(`/api/v1/publications/${pub.publicationId}/assets/${asset.id}`), 404, "PUBLICATION_UNAVAILABLE");
            assert.equal(fetchedBeforeExpiry, true, "The grant must be active at initial gate and expire during storage read");
        } finally {
            blobs.get = originalGet;
            await pool.query("UPDATE rights SET metadata=$2 WHERE id=$1", [grant.id, grant.metadata]);
        }
        const orphaned = await new Storage(pool, blobs).reconcile({ tenantId: tenant, userId: admin.userId }, true);
        assert.equal(orphaned.includes(asset.object_key), false);
        assert.equal(sha256(await blobs.get(asset.object_key)), asset.sha256);
    });
    await test("current metadata rights revocation invalidates every public URL and records explicit rights audit", async () => {
        await expected(request(actors.artist, "PATCH", `/cms/artworks/${works[0].id}`, { ...works[0].metadata, rights: { ...rights, permissions: { ...rights.permissions, display: false } }, revision: 1 }), 200);
        await unavailable();
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM publication_events WHERE publication_id=$1 AND action='rights-revoked'", [pub.publicationId])).rows[0].n, 1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE metadata->>'action'='cms.rights_changed' AND metadata->>'target'=$1", [works[0].id])).rows[0].n, 1);
    });
    if (process.env.EXHIBITOS_PUBLICATION_SKIP_BROWSER !== "1") {
        const browserWorks = [await createApproved("sculpture"), await createApproved("image")];
        const { runPublicationBrowser } = await import("./publication-browser.mjs");
        const result = await runPublicationBrowser({ pool, blobs, tenantId: tenant, subject: "synthetic.publication.artist", password: pass, artworkIds: browserWorks.map(w => w.id) });
        checks.push(...result.checks);
        console.log(JSON.stringify({ browser: result }, null, 2));
    }
    await test("PostgreSQL backup restores immutable publication snapshots, assets, states, receipts and audits", async () => {
        const maintenance = await pool.connect();
        let dump;
        try {
            await maintenance.query("SELECT pg_advisory_lock(82002)");
            dump = execFileSync(docker, ["exec", name, "pg_dump", "-U", "postgres", "-Fc", "postgres"], { timeout: 120000 });
        }
        finally {
            await maintenance.query("SELECT pg_advisory_unlock(82002)");
            maintenance.release();
        }
        run("exec", name, "createdb", "-U", "postgres", "restored");
        execFileSync(docker, ["exec", "-i", name, "pg_restore", "-U", "postgres", "-d", "restored"], { input: dump, timeout: 120000, stdio: ["pipe", "pipe", "pipe"] });
        const restore = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "restored" });
        try {
            for (const table of ["studio_publications", "publication_states", "publication_assets", "publication_events", "publication_requests", "audit_events"]) {
                const sql = `SELECT row_to_json(t) AS value FROM ${table} t ORDER BY row_to_json(t)::text`;
                assert.deepEqual((await restore.query(sql)).rows, (await pool.query(sql)).rows);
            }
        }
        finally {
            await restore.end();
        }
    });
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks, scope: process.env.EXHIBITOS_PUBLICATION_SKIP_BROWSER === "1" ? "Actual isolated PostgreSQL/API synthetic publications; browser skipped." : "Actual isolated PostgreSQL/API and production Chromium public preview; synthetic qualified GLB/PNG only." }, null, 2));
}
finally {
    await app?.close();
    await pool?.end();
    if (started)
        run("rm", "-f", name);
}
