// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp, readdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { fixtureURL, validateExhibition } from "@exhibitos/spec";
import {
  migrate,
  FileBlobStore,
  sha256,
} from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
// Fast in-memory regression precedes Docker/database/API setup.
console.log(execFileSync(process.execPath, ["--test", new URL("./experience-fixture.test.mjs", import.meta.url).pathname], { encoding: "utf8", timeout: 10000 }));
const docker = process.env.DOCKER_BIN ?? "docker",
  name = `exhibitos-experience-test-${randomUUID()}`,
  password = randomBytes(24).toString("hex");
const image = JSON.parse(
  await readFile(new URL("../database/images.json", import.meta.url)),
).postgres;
const run = (...args) =>
  execFileSync(docker, args, {
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let pool,
  app,
  started = false;
const checks = [];
const test = async (title, fn) => {
  await fn();
  checks.push(title);
  console.log(`PASS ${title}`);
};
try {
  run(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `exhibitos.publication.test=${name}`,
    "-p",
    "127.0.0.1::5432",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    image,
  );
  started = true;
  pool = new Pool({
    host: "127.0.0.1",
    port: Number(run("port", name, "5432/tcp").split(":").at(-1)),
    user: "postgres",
    password,
    database: "postgres",
    statement_timeout: 10000,
  });
  for (let n = 0; ; n++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (e) {
      if (n >= 90) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
    "007_publications.sql",
  );
  const existing = (
    await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
  );
  await test("additive audio migration preserves all earlier migration checksums", async () => {
    assert.deepEqual(
      (
        await pool.query(
          "SELECT name,sha256 FROM schema_migrations WHERE name<'008' ORDER BY name",
        )
      ).rows,
      existing,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n,
      10,
    );
  });
  const tenant = randomUUID(),
    pass = "Synthetic-publication-password123",
    origin = "http://127.0.0.1:3000",
    headers = { host: "127.0.0.1:3000", origin };
  await bootstrap(pool, tenant, "synthetic.publication.admin", pass);
  const blobs = new FileBlobStore(
    await mkdtemp(`${tmpdir()}/exhibitos-publication-blobs-`),
  );
  app = buildApp({
    pool,
    blobs,
    auth: { mode: "local", origin, bindHost: "127.0.0.1" },
  });
  const expected = async (p, status, code) => {
    const r = await p;
    assert.equal(r.statusCode, status, r.body);
    if (code) assert.equal(r.json().code, code);
    return r;
  };
  const json = async (p, status = 200, code) =>
    (await expected(p, status, code)).json();
  const login = async (subject, tenantId = tenant) => {
    const r = await expected(
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers,
        payload: { subject, password: pass, tenantId },
      }),
      200,
    );
    const cookie = r.headers["set-cookie"].split(";")[0];
    return {
      cookie,
      ...(
        await app.inject({
          url: "/api/v1/auth/session",
          headers: { ...headers, cookie },
        })
      ).json(),
    };
  };
  const request = (actor, method, path, payload, extra = {}) =>
    app.inject({
      method,
      url: `/api/v1/tenants/${tenant}${path}`,
      headers: {
        ...headers,
        ...(actor
          ? { cookie: actor.cookie, "x-csrf-token": actor.csrfToken }
          : {}),
        ...(Buffer.isBuffer(payload)
          ? { "content-type": "application/octet-stream" }
          : {}),
        ...extra,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const anonymous = (url, extra = {}) =>
    app.inject({ url, headers: { host: headers.host, ...extra } });
  const admin = await login("synthetic.publication.admin"),
    actors = { admin };
  for (const role of ["artist", "other", "viewer", "curator"]) {
    await expected(
      request(admin, "POST", "/users", {
        subject: `synthetic.publication.${role}`,
        password: pass,
        role: role === "other" ? "artist" : role,
      }),
      201,
    );
    actors[role] = await login(`synthetic.publication.${role}`);
  }
  const rights = {
    holder: "Synthetic owner",
    ownership: "owner",
    licenseId: "CC0-1.0",
    permissions: {
      display: true,
      download: false,
      export: false,
      commercial: false,
    },
    creditLine: "Synthetic public display credit",
  };
  const metadata = {
    title: "Synthetic sculpture <script>plain text</script>",
    description: "Synthetic accessible description",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    rights,
    provenance: {
      source: "human-authored",
      sourceUnits: "m",
      scaleApplied: true,
      notes: "PRIVATE AUTHORING NOTES",
    },
  };
  const artist = await json(
    request(actors.artist, "POST", "/cms/artists", {
      name: "Synthetic public artist",
      bio: "PRIVATE ARTIST BIO",
    }),
    201,
  );
  const imports = new Imports(pool, blobs);
  const fixtures = (await import("./viewer-fixtures.mjs")).loadViewerFixtures();
  const createApproved = async (type) => {
    const m = {
      ...metadata,
      title: type === "image" ? "Synthetic public painting" : metadata.title,
      ...(type === "sculpture" ? { medium: "Synthetic painted polymer", creationYear: 2024 } : {}),
      dimensions: {
        ...metadata.dimensions,
        depth: type === "image" ? 0.02 : 1,
      },
    };
    const art = await json(
      request(actors.artist, "POST", "/cms/artworks", {
        ...m,
        artistId: artist.id,
      }),
      201,
    );
    const bytes = fixtures.find((f) => f.type === type).bytes;
    const mime = type === "image" ? "image/png" : "model/gltf-binary";
    const job = await json(
      request(actors.artist, "POST", "/imports", {
        artworkId: art.id,
        idempotencyKey: randomUUID(),
        mime,
        sha256: sha256(bytes),
        bytes: bytes.length,
        scaleMeters: 1,
        rights,
      }),
      201,
    );
    await expected(
      request(actors.artist, "PUT", `/imports/${job.id}/bytes`, bytes),
      200,
    );
    await expected(
      request(actors.artist, "POST", `/imports/${job.id}/complete`),
      200,
    );
    assert.equal(await imports.work(), true);
    const done = await json(
      request(actors.artist, "GET", `/imports/${job.id}`),
    );
    assert.equal(done.state, "approved", JSON.stringify(done));
    await expected(
      request(actors.artist, "POST", `/cms/artworks/${art.id}/approve`, {
        revision: 1,
        assetId: done.assetId,
      }),
      200,
    );
    return {
      id: art.id,
      assetId: done.assetId,
      metadata: m,
      ...(await json(
        request(actors.artist, "GET", `/studio/artworks/${art.id}`),
      )),
    };
  };
  const works = [
    await createApproved("sculpture"),
    await createApproved("image"),
  ];
  const template = JSON.parse(
    await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8"),
  );
  const { navigationFixture } = await import("./navigation-fixture.mjs");
  const fixture = navigationFixture(
      template,
      works.map((w) => w.artwork),
    ),
    candidate = fixture.document;
  assert.equal(
    validateExhibition(candidate).valid,
    true,
    JSON.stringify(validateExhibition(candidate)),
  );
  const time = new Date().toISOString(),
    draft = {
      schemaVersion: "1.0.0-draft.1",
      kind: "exhibition-draft",
      id: randomUUID(),
      exhibitionId: candidate.id,
      editVersion: 1,
      createdAt: time,
      updatedAt: time,
      candidate,
    };
  const saved = await json(
    request(actors.artist, "POST", "/studio/exhibitions", {
      draft,
      requestId: randomUUID(),
    }),
    201,
  );
  const { syntheticWav, addExperience } = await import("./experience-fixture.mjs");
  const wave = syntheticWav(), audioPath = `/studio/exhibitions/${candidate.id}/audio`;
  const audioInput = { requestId: randomUUID(), mime: "audio/wav", bytes: wave.length, sha256: sha256(wave), rights };
  const audio = await json(request(actors.artist, "POST", audioPath, audioInput), 201);
  await test("audio upload authorization, idempotency and immutable payload conflict", async () => {
    assert.deepEqual(await json(request(actors.artist, "POST", audioPath, audioInput), 201), audio);
    await expected(request(actors.artist, "POST", audioPath, { ...audioInput, sha256: "0".repeat(64) }), 409, "REQUEST_CONFLICT");
    for (const actor of [actors.other, actors.viewer, actors.curator]) {
      await expected(request(actor, "GET", audioPath), 403);
      await expected(request(actor, "PUT", `${audioPath}/${audio.id}/bytes`, wave), 403);
      await expected(request(actor, "POST", `${audioPath}/${audio.id}/approve`, { revision: 1 }), 403);
    }
    const foreignTenant = randomUUID();
    // Explicit isolated fixture seeding: existing API-created user gets a foreign
    // tenant membership, then authenticates through the real login endpoint.
    // Bootstrap is global one-time initialization and must not be called again.
    await pool.query("INSERT INTO tenants(id,name) VALUES($1,'Synthetic foreign audio institution')", [foreignTenant]);
    await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'artist')", [foreignTenant, actors.other.userId]);
    const foreign = await login("synthetic.publication.other", foreignTenant);
    await expected(request(foreign, "GET", audioPath), 403);
    await expected(request(actors.artist, "POST", audioPath, { ...audioInput, requestId: randomUUID(), bytes: 12582913 }), 400);
    await expected(request(actors.artist, "POST", audioPath, { ...audioInput, requestId: randomUUID(), mime: "audio/mpeg" }), 400);
    await expected(request(actors.artist, "POST", `${audioPath}/${audio.id}/approve`, { revision: 1 }), 422, "AUDIO_NOT_READY");
  });
  await test("actual PCM validation rejects wrong hash, corrupt WAV and excessive duration", async () => {
    const wrong = Buffer.from(wave); wrong[44] ^= 1;
    await expected(request(actors.artist, "PUT", `${audioPath}/${audio.id}/bytes`, wrong), 422, "ASSET_INTEGRITY");
    for (const invalid of [Buffer.alloc(44), syntheticWav({ seconds: 61 }), syntheticWav({ channels: 3 })]) {
      const item = await json(request(actors.artist, "POST", audioPath, { ...audioInput, requestId: randomUUID(), bytes: invalid.length, sha256: sha256(invalid) }), 201);
      await expected(request(actors.artist, "PUT", `${audioPath}/${item.id}/bytes`, invalid), 422, "AUDIO_INVALID");
    }
    const uploaded = await json(request(actors.artist, "PUT", `${audioPath}/${audio.id}/bytes`, wave));
    assert.equal(uploaded.state, "validated"); assert.equal(uploaded.durationSeconds, 2);
    const approved = await json(request(actors.artist, "POST", `${audioPath}/${audio.id}/approve`, { revision: 1 }));
    assert.equal(approved.state, "approved");
    assert.deepEqual(await json(request(actors.artist, "POST", `${audioPath}/${audio.id}/approve`, { revision: 1 })), approved);
    assert.equal((await json(request(actors.artist, "PUT", `${audioPath}/${audio.id}/bytes`, wave))).state, "approved");
  });
  await test("owner audio revoke/restore endpoints and bounded64 source inventory", async () => {
    assert.equal((await json(request(actors.artist, "POST", `${audioPath}/${audio.id}/revoke`, {}))).revoked, true);
    assert.equal((await json(request(actors.artist, "POST", `${audioPath}/${audio.id}/restore`, {}))).revoked, false);
    const n = Number((await pool.query("SELECT count(*) FROM studio_audio WHERE exhibition_id=$1", [candidate.id])).rows[0].count);
    for (let i = n; i < 64; i++) await json(request(actors.artist, "POST", audioPath, { ...audioInput, requestId: randomUUID() }), 201);
    await expected(request(actors.artist, "POST", audioPath, { ...audioInput, requestId: randomUUID() }), 409, "AUDIO_LIMIT");
  });
  addExperience(candidate, (await json(request(actors.artist, "GET", `${audioPath}/${audio.id}`))).mediaAsset);
  if (process.env.EXHIBITOS_ACCESSIBILITY_ONLY === "1") {
    candidate.extensions["org.exhibitos.studio/presentation"].viewpoints = [
      { name: "Accessibility safe viewpoint", position: [0, 1.65, 1], target: [0, 1.65, -1] },
      { name: "Accessibility unsafe viewpoint", position: [-2, 1.65, 0], target: [-2, 1.65, -1] },
      { name: "Accessibility vertical viewpoint", position: [0, 1.65, 1], target: [0, 0, 1] },
    ].map(value => ({ ...value, id: randomUUID(), roomId: candidate.rooms[0].id, fov: 55 }));
  }
  await test("experience fixture has distinct room volumes with aligned floor and reciprocal door heights", async () => {
    assert.equal(candidate.rooms[0].dimensions.height, 4);
    assert.equal(candidate.rooms[1].dimensions.height, 6);
    const volumes = candidate.rooms.map(room => room.dimensions.width * room.dimensions.height * room.dimensions.depth);
    assert.deepEqual(volumes, [256, 384]);
    assert(volumes[1] > volumes[0]);
    const second = candidate.rooms[1], surfaces = candidate.surfaces.filter(surface => surface.roomId === second.id);
    assert(surfaces.filter(surface => surface.type === "floor").every(surface => surface.transform.position[1] === 0));
    assert(surfaces.filter(surface => surface.type === "ceiling").every(surface => surface.transform.position[1] === second.dimensions.height));
    assert(surfaces.filter(surface => surface.type === "wall").every(surface => surface.dimensions.height === second.dimensions.height && surface.transform.position[1] === second.dimensions.height / 2));
    const doors = candidate.openings.filter(opening => opening.type === "door");
    const height = opening => candidate.surfaces.find(surface => surface.id === opening.surfaceId).transform.position[1] + opening.offset[1];
    assert.equal(height(doors[0]), height(doors[1])); assert.equal(height(doors[0]), 1.25);
    assert(candidate.openings.filter(opening => opening.type === "window").every(opening => height(opening) === 2));
    assert.equal(validateExhibition(candidate).valid, true, JSON.stringify(validateExhibition(candidate)));
    fixture.geometry.roomVolumesCubicMeters = volumes;
    fixture.geometry.roomHeightsMeters = candidate.rooms.map(room => room.dimensions.height);
  });
  draft.editVersion++;
  const updated = await json(request(actors.artist, "PUT", `/studio/exhibitions/${candidate.id}`, { draft, requestId: randomUUID() }, { "if-match": saved.etag }));
  await test("bounded experience references reject invalid annotation and unknown version", async () => {
    for (const edit of [x => { x.version = 2; }, x => { x.annotations[0].position = [100, 0, 0]; }, x => { x.voices[0].transcript = ""; }]) {
      const invalid = structuredClone(draft); edit(invalid.candidate.extensions["org.exhibitos.viewer/experience"]);
      await expected(request(actors.artist, "PUT", `/studio/exhibitions/${candidate.id}`, { draft: invalid, requestId: randomUUID() }, { "if-match": updated.etag }), 422, "DRAFT_INVALID");
    }
  });
  const pub = await json(
    request(
      actors.artist,
      "POST",
      `/studio/exhibitions/${candidate.id}/publications`,
      { requestId: randomUUID() },
      { "if-match": updated.etag },
    ),
    201,
  );
  await test("approved synthetic room/door/window/artwork fixture publishes an immutable safe projection", async () => {
    const p = await json(
      anonymous(`/api/v1/publications/${pub.publicationId}`),
    );
    assert.equal(p.exhibition.rooms.length, 2);
    assert.equal(p.exhibition.placements.length, 2);
    assert.equal(p.assets.length, 5);
    assert.equal(p.exhibition.mediaAssets.length, 1);
    const sculpture = p.exhibition.artworks.find(artwork => artwork.artworkType === "sculpture");
    assert.equal(sculpture.metadata.medium, "Synthetic painted polymer");
    assert.deepEqual(sculpture.extensions["org.exhibitos.artwork/details"], { version: 1, creationYear: 2024 });
    const painting = p.exhibition.artworks.find(artwork => artwork.artworkType === "image");
    assert.equal(painting.metadata.medium, undefined);
    assert.equal(painting.extensions["org.exhibitos.artwork/details"], undefined);
    assert(!JSON.stringify(p).includes("PRIVATE AUTHORING NOTES"));
    assert(!JSON.stringify(p).includes("PRIVATE ARTIST BIO"));
  });
  await app.close();
  const { createServer } = await import("node:net"),
    reserve = createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const browserOrigin = `http://127.0.0.1:${port}`;
  app = buildApp({
    pool,
    blobs,
    auth: { mode: "local", origin: browserOrigin, bindHost: "127.0.0.1" },
  });
  const dist = new URL("../apps/web/dist/", import.meta.url),
    assets = new Set(await readdir(new URL("assets/", dist)));
  app.get("/p/:id", async (_req, reply) =>
    reply
      .header("cache-control", "no-store")
      .type("text/html")
      .send(await readFile(new URL("index.html", dist))),
  );
  app.get("/assets/:file", async (req, reply) => {
    const file = req.params.file;
    if (!assets.has(file) || !/^[-\w.]+$/.test(file))
      return reply.code(404).send();
    return reply
      .type(file.endsWith(".js") ? "application/javascript" : "text/css")
      .send(await readFile(new URL(`assets/${file}`, dist)));
  });
  for (const path of ["/studio", "/cms"]) app.get(path, async (_req, reply) => reply.type("text/html").send(await readFile(new URL("index.html", dist))));
  app.get("/voice-pcm-worklet.js", async (_req, reply) => reply.type("application/javascript").send(await readFile(new URL("voice-pcm-worklet.js", dist))));
  await app.listen({ host: "127.0.0.1", port });
  const projection = await (await fetch(`${browserOrigin}/api/v1/publications/${pub.publicationId}`)).json();
  const audioSlot = projection.assets.find(a => a.mime === "audio/wav"), visualSlot = projection.assets.find(a => a.mime === "image/png");
  assert(audioSlot); assert(visualSlot);
  const allUnavailable = async () => { for (const url of [`/api/v1/publications/${pub.publicationId}`, audioSlot.url, visualSlot.url]) assert.equal((await fetch(`${browserOrigin}${url}`)).status, 404, url); };
  const corrupt = async (table, trigger, sql, values) => {
    // Deliberate isolated-fixture corruption only; immutable triggers remain enabled outside this transaction.
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      await c.query(sql, values); await c.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  };
  const setRevoked = async revoked => { await pool.query("UPDATE studio_audio SET revoked=$2 WHERE id=$1", [audio.id, revoked]); };
  await test("immutable publication serves exact verified WAV without private storage identifiers", async () => {
    const response = await fetch(`${browserOrigin}${audioSlot.url}`); assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-exhibitos-publication-revision"), pub.revisionSha256);
    assert.equal(response.headers.get("content-type").split(";")[0], "audio/wav");
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), sha256(wave));
    const text = JSON.stringify(projection); for (const secret of ["object_key", "PRIVATE", actors.artist.userId, tenant]) assert(!text.includes(secret), secret);
  });
  await test("current revocation, expired rights and altered approval fail closed for metadata, visual and audio", async () => {
    // Direct database controls model authoritative current state corruption; no production delete.
    await setRevoked(true); await allUnavailable(); await setRevoked(false);
    assert.equal((await fetch(`${browserOrigin}${audioSlot.url}`)).status, 200);
    await corrupt("studio_audio", "audio_source_immutable", "UPDATE studio_audio SET rights=$2 WHERE id=$1", [audio.id, { ...rights, expiresAt: "2000-01-01T00:00:00Z" }]);
    await allUnavailable(); await corrupt("studio_audio", "audio_source_immutable", "UPDATE studio_audio SET rights=$2 WHERE id=$1", [audio.id, rights]);
    const approval = (await pool.query("SELECT snapshot FROM audio_approvals WHERE audio_id=$1", [audio.id])).rows[0].snapshot;
    await corrupt("audio_approvals", "audio_approval_immutable", "UPDATE audio_approvals SET snapshot=$2 WHERE audio_id=$1", [audio.id, { ...approval, bytes: approval.bytes + 1 }]);
    await allUnavailable(); await corrupt("audio_approvals", "audio_approval_immutable", "UPDATE audio_approvals SET snapshot=$2 WHERE audio_id=$1", [audio.id, approval]);
  });
  await test("separate immutable public WAV survives private original fault but rejects corrupt served publication bytes", async () => {
    const privateRow = (await pool.query("SELECT object_key FROM studio_audio WHERE id=$1", [audio.id])).rows[0];
    const publicRow = (await pool.query("SELECT object_key FROM publication_media WHERE publication_id=$1 AND id=$2", [pub.publicationId, audioSlot.assetId])).rows[0];
    assert(privateRow); assert(publicRow); assert.notEqual(privateRow.object_key, publicRow.object_key);
    const exactPublic = async () => {
      const response = await fetch(`${browserOrigin}${audioSlot.url}`);
      assert.equal(response.status, 200);
      assert.equal(sha256(Buffer.from(await response.arrayBuffer())), sha256(wave));
    };
    const injectFixtureFault = async (key, check) => {
      // Existing immutable put must reject replacement. Only this freshly
      // generated isolated file is edited directly, with unconditional restore.
      await assert.rejects(blobs.put(key, Buffer.alloc(wave.length)), /immutable object conflict/);
      const root = resolve(blobs.root), path = resolve(root, key);
      assert(path.startsWith(root + sep));
      assert.equal(sha256(await blobs.get(key)), sha256(wave));
      const file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        assert((await file.stat()).isFile());
        await file.write(Buffer.alloc(wave.length), 0, wave.length, 0); await file.sync();
        await check();
      } finally { await file.write(wave, 0, wave.length, 0); await file.sync(); await file.close(); }
    };
    // Current source DB approvals/rights remain gated; its separate private
    // bytes are not fetched to serve a verified immutable publication copy.
    await injectFixtureFault(privateRow.object_key, async () => {
      await exactPublic();
      const approval = await fetch(`${browserOrigin}/api/v1/tenants/${tenant}${audioPath}/${audio.id}/approve`, {
        method: "POST", headers: { origin: browserOrigin, cookie: actors.artist.cookie, "x-csrf-token": actors.artist.csrfToken, "content-type": "application/json" }, body: JSON.stringify({ revision: 1 }),
      });
      assert.equal(approval.status, 409); assert.equal((await approval.json()).code, "ASSET_INTEGRITY");
    }); await exactPublic();
    await injectFixtureFault(publicRow.object_key, async () => {
      assert.equal((await fetch(`${browserOrigin}${audioSlot.url}`)).status, 404);
    });
    await exactPublic();
  });
  await test("approved audio triggers reject normal source/approval/publication mutations", async () => {
    await assert.rejects(pool.query("UPDATE studio_audio SET rights=$2 WHERE id=$1", [audio.id, { ...rights, holder: "Changed" }]));
    await assert.rejects(pool.query("UPDATE audio_approvals SET snapshot='{}'::jsonb WHERE audio_id=$1", [audio.id]));
    await assert.rejects(pool.query("UPDATE publication_media SET bytes=bytes+1 WHERE publication_id=$1", [pub.publicationId]));
  });
  let curationResult;
  if(process.env.EXHIBITOS_ACCESSIBILITY_ONLY!=="1") {
    const {runCurationBrowser}=await import('./curation-browser.mjs');
    curationResult=await runCurationBrowser({origin:browserOrigin,authoring:{tenantId:tenant,subject:"synthetic.publication.artist",password:pass,candidate:draft.candidate,wave}});
    checks.push(...curationResult.checks);console.log(JSON.stringify({curation:curationResult},null,2));
  }
  await test("quiesced database dump restores audio approvals and publication media into separate database with retained blobs", async () => {
    const target = `experience_restore_${randomUUID().replaceAll("-", "")}`;
    // No browser/request job is active during this application-quiesced dump.
    const dump = execFileSync(docker, ["exec", name, "pg_dump", "-U", "postgres", "-d", "postgres", "--no-owner", "--no-privileges"], { timeout: 120000 });
    await pool.query(`CREATE DATABASE ${target}`);
    execFileSync(docker, ["exec", "-i", name, "psql", "-U", "postgres", "-d", target, "-v", "ON_ERROR_STOP=1"], { input: dump, timeout: 120000, stdio: ["pipe", "pipe", "pipe"] });
    const restoredPool = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: target });
    let restoredApp;
    try {
      for (const table of ["studio_audio", "audio_approvals", "publication_media", "studio_publications", "publication_assets"])
        assert.deepEqual((await restoredPool.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows, (await pool.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows, table);
      restoredApp = buildApp({ pool: restoredPool, blobs, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
      const restoredMetadata = await restoredApp.inject({ url: `/api/v1/publications/${pub.publicationId}`, headers: { host: headers.host } });
      assert.equal(restoredMetadata.statusCode, 200);
      // SQL-backed public asset inventory has no ordering contract. Normalize
      // only that top-level inventory; exhibition arrays and all values stay exact.
      const normalizedInventory = value => ({ ...value, assets: [...value.assets].sort((a, b) => a.assetId.localeCompare(b.assetId)) });
      assert.deepEqual(normalizedInventory(restoredMetadata.json()), normalizedInventory(projection));
      for (const slot of projection.assets) {
        const response = await restoredApp.inject({ url: slot.url, headers: { host: headers.host } });
        assert.equal(response.statusCode, 200);
        const original = Buffer.from(await (await fetch(`${browserOrigin}${slot.url}`)).arrayBuffer());
        assert.equal(sha256(response.rawPayload), sha256(original));
      }
    } finally { await restoredApp?.close(); await restoredPool.end(); }
    console.log("RESTORE SCOPE: isolated database dump, exact rows and publication bytes against retained original FileBlobStore; not a standalone blob backup or production recovery point.");
  });
  const accessibilityOnly = process.env.EXHIBITOS_ACCESSIBILITY_ONLY === "1";
  if(process.env.EXHIBITOS_CURATION_ONLY!=="1") {
  const { runExperienceBrowser } = await import(accessibilityOnly ? "./accessibility-browser.mjs" : "./experience-browser.mjs");
  const result = await runExperienceBrowser({ origin: browserOrigin, publicationId: pub.publicationId,
    projection, fixture: fixture.geometry, authoring: { tenantId: tenant, subject: "synthetic.publication.artist", password: pass, candidate: draft.candidate, wave }, revoke: () => setRevoked(true), restore: () => setRevoked(false) });
  checks.push(...result.checks);
  if (accessibilityOnly) {
    const { runTeleportBrowser } = await import("./accessibility-teleport-browser.mjs");
    const teleportResult = await runTeleportBrowser({ origin: browserOrigin, publicationId: pub.publicationId, projection });
    checks.push(...teleportResult.checks);
  }
  if (accessibilityOnly && process.env.EXHIBITOS_ACCESSIBILITY_HOLD === "1") {
    console.log(`NATIVE ACCESSIBILITY FIXTURE: ${browserOrigin}/p/${pub.publicationId}`);
    console.log("Synthetic local fixture only. Press Enter in this test terminal to finish and clean up its isolated database container.");
    await new Promise(resolve => process.stdin.once("data", resolve));
    process.stdin.pause();
  }
  console.log(JSON.stringify({ checks, result, scope: "Actual isolated PostgreSQL10migrations, approved synthetic WAV + GLB/PNG immutable publication and production Chromium" }, null, 2));
  } else console.log(JSON.stringify({checks,curationResult,scope:"Actual isolated PostgreSQL10 migrations, production curation browser and retained-blob DB restore; synthetic only"},null,2));
} finally {
  await app?.close(); await pool?.end(); if (started) run("rm", "-f", name);
}
