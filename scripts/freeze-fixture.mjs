// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fixtureURL, validateExhibition } from "@exhibitos/spec";
import { FileBlobStore, sha256 } from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
import { loadViewerFixtures } from "./viewer-fixtures.mjs";
import { syntheticWav } from "./experience-fixture.mjs";
import { navigationFixture } from "./navigation-fixture.mjs";
import { oexFixture } from "./oex-fixture.mjs";

/** Real approved synthetic CMS geometry, image, audio and authenticated draft. */
export async function createFreezeFixture(pool, options = {}) {
  let app;
  const tenant = randomUUID(), destination = randomUUID(), pass = "Synthetic-OEX-password123", origin = options.origin ?? "http://127.0.0.1:3000", headers = { host: new URL(origin).host, origin };
  await bootstrap(pool, tenant, "synthetic.oex.admin", pass);
  const blobs = options.blobs ?? new FileBlobStore(await mkdtemp(`${tmpdir()}/exhibitos-oex-blobs-`));
  app = buildApp({ pool, blobs, ...options.appOptions, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
  await options.configureApp?.(app);
  const expected = async (promise, status, code) => { const response = await promise; assert.equal(response.statusCode, status, response.body); if (code) assert.equal(response.json().code, code); return response; };
  const json = async (promise, status = 200, code) => (await expected(promise, status, code)).json();
  const login = async (subject, tenantId = tenant) => {
    const response = await expected(app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { subject, password: pass, tenantId } }), 200);
    const cookie = response.headers["set-cookie"].split(";")[0];
    return { cookie, tenantId, ...(await app.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie } })).json() };
  };
  const request = (actor, method, path, payload, extra = {}, tenantId = actor?.tenantId ?? tenant) => app.inject({ method, url: `/api/v1/tenants/${tenantId}${path}`,
    headers: { ...headers, ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrfToken } : {}), ...(Buffer.isBuffer(payload) ? { "content-type": "application/octet-stream" } : {}), ...extra },
    ...(payload === undefined ? {} : { payload }) });
  const admin = await login("synthetic.oex.admin"), actors = { admin };
  for (const role of ["artist", "other", "viewer", "curator"]) {
    await expected(request(admin, "POST", "/users", { subject: `synthetic.oex.${role}`, password: pass, role: role === "other" ? "artist" : role }), 201);
    actors[role] = await login(`synthetic.oex.${role}`);
  }
  await pool.query("INSERT INTO tenants(id,name) VALUES($1,'Synthetic fresh OEX destination')", [destination]);
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'artist')", [destination, actors.artist.userId]);
  const destinationActor = await login("synthetic.oex.artist", destination);
  const rights = { holder: "Original synthetic OEX owner", ownership: "owner", licenseId: "CC0-1.0", permissions: { display: true, download: true, export: true, commercial: false }, creditLine: "Synthetic preservation credit" };
  const artist = await json(request(actors.artist, "POST", "/cms/artists", { name: "Original synthetic OEX artist", bio: "Synthetic preservation biography" }), 201);
  const imports = new Imports(pool, blobs), fixtureBytes = loadViewerFixtures(), bytesByAsset = new Map();
  const createApproved = async type => {
    const bytes = fixtureBytes.find(value => value.type === type).bytes;
    const art = await json(request(actors.artist, "POST", "/cms/artworks", { artistId: artist.id, title: `Original OEX ${type}`, description: "Preserve original metadata and punctuation <script>literal</script>.", medium: "Original synthetic medium", creationYear: 2024,
      dimensions: { width: 1, height: 1, depth: type === "image" ? .02 : 1, unit: "m" }, rights, provenance: { source: "human-authored", sourceUnits: "m", scaleApplied: true, notes: "Synthetic preservation provenance" } }), 201);
    const job = await json(request(actors.artist, "POST", "/imports", { artworkId: art.id, idempotencyKey: randomUUID(), mime: type === "image" ? "image/png" : "model/gltf-binary", sha256: sha256(bytes), bytes: bytes.length, scaleMeters: 1, rights }), 201);
    await expected(request(actors.artist, "PUT", `/imports/${job.id}/bytes`, bytes), 200);
    await expected(request(actors.artist, "POST", `/imports/${job.id}/complete`), 200); assert.equal(await imports.work(), true);
    const done = await json(request(actors.artist, "GET", `/imports/${job.id}`)); assert.equal(done.state, "approved");
    await expected(request(actors.artist, "POST", `/cms/artworks/${art.id}/approve`, { revision: 1, assetId: done.assetId }), 200);
    const snapshot = (await json(request(actors.artist, "GET", `/studio/artworks/${art.id}`))).artwork;
    bytesByAsset.set(snapshot.primaryAssetId, bytes); return snapshot;
  };
  const works = [await createApproved("sculpture"), await createApproved("image")];
  const template = JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8")), base = navigationFixture(template, works).document;
  const at = new Date().toISOString(), baseDraft = { schemaVersion: "1.0.0-draft.1", kind: "exhibition-draft", id: randomUUID(), exhibitionId: base.id, editVersion: 1, createdAt: at, updatedAt: at, candidate: base };
  const saved = await json(request(actors.artist, "POST", "/studio/exhibitions", { draft: baseDraft, requestId: randomUUID() }), 201);
  const wave = syntheticWav(), audioPath = `/studio/exhibitions/${base.id}/audio`;
  const audio = await json(request(actors.artist, "POST", audioPath, { requestId: randomUUID(), mime: "audio/wav", bytes: wave.length, sha256: sha256(wave), rights }), 201);
  await expected(request(actors.artist, "PUT", `${audioPath}/${audio.id}/bytes`, wave), 200);
  const approvedAudio = await json(request(actors.artist, "POST", `${audioPath}/${audio.id}/approve`, { revision: 1 }));
  const draft = oexFixture(template, works, approvedAudio.mediaAsset);
  draft.id = baseDraft.id; draft.exhibitionId = base.id; draft.candidate.id = base.id; draft.editVersion = 2;
  bytesByAsset.set(audio.id, wave);
  assert.equal(validateExhibition(draft.candidate).valid, true, JSON.stringify(validateExhibition(draft.candidate)));
  const updated = await json(request(actors.artist, "PUT", `/studio/exhibitions/${base.id}`, { draft, requestId: randomUUID() }, { "if-match": saved.etag }));
  return { app, blobs, tenant, destination, actors, destinationActor, password: pass, subject: "synthetic.oex.artist", origin,
    headers, request, json, expected, login, artist, works, wave, audio, bytesByAsset, draft, saved: updated, path: `/studio/exhibitions/${base.id}` };
}
