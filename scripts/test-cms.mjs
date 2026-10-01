import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { fixtureURL } from "@exhibitos/spec";
import {
  migrate,
  FileBlobStore,
  sha256,
  Storage,
} from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports, decode } from "../apps/api/dist/imports.js";
import { runCmsBrowser } from "./cms-browser.mjs";
import { derivative } from "../apps/api/dist/derivative.js";
const docker = process.env.DOCKER_BIN ?? "docker",
  name = `exhibitos-cms-test-${randomUUID()}`,
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
let started = false,
  pool,
  app;
const evidence = [];
const test = async (title, work) => {
  await work();
  evidence.push(title);
  console.log(`PASS ${title}`);
};
const glb = await readFile(fixtureURL("fixtures/synthetic/sculpture.glb"));
const originalRights = JSON.parse(
  await readFile(fixtureURL("oes/v1/examples/sculpture.json")),
).rights;
function mutated(data, change) {
  const len = data.readUInt32LE(12),
    doc = JSON.parse(data.toString("utf8", 20, 20 + len));
  change(doc);
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.concat([
      json,
      Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    ]),
    tail = data.subarray(20 + len),
    header = Buffer.from(data.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, tail]);
}
function morphed(data) {
  const len = data.readUInt32LE(12),
    doc = JSON.parse(data.toString("utf8", 20, 20 + len)),
    bin = data.subarray(28 + len);
  const count =
      doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION].count,
    extra = Buffer.alloc(count * 12);
  for (let i = 0; i < count; i++) extra.writeFloatLE(100, i * 12);
  const view = doc.bufferViews.length;
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: bin.length,
    byteLength: extra.length,
  });
  const accessor = doc.accessors.length;
  doc.accessors.push({
    bufferView: view,
    componentType: 5126,
    count,
    type: "VEC3",
    min: [100, 0, 0],
    max: [100, 0, 0],
  });
  doc.meshes[0].primitives[0].targets = [{ POSITION: accessor }];
  doc.meshes[0].weights = [1];
  doc.buffers[0].byteLength = bin.length + extra.length;
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.concat([
      json,
      Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    ]),
    header = Buffer.from(data.subarray(0, 20)),
    bh = Buffer.alloc(8);
  header.writeUInt32LE(28 + padded.length + bin.length + extra.length, 8);
  header.writeUInt32LE(padded.length, 12);
  bh.writeUInt32LE(bin.length + extra.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, bh, bin, extra]);
}
function translated(data, scale = false) {
  const len = data.readUInt32LE(12),
    doc = JSON.parse(data.toString("utf8", 20, 20 + len));
  doc.nodes[0][scale ? "scale" : "translation"] = scale
    ? [2, 2, 2]
    : [100, 0, 0];
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.concat([
      json,
      Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    ]),
    tail = data.subarray(20 + len),
    header = Buffer.from(data.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, tail]);
}
try {
  await test("actual bounded GLB display derivative changes bytes, validates, rejects translated/scaled models", async () => {
    const output = await derivative(glb, "model/gltf-binary");
    await decode(output, "model/gltf-binary");
    assert.notEqual(sha256(output), sha256(glb));
    const doc = JSON.parse(
      output.toString("utf8", 20, 20 + output.readUInt32LE(12)),
    );
    assert.ok(
      doc.nodes.some((n) => n.name === "ExhibitOS display copy watermark"),
    );
    for (const bytes of [
      translated(glb),
      translated(glb, true),
      mutated(glb, (d) => {
        d.meshes.push(structuredClone(d.meshes[0]));
      }),
      morphed(glb),
      mutated(glb, (d) => {
        for (let i = 0; i < 256; i++) {
          d.nodes.push({ mesh: 0 });
          d.scenes[0].nodes.push(d.nodes.length - 1);
        }
      }),
    ]) {
      await decode(bytes, "model/gltf-binary");
      await assert.rejects(derivative(bytes, "model/gltf-binary"));
    }
  });
  run(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `exhibitos.cms.test=${name}`,
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
  for (let i = 0; ; i++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (e) {
      if (i >= 90) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
    "004_import.sql",
  );
  const forwardTenant = randomUUID(),
    forwardUser = randomUUID(),
    forwardArtist = randomUUID();
  await pool.query(
    "INSERT INTO tenants(id,name) VALUES($1,'Synthetic forward fixture')",
    [forwardTenant],
  );
  await pool.query(
    "INSERT INTO users(id,subject) VALUES($1,'synthetic.forward.artist')",
    [forwardUser],
  );
  await pool.query(
    "INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)",
    [
      forwardTenant,
      forwardArtist,
      forwardUser,
      { name: "Existing synthetic artist", bio: "Current snapshot" },
    ],
  );
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT snapshot FROM artist_revisions WHERE artist_id=$1",
        [forwardArtist],
      )
    ).rows[0].snapshot.name,
    "Existing synthetic artist",
  );
  const tenant = randomUUID(),
    pass = "Synthetic-cms-password123",
    admin = await bootstrap(pool, tenant, "synthetic.cms.admin", pass),
    blobs = new FileBlobStore(
      await mkdtemp(`${tmpdir()}/exhibitos-cms-blobs-`),
    );
  const imports = new Imports(pool, blobs),
    origin = "http://127.0.0.1:3000",
    headers = { host: "127.0.0.1:3000", origin };
  app = buildApp({
    pool,
    blobs,
    auth: { mode: "local", origin, bindHost: "127.0.0.1" },
  });
  const login = async (subject) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { subject, password: pass, tenantId: tenant },
    });
    assert.equal(res.statusCode, 200, res.body);
    const cookie = res.headers["set-cookie"].split(";")[0];
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
  const adminSession = await login("synthetic.cms.admin");
  const request = (actor, method, path, payload) =>
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
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const expected = async (p, status, code) => {
    const r = await p;
    assert.equal(r.statusCode, status, r.body);
    if (code) assert.equal(r.json().code, code);
    return r;
  };
  const json = async (p, status = 200, code) =>
    (await expected(p, status, code)).json();
  let artist, other, viewer;
  for (const [subject, role] of [
    ["synthetic.cms.artist", "artist"],
    ["synthetic.cms.other", "artist"],
    ["synthetic.cms.viewer", "viewer"],
  ]) {
    await expected(
      request(adminSession, "POST", "/users", {
        subject,
        password: pass,
        role,
      }),
      201,
    );
    const s = await login(subject);
    if (role === "viewer") viewer = s;
    else if (subject.endsWith("other")) other = s;
    else artist = s;
  }
  const rights = {
      ...originalRights,
      permissions: {
        display: true,
        download: false,
        export: false,
        commercial: false,
      },
    },
    metadata = {
      title: "Synthetic sculpture <script>not executed</script>",
      description: "Plain text only",
      dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
      rights,
      provenance: {
        source: "human-authored",
        sourceUnits: "m",
        scaleApplied: false,
        notes: "Private source notes",
      },
    };
  let artistRecord, artwork, asset;
  await test("artist identity is separate; artist cannot link another login; tenant/session denies", async () => {
    await expected(
      request(null, "POST", "/cms/artists", { name: "Nobody", bio: "" }),
      401,
    );
    await expected(
      request(artist, "POST", "/cms/artists", {
        name: "Forbidden",
        bio: "",
        userId: other.userId,
      }),
      403,
    );
    artistRecord = await json(
      request(artist, "POST", "/cms/artists", {
        name: "Artist identity",
        bio: "Synthetic profile",
      }),
      201,
    );
    assert.notEqual(artistRecord.id, artist.userId);
    assert.equal(artistRecord.userId, artist.userId);
    await expected(
      request(other, "GET", `/cms/artists/${artistRecord.id}`),
      403,
    );
    await expected(request(viewer, "GET", "/cms/artists"), 403);
  });
  await test("artist edit CAS, immutable history and reversible archive/restore", async () => {
    let profile = await json(
      request(artist, "POST", "/cms/artists", {
        name: "Archive profile",
        bio: "No artworks",
      }),
      201,
    );
    profile = await json(
      request(artist, "PATCH", `/cms/artists/${profile.id}`, {
        revision: 1,
        name: "Edited archive profile",
        bio: "Synthetic",
      }),
    );
    assert.equal(profile.revision, 2);
    await expected(
      request(artist, "PATCH", `/cms/artists/${profile.id}`, {
        revision: 1,
        name: "Stale",
        bio: "",
      }),
      409,
      "REVISION_CONFLICT",
    );
    profile = await json(
      request(artist, "POST", `/cms/artists/${profile.id}/archive`, {
        revision: 2,
      }),
    );
    assert.equal(profile.archived, true);
    profile = await json(
      request(artist, "POST", `/cms/artists/${profile.id}/restore`, {
        revision: 3,
      }),
    );
    assert.equal(profile.archived, false);
    assert.equal(profile.revision, 4);
    assert.equal(
      (
        await json(
          request(artist, "GET", `/cms/artists/${profile.id}/revisions`),
        )
      ).items.length,
      4,
    );
    await assert.rejects(
      pool.query("UPDATE artist_revisions SET snapshot=$1 WHERE artist_id=$2", [
        {},
        profile.id,
      ]),
    );
  });
  await test("create artwork, physical dimensions/fullrights validation, CAS and immutable revisions", async () => {
    await expected(
      request(artist, "POST", "/cms/artworks", {
        artistId: artistRecord.id,
        ...metadata,
        dimensions: { width: 0, height: 1, depth: 1, unit: "m" },
      }),
      400,
    );
    await expected(
      request(artist, "POST", "/cms/artworks", {
        artistId: artistRecord.id,
        ...metadata,
        rights: { display: true },
      }),
      400,
      "INVALID_METADATA",
    );
    artwork = await json(
      request(artist, "POST", "/cms/artworks", {
        artistId: artistRecord.id,
        ...metadata,
      }),
      201,
    );
    assert.equal(artwork.revision, 1);
    await expected(
      request(other, "PATCH", `/cms/artworks/${artwork.id}`, {
        ...metadata,
        revision: 1,
      }),
      403,
    );
    artwork = await json(
      request(artist, "PATCH", `/cms/artworks/${artwork.id}`, {
        ...metadata,
        title: "Edited synthetic sculpture",
        revision: 1,
      }),
    );
    assert.equal(artwork.revision, 2);
    await expected(
      request(artist, "PATCH", `/cms/artworks/${artwork.id}`, {
        ...metadata,
        revision: 1,
      }),
      409,
      "REVISION_CONFLICT",
    );
    await expected(
      request(artist, "PATCH", `/artworks/${artwork.id}`, {
        revision: 2,
        metadata: { title: "erase rights" },
      }),
      400,
      "CMS_ROUTE_REQUIRED",
    );
    const history = await json(
      request(artist, "GET", `/cms/artworks/${artwork.id}/revisions`),
    );
    assert.equal(history.items.length, 2);
    await assert.rejects(
      pool.query(
        "UPDATE artwork_revisions SET snapshot=$1 WHERE artwork_id=$2",
        [{}, artwork.id],
      ),
    );
  });
  await test("upload→formatapproved→reviewed revision; replayreview idempotent; original/export denied", async () => {
    const j = await json(
      request(artist, "POST", "/imports", {
        artworkId: artwork.id,
        idempotencyKey: randomUUID(),
        mime: "model/gltf-binary",
        sha256: sha256(glb),
        bytes: glb.length,
        scaleMeters: 1,
        rights,
      }),
      201,
    );
    await expected(request(artist, "PUT", `/imports/${j.id}/bytes`, glb), 200);
    await expected(request(artist, "POST", `/imports/${j.id}/complete`), 200);
    await imports.work();
    const ready = await json(request(artist, "GET", `/imports/${j.id}`));
    asset = ready.assetId;
    assert.equal(ready.state, "approved");
    artwork = await json(
      request(artist, "POST", `/cms/artworks/${artwork.id}/approve`, {
        revision: 2,
        assetId: asset,
      }),
    );
    assert.equal(artwork.approvedRevision, 2);
    await expected(
      request(artist, "POST", `/cms/artworks/${artwork.id}/approve`, {
        revision: 2,
        assetId: asset,
      }),
      200,
    );
    await expected(
      request(artist, "GET", `/assets/${asset}/bytes`),
      403,
      "RIGHTS_DENIED",
    );
    await expected(
      request(artist, "POST", `/assets/${asset}/export-check`),
      403,
      "RIGHTS_DENIED",
    );
    const preview = await expected(
      request(artist, "GET", `/cms/artworks/${artwork.id}/preview`),
      200,
    );
    assert.equal(preview.headers["x-exhibitos-watermarked"], "true");
    await decode(preview.rawPayload, "model/gltf-binary");
    assert.notEqual(sha256(preview.rawPayload), sha256(glb));
    assert.deepEqual(
      await new Storage(pool, blobs).reconcile(
        { tenantId: tenant, userId: admin.userId },
        true,
      ),
      [],
    );
  });
  await test("CMS rights ceiling denies newly imported per-asset broad grants before review", async () => {
    const broad = {
      ...rights,
      permissions: { ...rights.permissions, download: true, export: true },
    };
    const job = await json(
      request(artist, "POST", "/imports", {
        artworkId: artwork.id,
        idempotencyKey: randomUUID(),
        mime: "model/gltf-binary",
        sha256: sha256(glb),
        bytes: glb.length,
        scaleMeters: 1,
        rights: broad,
      }),
      201,
    );
    await expected(
      request(artist, "PUT", `/imports/${job.id}/bytes`, glb),
      200,
    );
    await expected(request(artist, "POST", `/imports/${job.id}/complete`), 200);
    await imports.work();
    const ready = await json(request(artist, "GET", `/imports/${job.id}`));
    await expected(
      request(artist, "GET", `/assets/${ready.assetId}/bytes`),
      403,
      "RIGHTS_DENIED",
    );
    await expected(
      request(artist, "POST", `/assets/${ready.assetId}/export-check`),
      403,
      "RIGHTS_DENIED",
    );
    const saved = (
      await pool.query("SELECT metadata FROM artworks WHERE id=$1", [
        artwork.id,
      ])
    ).rows[0].metadata;
    await pool.query("UPDATE artworks SET metadata=$2 WHERE id=$1", [
      artwork.id,
      { title: "Malformed managed fixture" },
    ]);
    await expected(
      request(artist, "GET", `/assets/${ready.assetId}/bytes`),
      403,
      "RIGHTS_DENIED",
    );
    await pool.query("UPDATE artworks SET metadata=$2 WHERE id=$1", [
      artwork.id,
      saved,
    ]);
  });
  await test("display serializer excludes private notes, object paths, identities and rights; viewer assignment gates derivative", async () => {
    const display = await json(
      request(artist, "GET", `/cms/artworks/${artwork.id}/display`),
    );
    assert.equal(display.originalDownload, false);
    assert.equal(display.export, false);
    for (const name of [
      "provenance",
      "userId",
      "rights",
      "objectKey",
      "object_key",
      "assetId",
    ])
      assert.equal(name in display, false);
    await expected(
      request(viewer, "GET", `/cms/artworks/${artwork.id}/preview`),
      403,
    );
    const exhibition = randomUUID(),
      room = randomUUID();
    await pool.query(
      "INSERT INTO exhibitions(tenant_id,id,metadata) VALUES($1,$2,'{}')",
      [tenant, exhibition],
    );
    await pool.query(
      "INSERT INTO rooms(tenant_id,id,metadata,exhibition_id) VALUES($1,$2,'{}',$3)",
      [tenant, room, exhibition],
    );
    await pool.query(
      "INSERT INTO placements(tenant_id,id,metadata,room_id,artwork_id) VALUES($1,$2,'{}',$3,$4)",
      [tenant, randomUUID(), room, artwork.id],
    );
    await pool.query(
      "INSERT INTO exhibition_assignments VALUES($1,$2,$3,true)",
      [tenant, exhibition, viewer.userId],
    );
    await expected(
      request(viewer, "GET", `/cms/artworks/${artwork.id}/preview`),
      200,
    );
    await expected(request(viewer, "GET", `/assets/${asset}/bytes`), 403);
    await expected(request(viewer, "GET", `/cms/artworks/${artwork.id}`), 403);
  });
  await test("edit invalidates approval; narrower rights revoke original/derivative; softarchive reversible", async () => {
    artwork = await json(
      request(artist, "PATCH", `/cms/artworks/${artwork.id}`, {
        ...metadata,
        rights: {
          ...rights,
          permissions: { ...rights.permissions, display: false },
        },
        revision: 2,
      }),
    );
    assert.equal(artwork.approvedRevision, null);
    await expected(
      request(artist, "GET", `/cms/artworks/${artwork.id}/preview`),
      409,
      "REVISION_NOT_APPROVED",
    );
    await expected(
      request(artist, "POST", `/cms/artworks/${artwork.id}/approve`, {
        revision: 3,
        assetId: asset,
      }),
      403,
      "RIGHTS_DENIED",
    );
    await expected(
      request(artist, "POST", `/cms/artists/${artistRecord.id}/archive`, {
        revision: 1,
      }),
      409,
      "ARTIST_HAS_ARTWORKS",
    );
    artwork = await json(
      request(artist, "POST", `/cms/artworks/${artwork.id}/archive`, {
        revision: 3,
      }),
    );
    assert.equal(artwork.archived, true);
    await expected(request(artist, "GET", `/assets/${asset}/bytes`), 403);
    await expected(
      request(artist, "GET", `/cms/artworks/${artwork.id}/preview`),
      403,
    );
    artwork = await json(
      request(artist, "POST", `/cms/artworks/${artwork.id}/restore`, {
        revision: 4,
      }),
    );
    assert.equal(artwork.archived, false);
    assert.equal(artwork.revision, 5);
  });
  await test("literal filter and cursor pagination restricted to owner, bounded and no duplicate IDs", async () => {
    for (let i = 0; i < 3; i++)
      await expected(
        request(artist, "POST", "/cms/artworks", {
          ...metadata,
          title: `Page ${i}`,
          artistId: artistRecord.id,
        }),
        201,
      );
    const one = await json(
      request(artist, "GET", "/cms/artworks?limit=2&q=Page"),
    );
    assert.equal(one.items.length, 2);
    assert.ok(one.nextCursor);
    const two = await json(
      request(
        artist,
        "GET",
        `/cms/artworks?limit=2&q=Page&cursor=${one.nextCursor}`,
      ),
    );
    assert.equal(two.items.length, 1);
    assert.equal(
      new Set([...one.items, ...two.items].map((x) => x.id)).size,
      3,
    );
    assert.equal(
      (await json(request(other, "GET", "/cms/artworks"))).items.length,
      0,
    );
    await expected(request(artist, "GET", "/cms/artworks?limit=100000"), 400);
    assert.equal(
      (await json(request(artist, "GET", "/cms/artworks?q=%25"))).items.length,
      0,
    );
  });
  await expected(
    request(adminSession, "POST", "/users", {
      subject: "synthetic.cms.browser",
      password: pass,
      role: "artist",
    }),
    201,
  );
  const browser = await runCmsBrowser({
    pool,
    blobs,
    tenantId: tenant,
    subject: "synthetic.cms.browser",
    otherSubject: "synthetic.cms.other",
    password: pass,
    work: () => imports.work(),
  });
  evidence.push(...browser.checks);
  console.log(JSON.stringify({ browser }, null, 2));
  console.log(
    JSON.stringify(
      {
        valid: true,
        checks: evidence.length,
        evidence,
        image,
        scope:
          "synthetic isolated PostgreSQL/API/child derivative; actual production Chromium17 groups included, no DRM or public publication claim",
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  await pool?.end();
  if (
    started &&
    run(
      "inspect",
      "--format",
      '{{index .Config.Labels "exhibitos.cms.test"}}',
      name,
    ) === name
  )
    run("rm", "-f", "-v", name);
}
