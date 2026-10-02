// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, readdir } from "node:fs/promises";
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
const docker = process.env.DOCKER_BIN ?? "docker",
  name = `exhibitos-navigation-test-${randomUUID()}`,
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
    "006_studio.sql",
  );
  const existing = (
    await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
  );
  await test("additive publication migration preserves all earlier migration checksums", async () => {
    assert.deepEqual(
      (
        await pool.query(
          "SELECT name,sha256 FROM schema_migrations WHERE name<'007' ORDER BY name",
        )
      ).rows,
      existing,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n,
      9,
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
  const login = async (subject) => {
    const r = await expected(
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers,
        payload: { subject, password: pass, tenantId: tenant },
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
  const pub = await json(
    request(
      actors.artist,
      "POST",
      `/studio/exhibitions/${candidate.id}/publications`,
      { requestId: randomUUID() },
      { "if-match": saved.etag },
    ),
    201,
  );
  await test("approved synthetic room/door/window/artwork fixture publishes an immutable safe projection", async () => {
    const p = await json(
      anonymous(`/api/v1/publications/${pub.publicationId}`),
    );
    assert.equal(p.exhibition.rooms.length, 2);
    assert.equal(p.exhibition.placements.length, 2);
    assert.equal(p.assets.length, 4);
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
  await app.listen({ host: "127.0.0.1", port });
  if (process.env.EXHIBITOS_NAVIGATION_NATIVE_EXTERNAL === "1") {
    // Test-only fixture server: no Playwright import/browser, no operator signal
    // is interpreted as proof. Root separately records actual native DOM states.
    const externalTimeout = Number(process.env.EXHIBITOS_NAVIGATION_NATIVE_TIMEOUT_MS ?? 300000);
    assert(Number.isSafeInteger(externalTimeout) && externalTimeout >= 1000 && externalTimeout <= 1800000,
      "External native fixture timeout must be an integer from1000 to1800000ms");
    const evidenceDir = await mkdtemp(`${tmpdir()}/exhibitos-navigation-external-`),
      descriptorPath = `${evidenceDir}/fixture.json`,
      completionSignal = `${evidenceDir}/operator-complete.json`,
      metadataResponse = await fetch(`${browserOrigin}/api/v1/publications/${pub.publicationId}`);
    assert.equal(metadataResponse.status, 200);
    const projection = await metadataResponse.json(),
      inventory = projection.exhibition.artworks.flatMap((art) => art.assets),
      publicAssets = [];
    for (const slot of projection.assets) {
      const entry = inventory.find((asset) => asset.id.toLowerCase() === slot.assetId.toLowerCase()),
        response = await fetch(`${browserOrigin}${slot.url}`);
      assert(entry);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-exhibitos-publication-revision"),pub.revisionSha256);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(bytes),entry.sha256);
      assert.equal(bytes.length,entry.bytes);
      publicAssets.push({assetId:slot.assetId,url:slot.url,mime:slot.mime,bytes:bytes.length,sha256:sha256(bytes)});
    }
    const productionAssets = [];
    for (const file of ["index.html",...[...assets].sort().map((file)=>`assets/${file}`)]) {
      const bytes = await readFile(new URL(file,dist));
      productionAssets.push({path:file,bytes:bytes.length,sha256:sha256(bytes)});
    }
    const navigationSource = await readFile(new URL("../apps/web/src/viewer/navigation.ts",import.meta.url)),
      deadline = Date.now()+externalTimeout,
      descriptor = {
        mode:"external-native-fixture",source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
        dirtySource:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim(),
        createdAt:new Date().toISOString(),expiresAt:new Date(deadline).toISOString(),
        publicUrl:`${browserOrigin}/p/${pub.publicationId}`,metadataUrl:`${browserOrigin}/api/v1/publications/${pub.publicationId}`,
        publication:projection.publication,geometry:fixture.geometry,
        profile:{sourceSha256:sha256(navigationSource),declaration:navigationSource.toString().split("\n").find(line=>line.includes("export const NAVIGATION_PROFILE =")),runtimeQualification:"Read actual canvas.dataset.navigationProfile after explicit walking initialization; source declaration is not runtime proof.",lod:projection.exhibition.artworks.map(art=>({revisionId:art.revisionId,variants:art.extensions["org.exhibitos.viewer/lod"]}))},
        productionAssets,publicAssets,completionSignal,
        completionInstructions:"Write {\"complete\":true} to completionSignal to request cleanup. Signal is operator completion only, never native input pass evidence.",
        qualification:"Fixture ready only. Root must independently record actual native acquisition, yaw movement, Escape unlock+paused state and source identity.",
        checks,
      };
    await writeFile(descriptorPath,JSON.stringify(descriptor,null,2)+"\n");
    console.log(`NATIVE EXTERNAL FIXTURE ${descriptorPath}`);
    console.log(`NATIVE EXTERNAL URL ${descriptor.publicUrl}; completion signal ${completionSignal}; timeout ${externalTimeout}ms`);
    let completed = false;
    while (Date.now()<deadline) {
      try {
        const signal = JSON.parse(await readFile(completionSignal,"utf8"));
        if (signal.complete === true) {completed=true;break;}
      } catch (error) {if(error.code!=="ENOENT")throw error;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    const outcome = {source:descriptor.source,descriptorPath,endedAt:new Date().toISOString(),reason:completed?"operator-completion-signal":"bounded-timeout",qualification:"No native capture result inferred from completion signal; operator evidence is separate."};
    await writeFile(`${evidenceDir}/fixture-outcome.json`,JSON.stringify(outcome,null,2)+"\n");
    console.log(JSON.stringify(outcome,null,2));
  } else {
  const { runNavigationBrowser } = await import("./navigation-browser.mjs");
  const result = await runNavigationBrowser({
    origin: browserOrigin,
    publicationId: pub.publicationId,
    fixture: fixture.geometry,
  });
  checks.push(...result.checks);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        checks,
        scope:
          "Actual isolated PostgreSQL, approved synthetic immutable publication and production browser Rapier walking",
      },
      null,
      2,
    ),
  );
  }
} finally {
  await app?.close();
  await pool?.end();
  if (started) run("rm", "-f", name);
}
