// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, symlink, unlink, lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { fixtureURL, validateExhibition, validateOex, revisionHash, packageMediaAssetManifest } from "@exhibitos/spec";
import { migrate, FileBlobStore, sha256 } from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
import { Oex } from "../apps/api/dist/oex.js";
import { loadViewerFixtures } from "./viewer-fixtures.mjs";
import { syntheticWav } from "./experience-fixture.mjs";
import { navigationFixture } from "./navigation-fixture.mjs";
import { oexFixture } from "./oex-fixture.mjs";
import { exportedEntries, fixtureZip } from "./oex-test-zip.mjs";

const docker = process.env.DOCKER_BIN ?? "docker", name = `exhibitos-oex-test-${randomUUID()}`,
  password = randomBytes(24).toString("hex"), checks = [];
const run = (...args) => execFileSync(docker, args, { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const image = JSON.parse(await readFile(new URL("../database/images.json", import.meta.url))).postgres;
const reportDir = await mkdtemp(`${tmpdir()}/exhibitos-oex-report-`);
let pool, app, started = false;
const test = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
try {
  run("run", "-d", "--name", name, "--label", `exhibitos.oex.test=${name}`, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, image); started = true;
  pool = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "postgres", statement_timeout: 10000 });
  for (let n = 0; ; n++) { try { await pool.query("SELECT 1"); break; } catch (error) { if (n >= 90) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); } }
  await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname, "008_audio.sql");
  const earlier = (await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")).rows;
  await migrate(pool, new URL("../database/migrations/", import.meta.url).pathname);
  await test("additive OEX migration preserves every existing schema checksum", async () => {
    assert.deepEqual((await pool.query("SELECT name,sha256 FROM schema_migrations WHERE name<'009' ORDER BY name")).rows, earlier);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 10);
  });
  const tenant = randomUUID(), destination = randomUUID(), pass = "Synthetic-OEX-password123", origin = "http://127.0.0.1:3000", headers = { host: "127.0.0.1:3000", origin };
  await bootstrap(pool, tenant, "synthetic.oex.admin", pass);
  const blobs = new FileBlobStore(await mkdtemp(`${tmpdir()}/exhibitos-oex-blobs-`));
  app = buildApp({ pool, blobs, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
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
  draft.candidate.extensions['org.exhibitos.runtime/spatial-scripting']={version:1,rules:[{id:'preserved-oex-rule',once:false,trigger:{type:'room_enter',roomId:draft.candidate.rooms[0].id},actions:[{type:'set_light',lightId:draft.candidate.lights[0].id,multiplier:.4,delayMs:0},{type:'play_audio',mediaAssetId:audio.id,volume:.5,delayMs:800},{type:'set_artwork_visibility',placementId:draft.candidate.placements[0].id,visible:false,delayMs:800},{type:'show_text',text:'Original OEX rule '+draft.candidate.rooms[0].id,locale:'en',delayMs:0}]}]};
  bytesByAsset.set(audio.id, wave);
  assert.equal(validateExhibition(draft.candidate).valid, true, JSON.stringify(validateExhibition(draft.candidate)));
  const updated = await json(request(actors.artist, "PUT", `/studio/exhibitions/${base.id}`, { draft, requestId: randomUUID() }, { "if-match": saved.etag }));
  const exportPath = `/studio/exhibitions/${base.id}/oex/export`;
  const originalCounts = async (tenantId = tenant) => Object.fromEntries(await Promise.all(["artists", "artist_revisions", "artworks", "artwork_revisions", "artwork_approvals", "rights", "assets", "exhibitions", "exhibition_revisions", "studio_requests", "studio_audio", "audio_approvals", "studio_publications", "publication_assets", "publication_media"].map(async table => [table, Number((await pool.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [tenantId])).rows[0].count)])));
  const before = await originalCounts();
  await test("OEX export is exact-revision bound and server enforces owner, tenant, session and CSRF", async () => {
    await expected(request(null, "POST", exportPath, {}, { "if-match": updated.etag }), 401);
    for (const actor of [actors.other, actors.viewer, actors.curator]) await expected(request(actor, "POST", exportPath, {}, { "if-match": updated.etag }), 403);
    await expected(request(actors.artist, "POST", exportPath, {}, { "if-match": updated.etag, "x-csrf-token": "invalid" }), 403);
    await expected(request(actors.artist, "POST", exportPath, {}, { "if-match": saved.etag }), 412);
    await expected(request(destinationActor, "POST", exportPath, {}, { "if-match": updated.etag }, tenant), 403);
  });
  const exported = await expected(request(actors.artist, "POST", exportPath, {}, { "if-match": updated.etag }), 200), archive = exported.rawPayload;
  const modifiedPackage = change => {
    const entries = exportedEntries(archive), manifest = JSON.parse(entries[0][1]), document = JSON.parse(entries[1][1]);
    const renamed = change(document, manifest);
    const documentBytes = Buffer.from(JSON.stringify(document));
    manifest.exhibition.bytes = documentBytes.length; manifest.exhibition.sha256 = sha256(documentBytes); manifest.exhibition.revisionSha256 = revisionHash(document);
    entries[0][1] = Buffer.from(JSON.stringify(manifest)); entries[1][1] = documentBytes;
    return fixtureZip(entries.map(([name, bytes]) => [renamed instanceof Map ? renamed.get(name) ?? name : name, bytes])
      .filter(([name]) => ["manifest.json", "exhibition.json", ...manifest.assets.map(asset => asset.path)].includes(name)));
  };
  await test("actual OEX export contains bounded self-contained GLB PNG PCM and rich scene accepted by public contract", async () => {
    assert.match(exported.headers["content-type"], /^application\/vnd\.exhibitos\.oex\+zip/);
    assert.equal((await validateOex(archive)).valid, true, JSON.stringify(await validateOex(archive)));
    assert.equal(archive.toString("ascii", 0, 2), "PK"); assert.deepEqual(await originalCounts(), before);
    assert.deepEqual(exportedEntries(archive).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), [...bytesByAsset.values()].map(sha256).sort());
  });
  const worker = new Oex(pool, blobs);
  const submit = async (actor, bytes = archive) => {
    const input = { requestId: randomUUID(), bytes: bytes.length, sha256: sha256(bytes) };
    const job = await json(request(actor, "POST", "/oex/imports", input), 201);
    await expected(request(actor, "PUT", `/oex/imports/${job.id}/bytes`, bytes), 200);
    await expected(request(actor, "POST", `/oex/imports/${job.id}/complete`, {}), 200);
    return { job, input };
  };
  let imported;
  await test("export rechecks authoritative current asset export grants and expiry", async () => {
    const rows = (await pool.query("SELECT r.id,r.metadata FROM rights r JOIN assets a ON a.tenant_id=r.tenant_id AND a.rights_id=r.id WHERE a.tenant_id=$1 AND a.id=$2", [tenant, works[0].primaryAssetId])).rows;
    assert.equal(rows.length, 1); const row = rows[0];
    for (const metadata of [{ ...row.metadata, permissions: { ...row.metadata.permissions, export: false } }, { ...row.metadata, expiresAt: "2000-01-01T00:00:00Z" }]) {
      try { await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [tenant, row.id, metadata]);
        await expected(request(actors.artist, "POST", exportPath, {}, { "if-match": updated.etag }), 409, "OEX_SOURCE_CHANGED");
      } finally { await pool.query("UPDATE rights SET metadata=$3 WHERE tenant_id=$1 AND id=$2", [tenant, row.id, row.metadata]); }
    }
  });
  await test("fresh tenant import atomically produces an editable private draft, no publication, receipt retry gives identical result", async () => {
    const { job, input } = await submit(destinationActor);
    assert.equal((await json(request(destinationActor, "GET", `/oex/imports/${job.id}`))).state, "queued");
    assert.equal((await originalCounts(destination)).exhibitions, 0);
    await worker.run(job.id);
    imported = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`));
    assert.equal(imported.state, "complete", JSON.stringify(imported)); assert(imported.result?.draft);
    assert.equal((await originalCounts(destination)).studio_publications, 0);
    assert.deepEqual(await json(request(destinationActor, "POST", "/oex/imports", input), 201), imported);
    await expected(request(destinationActor, "POST", "/oex/imports", { ...input, sha256: "0".repeat(64) }), 409);
    assert.deepEqual(await originalCounts(), before);
  });
  await test("imported scene preserves geometry material lighting routes camera audio transcripts annotations and literal text", async () => {
    const source = draft.candidate, target = imported.result.draft.candidate;
    for (const field of ["title", "units", "coordinates"]) assert.equal(target[field], source[field]);
    for (const field of ["rooms", "surfaces", "openings", "placements", "lights", "navigation", "annotations", "audioZones"]) assert.equal(target[field].length, source[field].length, field);
    assert.deepEqual(target.rooms.map(value => value.dimensions), source.rooms.map(value => value.dimensions));
    assert.deepEqual(target.placements.map(value => value.transform), source.placements.map(value => value.transform));
    assert.deepEqual(target.lights.map(value => ({ color: value.color, intensity: value.intensity })), source.lights.map(value => ({ color: value.color, intensity: value.intensity })));
    assert.equal(target.annotations[0].text, source.annotations[0].text);
    assert.equal(target.extensions["org.exhibitos.studio/presentation"].credits, source.extensions["org.exhibitos.studio/presentation"].credits);
    assert.deepEqual(target.extensions["org.exhibitos.viewer/experience"].voices.map(value => value.transcript), source.extensions["org.exhibitos.viewer/experience"].voices.map(value => value.transcript));
    assert.deepEqual(target.artworks.map(value => value.rights), source.artworks.map(value => value.rights));
    const typedIds = imported.result.idMap;
    const remappedProvenance = value => ({ ...value, events: value.events.map(event => ({ ...event,
      id: typedIds[event.id.toLowerCase()] ?? event.id,
      ...(event.sourceAssetIds ? { sourceAssetIds: event.sourceAssetIds.map(id => typedIds[id.toLowerCase()] ?? id) } : {}) })) });
    for (const [index, artwork] of source.artworks.entries()) {
      assert.deepEqual(target.artworks[index].metadata, artwork.metadata);
      assert.deepEqual(target.artworks[index].dimensions, artwork.dimensions);
      assert.deepEqual(target.artworks[index].provenance, remappedProvenance(artwork.provenance));
      assert.equal(target.artworks[index].createdAt, artwork.createdAt);
    }
    assert.deepEqual(target.mediaAssets.map(value => ({ mime: value.mime, bytes: value.bytes, sha256: value.sha256, rights: value.rights })), source.mediaAssets.map(value => ({ mime: value.mime, bytes: value.bytes, sha256: value.sha256, rights: value.rights })));
    assert.deepEqual(Object.keys(target.extensions["org.exhibitos.studio/materials"].surfaces).sort(), target.surfaces.map(value => value.id).sort());
    for (const [index, surface] of source.surfaces.entries()) assert.deepEqual(target.extensions["org.exhibitos.studio/materials"].surfaces[target.surfaces[index].id], source.extensions["org.exhibitos.studio/materials"].surfaces[surface.id]);
    assert.deepEqual(target.navigation[0].waypoints.map(value => value.roomId), target.rooms.map(value => value.id));
    assert.deepEqual(target.accessibility.routeIds, [target.navigation[0].id]);
    assert.equal(target.scripts[0].enabled, false); assert.equal(target.scripts[0].trigger.roomId, target.rooms[0].id);
    assert.equal(target.scripts[0].actions[0].targetId, target.annotations[0].id);
    assert.equal(target.extensions["org.exhibitos.viewer/experience"].voices[0].placementId, target.placements[0].id);
    assert.equal(target.extensions["org.exhibitos.viewer/experience"].voices[0].assetId, target.mediaAssets[0].id);
    assert.deepEqual(target.extensions["org.exhibitos.studio/presentation"].viewpoints.map(value => value.roomId), target.rooms.map(value => value.id));
    const spatial=target.extensions['org.exhibitos.runtime/spatial-scripting'].rules[0];
    assert.equal(spatial.id,'preserved-oex-rule');assert.equal(spatial.trigger.roomId,target.rooms[0].id);assert.equal(spatial.actions[0].lightId,target.lights[0].id);assert.equal(spatial.actions[1].mediaAssetId,target.mediaAssets[0].id);assert.equal(spatial.actions[2].placementId,target.placements[0].id);assert.equal(spatial.actions[3].text,'Original OEX rule '+source.rooms[0].id);
    assert.equal(validateExhibition(target).valid, true, JSON.stringify(validateExhibition(target)));
    const reexport = await expected(request(destinationActor, "POST", `/studio/exhibitions/${imported.result.exhibitionId}/oex/export`, {}, { "if-match": imported.result.etag }), 200);
    assert.equal((await validateOex(reexport.rawPayload)).valid, true);
    assert.deepEqual(exportedEntries(reexport.rawPayload).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), [...bytesByAsset.values()].map(sha256).sort());
    assert.deepEqual(target.artworks.flatMap(value => value.assets.map(asset => [asset.mime, asset.bytes, asset.sha256])).sort(), source.artworks.flatMap(value => value.assets.map(asset => [asset.mime, asset.bytes, asset.sha256])).sort());
  });
  await test("same-tenant collision restore remaps identifiers and leaves original authoritative draft intact", async () => {
    const { job } = await submit(actors.artist); await worker.run(job.id);
    const restored = await json(request(actors.artist, "GET", `/oex/imports/${job.id}`)); assert.equal(restored.state, "complete", JSON.stringify(restored));
    assert.notEqual(restored.result.exhibitionId, base.id);
    assert.deepEqual((await json(request(actors.artist, "GET", `/studio/exhibitions/${base.id}`))).draft, draft);
    for (const field of ["rooms", "surfaces", "openings", "placements", "lights", "navigation", "annotations", "audioZones"]) {
      const originalIds = new Set(draft.candidate[field].map(value => value.id));
      for (const value of restored.result.draft.candidate[field]) assert(!originalIds.has(value.id), `${field} collision ${value.id}`);
    }
  });
  await test("public shared-asset package with valid 240-character source path restores bounded ownership aliases and exact bytes", async () => {
    let sharedAssetId;
    const sourceArtifactPath = `shared-${"s".repeat(222)}.glb`;
    assert.equal(`assets/${sourceArtifactPath}`.length, 240);
    const shared = modifiedPackage((document, manifest) => {
      const oldPath = document.artworks[0].assets[0].path;
      document.artworks[0].assets[0].path = sourceArtifactPath;
      document.artworks[0].provenance.events[0].sourceAssetIds = [document.artworks[0].primaryAssetId];
      const second = structuredClone(document.artworks[0]); second.id = randomUUID(); second.revisionId = randomUUID();
      second.metadata.title = "Original second sculpture sharing exact geometry";
      document.artworks[1] = second; sharedAssetId = second.primaryAssetId;
      document.placements[1].artworkRevisionId = second.revisionId; document.placements[1].assetId = second.primaryAssetId;
      document.placements[1].transform.position = [-1, .5, 0];
      manifest.assets = packageMediaAssetManifest(document);
      return new Map([[`assets/${oldPath}`, `assets/${sourceArtifactPath}`]]);
    });
    assert.equal((await validateOex(shared)).valid, true, JSON.stringify(await validateOex(shared)));
    const { job } = await submit(destinationActor, shared); await worker.run(job.id);
    const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`)); assert.equal(status.state, "complete", JSON.stringify(status));
    const scene = status.result.draft.candidate, geometryHash = sha256(bytesByAsset.get(works[0].primaryAssetId));
    assert.notEqual(scene.artworks[0].primaryAssetId, scene.artworks[1].primaryAssetId);
    assert.equal(status.result.assetAliases.filter(value => value.sourceAssetId === sharedAssetId).length, 2);
    for (const alias of status.result.assetAliases.filter(value => value.sourceAssetId === sharedAssetId)) {
      assert.equal(alias.sourceArtifactPath, sourceArtifactPath); assert.match(alias.destinationArtifactPath, /^imported\/[a-f0-9-]+\/model\.glb$/);
      assert(`assets/${alias.destinationArtifactPath}`.length <= 240);
    }
    for (const [index, artwork] of scene.artworks.entries()) {
      assert.equal(scene.placements[index].artworkRevisionId, artwork.revisionId);
      assert.equal(scene.placements[index].assetId, artwork.primaryAssetId);
      assert.deepEqual(artwork.provenance.events[0].sourceAssetIds, [artwork.primaryAssetId]);
      const stored = (await pool.query("SELECT artwork_id,sha256,object_key FROM assets WHERE tenant_id=$1 AND id=$2", [destination, artwork.primaryAssetId])).rows[0];
      assert.equal(stored.artwork_id, artwork.id); assert.equal(stored.sha256, geometryHash); assert.equal(sha256(await blobs.get(stored.object_key)), geometryHash);
    }
    const reexport = await expected(request(destinationActor, "POST", `/studio/exhibitions/${status.result.exhibitionId}/oex/export`, {}, { "if-match": status.result.etag }), 200);
    assert.equal((await validateOex(reexport.rawPayload)).valid, true);
    assert.deepEqual(exportedEntries(reexport.rawPayload).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), [geometryHash, geometryHash, sha256(wave)].sort());
  });
  await test("unchanged public draft1 OEX fixture imports and reexports exact original GLB PNG bytes and provenance", async () => {
    const original = await readFile(fixtureURL("oex/v1/examples/synthetic.oex"));
    assert.equal((await validateOex(original)).valid, true);
    const { job } = await submit(destinationActor, original); await worker.run(job.id);
    const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`)); assert.equal(status.state, "complete", JSON.stringify(status));
    const scene = status.result.draft.candidate;
    assert(scene.artworks.every(artwork => artwork.provenance.authorship === "synthetic"));
    const image = scene.artworks.find(artwork => artwork.artworkType === "image"); assert.equal(image.dimensions.depth, undefined);
    const reexport = await expected(request(destinationActor, "POST", `/studio/exhibitions/${status.result.exhibitionId}/oex/export`, {}, { "if-match": status.result.etag }), 200);
    assert.equal((await validateOex(reexport.rawPayload)).valid, true);
    assert.deepEqual(exportedEntries(reexport.rawPayload).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), exportedEntries(original).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort());
  });
  await test("custom UUID-shaped license holder and credit survive actual import reexport READY and explicit publication", async () => {
    let sourceLicense, sourceRights;
    const custom = modifiedPackage(document => {
      sourceLicense = document.rooms[0].id;
      for (const value of [...document.artworks, ...document.mediaAssets]) {
        value.rights.licenseId = sourceLicense;
        value.rights.holder = sourceLicense;
        value.rights.creditLine = sourceLicense;
      }
      sourceRights = structuredClone([...document.artworks, ...document.mediaAssets].map(value => value.rights));
    });
    assert.equal((await validateOex(custom)).valid, true, JSON.stringify(await validateOex(custom)));
    const hashes = exportedEntries(custom).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort();
    const { job } = await submit(destinationActor, custom); await worker.run(job.id);
    const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`)); assert.equal(status.state, "complete", JSON.stringify(status));
    const scene = status.result.draft.candidate, path = `/studio/exhibitions/${status.result.exhibitionId}`;
    assert.notEqual(scene.rooms[0].id, sourceLicense);
    assert.deepEqual([...scene.artworks, ...scene.mediaAssets].map(value => value.rights), sourceRights);
    for (const artwork of scene.artworks) for (const asset of artwork.assets) {
      const stored = (await pool.query("SELECT sha256,object_key FROM assets WHERE tenant_id=$1 AND id=$2", [destination, asset.id])).rows[0];
      assert.equal(stored.sha256, asset.sha256); assert.equal(sha256(await blobs.get(stored.object_key)), asset.sha256);
    }
    const reexport = await expected(request(destinationActor, "POST", `${path}/oex/export`, {}, { "if-match": status.result.etag }), 200);
    assert.equal((await validateOex(reexport.rawPayload)).valid, true);
    const roundtrip = JSON.parse(exportedEntries(reexport.rawPayload).find(([name]) => name === "exhibition.json")[1]);
    assert.deepEqual([...roundtrip.artworks, ...roundtrip.mediaAssets].map(value => value.rights), sourceRights);
    assert.deepEqual(exportedEntries(reexport.rawPayload).filter(([name]) => name.startsWith("assets/")).map(([, bytes]) => sha256(bytes)).sort(), hashes);
    const baseline = (await originalCounts(destination)).studio_publications;
    assert.equal((await json(request(destinationActor, "GET", `${path}/ready`))).status, "READY");
    assert.equal((await originalCounts(destination)).studio_publications, baseline);
    const publication = await json(request(destinationActor, "POST", `${path}/publications`, { requestId: randomUUID() }, { "if-match": status.result.etag }), 201);
    const projection = await json(app.inject({ url: `/api/v1/publications/${publication.publicationId}`, headers }));
    assert.deepEqual([...projection.exhibition.artworks, ...projection.exhibition.mediaAssets].map(value => value.rights), sourceRights);
    assert.equal(validateExhibition(projection.exhibition).valid, true);
    assert.equal((await originalCounts(destination)).studio_publications, baseline + 1);
  });
  await test("job ownership and foreign tenant boundaries apply to status bytes complete retry cancel", async () => {
    const { job } = await submit(actors.artist);
    for (const actor of [actors.other, actors.viewer, actors.curator, destinationActor]) {
      for (const [method, suffix, payload] of [["GET", "", undefined], ["PUT", "/bytes", archive], ["POST", "/complete", {}], ["POST", "/retry", {}], ["POST", "/cancel", {}]])
        await expected(request(actor, method, `/oex/imports/${job.id}${suffix}`, payload, {}, tenant), 403);
    }
    await expected(request(actors.artist, "POST", `/oex/imports/${job.id}/cancel`, {}), 200);
    const cancelled = await json(request(actors.artist, "GET", `/oex/imports/${job.id}`)); assert.equal(cancelled.state, "cancelled");
    await worker.run(job.id); assert.equal((await json(request(actors.artist, "GET", `/oex/imports/${job.id}`))).state, "cancelled");
    await worker.cleanup(job.id); assert.deepEqual(await blobs.list(`${tenant}/oex-staging/${job.id}`), []);
  });
  await test("actual malformed ZIP packages fail closed with no partial destination rows or publications", async () => {
    const entries = exportedEntries(archive), firstAsset = entries.findIndex(([name]) => name.startsWith("assets/"));
    assert.equal(entries[0][0], "manifest.json"); assert(firstAsset > 1);
    const oversized = fixtureZip(entries); let central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert(central > 0); oversized.writeUInt32LE(0x7fffffff, central + 24);
    const ratioBomb = fixtureZip(entries.map(([name, bytes], index) => [name, index === firstAsset ? Buffer.alloc(2 * 1024 * 1024) : bytes]), { deflate: true });
    assert((await validateOex(ratioBomb)).errors.some(error => error.code === "ZIP_RATIO_LIMIT"));
    const malformed = [
      ["traversal", fixtureZip([...entries, ["../outside.txt", Buffer.from("synthetic")]])],
      ["duplicate", fixtureZip([...entries, entries[firstAsset]])],
      ["unexpected entry", fixtureZip([...entries, ["unlisted.txt", Buffer.from("synthetic")]])],
      ["asset corruption", fixtureZip(entries.map(([name, bytes], index) => [name, index === firstAsset ? Buffer.alloc(bytes.length) : bytes]))],
      ["asset size", fixtureZip(entries.map(([name, bytes], index) => [name, index === firstAsset ? bytes.subarray(0, bytes.length - 1) : bytes]))],
      ["manifest version", fixtureZip(entries.map(([name, bytes]) => [name, name === "manifest.json" ? Buffer.from(JSON.stringify({ ...JSON.parse(bytes), formatVersion: "9.0.0" })) : bytes]))],
      ["unknown extension", modifiedPackage(document => { document.extensions["unknown.example/executable"] = { command: "synthetic" }; })],
      ["broken reference", modifiedPackage(document => { document.placements[0].roomId = randomUUID(); })],
      ["expired import rights", modifiedPackage(document => { document.artworks[0].rights.expiresAt = "2000-01-01T00:00:00Z"; })],
      ["declared expansion bomb", oversized],
      ["unsupported format", Buffer.from("Synthetic non-ZIP OEX input")],
      ["actual DEFLATE expansion ratio bomb", ratioBomb],
    ];
    for (const [label, bytes] of malformed) {
      const baseline = await originalCounts(destination), { job } = await submit(destinationActor, bytes);
      await worker.run(job.id);
      const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`));
      assert.equal(status.state, "failed", `${label}: ${JSON.stringify(status)}`); assert.equal(status.result, null); assert(status.errorCode);
      assert.deepEqual(await originalCounts(destination), baseline, label);
    }
  });
  await test("export-only preservation grants import privately but cannot pass READY or publish", async () => {
    const publicationsBefore = (await originalCounts(destination)).studio_publications;
    const preservation = modifiedPackage(document => {
      for (const value of [...document.artworks, ...document.mediaAssets]) value.rights.permissions.display = false;
    });
    assert.equal((await validateOex(preservation)).valid, true, JSON.stringify(await validateOex(preservation)));
    const { job } = await submit(destinationActor, preservation); await worker.run(job.id);
    const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`)); assert.equal(status.state, "complete", JSON.stringify(status));
    const path = `/studio/exhibitions/${status.result.exhibitionId}`;
    assert.equal((await json(request(destinationActor, "GET", `${path}/ready`))).status, "BLOCKED");
    await expected(request(destinationActor, "POST", `${path}/publications`, { requestId: randomUUID() }, { "if-match": status.result.etag }), 422);
    assert.equal((await originalCounts(destination)).studio_publications, publicationsBefore);
  });
  await test("real filesystem rejection leaves no partial rows and retry succeeds after fixture-only fault repair", async () => {
    const baseline = await originalCounts(destination), { job } = await submit(destinationActor);
    const prefix = `${blobs.root}/${destination}/oex-import`, blocked = `${prefix}/${job.id}`;
    await mkdir(prefix, { recursive: true });
    const outside = await mkdtemp(`${tmpdir()}/exhibitos-oex-symlink-control-`); await symlink(outside, blocked);
    try {
      await worker.run(job.id);
      const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`));
      assert.equal(status.state, "failed", JSON.stringify(status)); assert.deepEqual(await originalCounts(destination), baseline);
    } finally { assert((await lstat(blocked)).isSymbolicLink()); await unlink(blocked); }
    await worker.cleanup(job.id);
    await expected(request(destinationActor, "POST", `/oex/imports/${job.id}/retry`, {}), 200);
    await worker.run(job.id);
    assert.equal((await json(request(destinationActor, "GET", `/oex/imports/${job.id}`))).state, "complete");
  });
  await test("actual PostgreSQL mid-transaction failure rolls back CMS audio Studio rows and removes disposable destination bytes", async () => {
    const baseline = await originalCounts(destination), { job } = await submit(destinationActor);
    await pool.query("CREATE TABLE synthetic_oex_fault_control(tenant_id uuid PRIMARY KEY)");
    await pool.query("INSERT INTO synthetic_oex_fault_control VALUES($1)", [destination]);
    await pool.query("CREATE FUNCTION synthetic_oex_insert_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM synthetic_oex_fault_control WHERE tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Synthetic isolated OEX mid-transaction fault'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER synthetic_oex_insert_fault BEFORE INSERT ON exhibitions FOR EACH ROW EXECUTE FUNCTION synthetic_oex_insert_fault()");
    try {
      await worker.run(job.id);
      const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`));
      assert.equal(status.state, "failed", JSON.stringify(status)); assert.deepEqual(await originalCounts(destination), baseline);
      assert.deepEqual(await blobs.list(`${destination}/oex-import/${job.id}`), []);
    } finally { await pool.query("DROP TRIGGER synthetic_oex_insert_fault ON exhibitions"); await pool.query("DROP FUNCTION synthetic_oex_insert_fault()"); await pool.query("DROP TABLE synthetic_oex_fault_control"); }
    await expected(request(destinationActor, "POST", `/oex/imports/${job.id}/retry`, {}), 200); await worker.run(job.id);
    assert.equal((await json(request(destinationActor, "GET", `/oex/imports/${job.id}`))).state, "complete");
    assert.deepEqual(await blobs.list(`${destination}/oex-staging/${job.id}`), []);
  });
  await test("real SIGKILL after destination byte writes rolls back transaction and expired lease resumes without duplicates", async () => {
    const baseline = await originalCounts(destination), { job } = await submit(destinationActor), blocker = await pool.connect();
    const lock = 1820701;
    await blocker.query("SELECT pg_advisory_lock($1)", [lock]);
    await pool.query(`CREATE FUNCTION synthetic_oex_worker_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER synthetic_oex_worker_pause BEFORE INSERT ON exhibitions FOR EACH ROW EXECUTE FUNCTION synthetic_oex_worker_pause()");
    const applicationName = `synthetic-oex-kill-${job.id}`;
    const child = spawn(process.execPath, [new URL("./oex-test-worker.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
    let childError = ""; child.stderr.on("data", part => { childError += part.toString(); });
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.stdin.end(JSON.stringify({ database: { host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: "postgres", application_name: applicationName }, blobRoot: blobs.root, jobId: job.id }));
    try {
      for (let attempt = 0; ; attempt++) {
        const paused = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE 'INSERT INTO exhibitions%'", [applicationName])).rowCount;
        if (paused) break;
        assert.equal(child.exitCode, null, childError); // Cold Node/module startup on a synchronized checkout may exceed10s.
        // Still require the real advisory-lock INSERT before SIGKILL; no timing substitute.
        if (attempt > 1200) throw new Error("Actual worker never reached transaction pause within60s: "+childError);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal((await pool.query("SELECT state FROM oex_import_jobs WHERE id=$1", [job.id])).rows[0].state, "processing");
      assert((await blobs.list(`${destination}/oex-import/${job.id}`)).length >= 3);
      assert.deepEqual(await originalCounts(destination), baseline);
      child.kill("SIGKILL"); assert.equal((await exited).signal, "SIGKILL");
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      await blocker.query("SELECT pg_advisory_unlock($1)", [lock]); blocker.release();
      await pool.query("DROP TRIGGER synthetic_oex_worker_pause ON exhibitions"); await pool.query("DROP FUNCTION synthetic_oex_worker_pause()");
    }
    await pool.query("UPDATE oex_import_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
    await worker.run(job.id);
    const status = await json(request(destinationActor, "GET", `/oex/imports/${job.id}`)); assert.equal(status.state, "complete", JSON.stringify(status)); assert.equal(status.attempts, 2);
    assert.equal((await originalCounts(destination)).exhibitions, baseline.exhibitions + 1);
    assert.deepEqual(await blobs.list(`${destination}/oex-staging/${job.id}`), []);
  });
  await test("all original source snapshots and visual/audio bytes survive restore failures, cancellation and killed workers unchanged", async () => {
    assert.deepEqual((await json(request(actors.artist, "GET", `/studio/exhibitions/${base.id}`))).draft, draft);
    for (const artwork of works) {
      const row = (await pool.query("SELECT object_key,sha256 FROM assets WHERE tenant_id=$1 AND id=$2", [tenant, artwork.primaryAssetId])).rows[0];
      assert.equal(row.sha256, sha256(bytesByAsset.get(artwork.primaryAssetId)));
      assert.equal(sha256(await blobs.get(row.object_key)), row.sha256);
    }
    const audioRow = (await pool.query("SELECT object_key,sha256 FROM studio_audio WHERE tenant_id=$1 AND id=$2", [tenant, audio.id])).rows[0];
    assert.equal(audioRow.sha256, sha256(wave)); assert.equal(sha256(await blobs.get(audioRow.object_key)), sha256(wave));
  });
  await app.close();
  const { createServer } = await import("node:net"), reserve = createServer();
  await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve)); const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve)); const browserOrigin = `http://127.0.0.1:${port}`;
  app = buildApp({ pool, blobs, auth: { mode: "local", origin: browserOrigin, bindHost: "127.0.0.1" } });
  const dist = new URL("../apps/web/dist/", import.meta.url), assets = new Set(await readdir(new URL("assets/", dist)));
  for (const path of ["/studio", "/cms", "/p/:id"]) app.get(path, async (_request, reply) => reply.type("text/html").send(await readFile(new URL("index.html", dist))));
  app.get("/assets/:file", async (req, reply) => {
    const file = req.params.file; if (!assets.has(file) || !/^[-\w.]+$/.test(file)) return reply.code(404).send();
    return reply.type(file.endsWith(".js") ? "application/javascript" : "text/css").send(await readFile(new URL(`assets/${file}`, dist)));
  });
  await app.listen({ host: "127.0.0.1", port });
  const { runOexBrowser } = await import("./oex-browser.mjs");
  const browserResult = await runOexBrowser({ origin: browserOrigin, tenantId: destination, subject: "synthetic.oex.artist", password: pass, archive,
    other: { tenantId: tenant, subject: "synthetic.oex.other" },
    work: () => worker.runNext(), publicationCount: async () => (await originalCounts(destination)).studio_publications });
  checks.push(...browserResult.checks);
  await app.close();
  await test("production-enabled HTTP scheduler completes an uploaded OEX without explicit worker calls and closes quiescently", async () => {
    app = buildApp({ pool, blobs, oexWorker: true, auth: { mode: "local", origin: browserOrigin, bindHost: "127.0.0.1" } });
    let observedUploads = 0;
    app.addHook("onRequest", (req, _reply, done) => { if (req.method === "PUT" && /\/oex\/imports\/[^/]+\/bytes$/.test(req.url)) observedUploads++; done(); });
    await app.listen({ host: "127.0.0.1", port });
    const response = await fetch(`${browserOrigin}/api/v1/auth/login`, { method: "POST", headers: { origin: browserOrigin, "content-type": "application/json" }, body: JSON.stringify({ subject: "synthetic.oex.artist", password: pass, tenantId: destination }) });
    assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie").split(";")[0];
    const sessionResponse = await fetch(`${browserOrigin}/api/v1/auth/session`, { headers: { cookie } }); assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    const http = async (method, path, value) => {
      const r = await fetch(`${browserOrigin}/api/v1/tenants/${destination}${path}`, { method, headers: { origin: browserOrigin, cookie, "x-csrf-token": session.csrfToken,
        ...(value === undefined ? {} : { "content-type": Buffer.isBuffer(value) ? "application/octet-stream" : "application/json" }) }, body: value === undefined ? undefined : Buffer.isBuffer(value) ? value : JSON.stringify(value) });
      assert(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`); return r.json();
    };
    const job = await http("POST", "/oex/imports", { requestId: randomUUID(), bytes: archive.length, sha256: sha256(archive) });
    const { request: httpRequest } = await import("node:http"), observedBefore = observedUploads;
    const interrupted = httpRequest(`${browserOrigin}/api/v1/tenants/${destination}/oex/imports/${job.id}/bytes`, { method: "PUT", headers: { origin: browserOrigin, cookie, "x-csrf-token": session.csrfToken, "content-type": "application/octet-stream", "content-length": archive.length } });
    interrupted.on("error", () => {}); const closed = new Promise(resolve => interrupted.once("close", resolve));
    interrupted.write(archive.subarray(0, 1000));
    for (let n = 0; observedUploads === observedBefore; n++) { if (n >= 100) throw new Error("HTTP server never observed truncated upload"); await new Promise(resolve => setTimeout(resolve, 10)); }
    interrupted.destroy(); await closed;
    assert.equal((await http("GET", `/oex/imports/${job.id}`)).state, "uploading");
    assert.deepEqual(await blobs.list(`${destination}/oex-staging/${job.id}`), []);
    await http("PUT", `/oex/imports/${job.id}/bytes`, archive); await http("POST", `/oex/imports/${job.id}/complete`, {});
    let status;
    for (let n = 0; ; n++) { status = await http("GET", `/oex/imports/${job.id}`); if (status.state === "complete") break;
      assert.notEqual(status.state, "failed", JSON.stringify(status)); if (n >= 100) throw new Error("Production scheduler never completed OEX"); await new Promise(resolve => setTimeout(resolve, 100)); }
    assert(status.result?.draft); assert.equal(status.attempts, 1);
    await app.close();
    assert.equal((await pool.query("SELECT state FROM oex_import_jobs WHERE id=$1", [job.id])).rows[0].state, "complete");
    assert.deepEqual(await blobs.list(`${destination}/oex-staging/${job.id}`), []);
  });
  await test("production scheduler startup fails closed when required additive migration is absent", async () => {
    const missing = `oex_missing_${randomUUID().replaceAll("-", "")}`; await pool.query(`CREATE DATABASE ${missing}`);
    const missingPool = new Pool({ host: "127.0.0.1", port: Number(run("port", name, "5432/tcp").split(":").at(-1)), user: "postgres", password, database: missing });
    let missingApp;
    try {
      await migrate(missingPool, new URL("../database/migrations/", import.meta.url).pathname, "008_audio.sql");
      missingApp = buildApp({ pool: missingPool, blobs, oexWorker: true, auth: { mode: "local", origin, bindHost: "127.0.0.1" } });
      await assert.rejects(missingApp.ready(), /relation .*oex_import_jobs.* does not exist/);
    } finally { await missingApp?.close(); await missingPool.end(); }
  });
  const report = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), checks, checkedAt: new Date().toISOString(), archive: { bytes: archive.length, sha256: sha256(archive) },
    scope: "Actual isolated PostgreSQL, FileBlobStore, authentication and synthetic approved GLB/PNG/PCM WAV; no original data or public release" };
  await writeFile(`${reportDir}/oex-run.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ ...report, reportPath: `${reportDir}/oex-run.json` }, null, 2));
} finally { await app?.close(); await pool?.end(); if (started) run("rm", "-f", name); }
