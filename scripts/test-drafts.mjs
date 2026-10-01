import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { fixtureURL } from "@exhibitos/spec";
import { migrate, FileBlobStore } from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
const docker = process.env.DOCKER_BIN ?? "docker",
  name = `exhibitos-drafts-test-${randomUUID()}`,
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
const test = async (title, fn) => {
  await fn();
  evidence.push(title);
  console.log(`PASS ${title}`);
};
try {
  run(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `exhibitos.drafts.test=${name}`,
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
    "005_cms.sql",
  );
  const prior = randomUUID(),
    priorExhibition = randomUUID();
  await pool.query(
    "INSERT INTO tenants(id,name) VALUES($1,'Synthetic pre-Studio tenant')",
    [prior],
  );
  await pool.query(
    "INSERT INTO exhibitions(tenant_id,id,metadata) VALUES($1,$2,$3)",
    [prior, priorExhibition, { title: "Legacy remains intact" }],
  );
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
  );
  await test("forward migration retains legacy exhibitions without assigning draft ownership", async () => {
    const row = (
      await pool.query("SELECT * FROM exhibitions WHERE id=$1", [
        priorExhibition,
      ])
    ).rows[0];
    assert.equal(row.metadata.title, "Legacy remains intact");
    assert.equal(row.studio_managed, false);
    assert.equal(row.studio_owner_user_id, null);
  });
  const tenant = randomUUID(),
    pass = "Synthetic-drafts-password123";
  await bootstrap(pool, tenant, "synthetic.drafts.admin", pass);
  const blobs = new FileBlobStore(
      await mkdtemp(`${tmpdir()}/exhibitos-drafts-blobs-`),
    ),
    origin = "http://127.0.0.1:3000",
    headers = { host: "127.0.0.1:3000", origin };
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
  const login = async (subject) => {
    const res = await expected(
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers,
        payload: { subject, password: pass, tenantId: tenant },
      }),
      200,
    );
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
  const request = (actor, method, path, payload, extra = {}) =>
    app.inject({
      method,
      url: `/api/v1/tenants/${tenant}${path}`,
      headers: {
        ...headers,
        ...(actor
          ? { cookie: actor.cookie, "x-csrf-token": actor.csrfToken }
          : {}),
        ...extra,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const admin = await login("synthetic.drafts.admin"),
    actors = { admin };
  for (const role of ["artist", "curator", "viewer"]) {
    await expected(
      request(admin, "POST", "/users", {
        subject: `synthetic.drafts.${role}`,
        password: pass,
        role,
      }),
      201,
    );
    actors[role] = await login(`synthetic.drafts.${role}`);
  }
  await expected(
    request(admin, "POST", "/users", {
      subject: "synthetic.drafts.other",
      password: pass,
      role: "artist",
    }),
    201,
  );
  actors.other = await login("synthetic.drafts.other");
  const candidate = JSON.parse(
    await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8"),
  );
  candidate.id = randomUUID();
  candidate.revisionId = randomUUID();
  const time = new Date().toISOString(),
    draft = {
      schemaVersion: "1.0.0-draft.1",
      id: randomUUID(),
      exhibitionId: candidate.id,
      kind: "exhibition-draft",
      editVersion: 1,
      createdAt: time,
      updatedAt: time,
      candidate,
    };
  let created, latest;
  await test("artist-owned create and concurrent exact replay produce one durable revision/receipt", async () => {
    const input = { draft, requestId: randomUUID() },
      results = await Promise.all([
        request(actors.artist, "POST", "/studio/exhibitions", input),
        request(actors.artist, "POST", "/studio/exhibitions", input),
      ]);
    for (const r of results) assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(results[0].json(), results[1].json());
    created = results[0].json();
    assert.equal(results[0].headers.etag, created.etag);
    assert.equal(results[0].headers["cache-control"], "no-store");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM exhibition_revisions WHERE exhibition_id=$1",
          [draft.exhibitionId],
        )
      ).rows[0].count,
      "1",
    );
    await expected(
      request(actors.artist, "POST", "/studio/exhibitions", {
        ...input,
        draft: {
          ...draft,
          candidate: { ...candidate, title: "Changed replay" },
        },
      }),
      409,
      "REQUEST_CONFLICT",
    );
  });
  const path = `/studio/exhibitions/${draft.exhibitionId}`;
  await test("tenant/owner/viewer/session/CSRF enforcement and legacy mutation gate", async () => {
    await expected(request(null, "GET", path), 401, "AUTH_REQUIRED");
    for (const actor of [actors.other, actors.curator, actors.viewer])
      await expected(request(actor, "GET", path), 403, "FORBIDDEN");
    await expected(
      request(actors.viewer, "POST", "/studio/exhibitions", {
        draft,
        requestId: randomUUID(),
      }),
      403,
      "FORBIDDEN",
    );
    await expected(
      request(
        actors.artist,
        "PUT",
        path,
        { draft, requestId: randomUUID() },
        { "if-match": created.etag, "x-csrf-token": "invalid" },
      ),
      403,
      "CSRF_REJECTED",
    );
    const cross = await app.inject({
      url: `/api/v1/tenants/${randomUUID()}${path}`,
      headers: { ...headers, cookie: actors.artist.cookie },
    });
    assert.equal(cross.statusCode, 403);
    await expected(
      request(admin, "PATCH", `/exhibitions/${draft.exhibitionId}`, {
        revision: 1,
        metadata: { title: "Bypass" },
      }),
      400,
      "STUDIO_ROUTE_REQUIRED",
    );
    await expected(request(admin, "GET", path), 200);
  });
  await test("full public schema and semantic refs reject invalid remote documents", async () => {
    for (const mutate of [
      (d) => {
        d.candidate.rooms = [];
      },
      (d) => {
        d.candidate.placements[0].roomId = randomUUID();
      },
      (d) => {
        d.candidate.placements[0].transform.rotation = [0, 0, 0, 2];
      },
      (d) => {
        d.candidate.accessibility.artworkDescriptions = [];
      },
      (d) => {
        d.schemaVersion = "future";
      },
    ]) {
      const broken = structuredClone(draft);
      mutate(broken);
      await expected(
        request(
          actors.artist,
          "PUT",
          path,
          { draft: broken, requestId: randomUUID() },
          { "if-match": created.etag },
        ),
        422,
        "DRAFT_INVALID",
      );
    }
    assert.equal(
      (await request(actors.artist, "GET", path)).json().revision,
      1,
    );
  });
  await test("strong single If-Match required; weak/list/wildcard/malformed tags denied", async () => {
    const input = { draft, requestId: randomUUID() };
    await expected(
      request(actors.artist, "PUT", path, input),
      428,
      "IF_MATCH_REQUIRED",
    );
    for (const tag of [
      `W/${created.etag}`,
      `${created.etag}, ${created.etag}`,
      "*",
      "unquoted",
    ])
      await expected(
        request(actors.artist, "PUT", path, input, { "if-match": tag }),
        400,
        "IF_MATCH_INVALID",
      );
  });
  await test("concurrent stale saves preserve winner; exact lost-response replay preserves receipt", async () => {
    const inputA = {
        draft: {
          ...draft,
          editVersion: 2,
          candidate: { ...candidate, title: "Winner A" },
        },
        requestId: randomUUID(),
      },
      inputB = {
        draft: {
          ...draft,
          editVersion: 2,
          candidate: { ...candidate, title: "Winner B" },
        },
        requestId: randomUUID(),
      };
    const results = await Promise.all([
      request(actors.artist, "PUT", path, inputA, { "if-match": created.etag }),
      request(actors.artist, "PUT", path, inputB, { "if-match": created.etag }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 412]);
    const winner = results.find((r) => r.statusCode === 200).json(),
      input = winner.draft.candidate.title === "Winner A" ? inputA : inputB;
    const replay = await expected(
      request(actors.artist, "PUT", path, input, { "if-match": created.etag }),
      200,
    );
    assert.deepEqual(replay.json(), winner);
    latest = (await expected(request(actors.artist, "GET", path), 200)).json();
    assert.deepEqual(latest, winner);
    assert.equal(latest.revision, 2);
    await expected(
      request(
        actors.artist,
        "PUT",
        path,
        {
          ...input,
          draft: {
            ...input.draft,
            candidate: { ...candidate, title: "Changed receipt" },
          },
        },
        { "if-match": created.etag },
      ),
      409,
      "REQUEST_CONFLICT",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM exhibition_revisions WHERE exhibition_id=$1",
          [draft.exhibitionId],
        )
      ).rows[0].count,
      "2",
    );
  });
  await test("role change immediately invalidates protected draft access and cached receipt paths", async () => {
    await expected(
      request(admin, "PUT", `/memberships/${actors.artist.userId}`, {
        role: "viewer",
      }),
      200,
    );
    await expected(request(actors.artist, "GET", path), 401, "AUTH_REQUIRED");
    const refreshed = await login("synthetic.drafts.artist");
    await expected(request(refreshed, "GET", path), 403, "FORBIDDEN");
    await expected(
      request(admin, "PUT", `/memberships/${actors.artist.userId}`, {
        role: "artist",
      }),
      200,
    );
  });
  await test("remote draft snapshots and idempotency receipts are immutable", async () => {
    await assert.rejects(
      pool.query(
        "UPDATE exhibition_revisions SET snapshot=$1 WHERE exhibition_id=$2",
        [{}, draft.exhibitionId],
      ),
      /immutable revision/,
    );
    await assert.rejects(
      pool.query(
        "UPDATE studio_requests SET response=$1 WHERE exhibition_id=$2",
        [{}, draft.exhibitionId],
      ),
      /immutable revision/,
    );
  });
  await test("quiesced PostgreSQL backup restores complete Studio snapshots and receipts", async () => {
    const maintenance = await pool.connect();
    let dump;
    try {
      await maintenance.query("SELECT pg_advisory_lock(82002)");
      dump = execFileSync(
        docker,
        ["exec", name, "pg_dump", "-U", "postgres", "-Fc", "postgres"],
        { timeout: 120000 },
      );
    } finally {
      await maintenance.query("SELECT pg_advisory_unlock(82002)");
      maintenance.release();
    }
    run("exec", name, "createdb", "-U", "postgres", "restored");
    execFileSync(
      docker,
      ["exec", "-i", name, "pg_restore", "-U", "postgres", "-d", "restored"],
      { input: dump, timeout: 120000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const restored = new Pool({
      host: "127.0.0.1",
      port: Number(run("port", name, "5432/tcp").split(":").at(-1)),
      user: "postgres",
      password,
      database: "restored",
    });
    try {
      for (const table of [
        "exhibitions",
        "exhibition_revisions",
        "studio_requests",
      ]) {
        const sql = `SELECT row_to_json(t) AS value FROM ${table} t ORDER BY row_to_json(t)::text`;
        assert.deepEqual(
          (await restored.query(sql)).rows,
          (await pool.query(sql)).rows,
        );
      }
    } finally {
      await restored.end();
    }
  });
  if (process.env.EXHIBITOS_DRAFTS_SKIP_BROWSER !== "1") {
    const { runDraftStoreBrowser } = await import("./drafts-store-browser.mjs");
    const storeChecks = await runDraftStoreBrowser();
    for (const title of storeChecks) {
      evidence.push(title);
      console.log(`PASS ${title}`);
    }
    const { runDraftsBrowser } = await import("./drafts-browser.mjs");
    const browser = await runDraftsBrowser({
      pool,
      blobs,
      tenantId: tenant,
      subject: "synthetic.drafts.artist",
      password: pass,
      otherSubject: "synthetic.drafts.other",
    });
    evidence.push(...browser.checks);
    console.log(JSON.stringify({ browser }, null, 2));
  }
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks: evidence,
        scope:
          process.env.EXHIBITOS_DRAFTS_SKIP_BROWSER === "1"
            ? "Real isolated PostgreSQL/API only; browser not run in this invocation."
            : "Real isolated PostgreSQL/API and production-browser offline authoring; synthetic metadata only.",
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  await pool?.end();
  if (started) run("rm", "-f", name);
}
