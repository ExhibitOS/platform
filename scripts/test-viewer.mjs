// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { fixtureURL, validateExhibition } from "@exhibitos/spec";
import { migrate, FileBlobStore, sha256, Storage } from "../packages/storage/dist/index.js";
import { bootstrap } from "../apps/api/dist/auth.js";
import { buildApp } from "../apps/api/dist/app.js";
import { Imports } from "../apps/api/dist/imports.js";
const docker = process.env.DOCKER_BIN ?? "docker", name = `exhibitos-viewer-test-${randomUUID()}`, password = randomBytes(24).toString("hex");
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
    const fixtures = (await import("./viewer-fixtures.mjs")).loadViewerFixtures();
    const createApproved = async (type) => {
        const m = { ...metadata, title: type === "image" ? "Synthetic public painting" : metadata.title, dimensions: { ...metadata.dimensions, depth: type === "image" ? 0.02 : 1 } };
        const art = await json(request(actors.artist, "POST", "/cms/artworks", { ...m, artistId: artist.id }), 201);
        const bytes = fixtures.find(f => f.type === type).bytes;
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
    const works=[];
    for(let i=0;i<20;i++)works.push(await createApproved(i%2?"image":"sculpture"));
    const candidate=JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"),"utf8"));
    candidate.id=randomUUID();candidate.revisionId=randomUUID();candidate.artworks=works.map(w=>w.artwork);
    const oldPlacements=candidate.placements.map(p=>p.id);
    candidate.placements=works.map((w,i)=>({id:randomUUID(),roomId:candidate.rooms[0].id,artworkRevisionId:w.artwork.revisionId,assetId:w.artwork.primaryAssetId,transform:{position:[-4.5+(i%5)*2.2,i%2?1.6:0.5,-2.8+Math.floor(i/5)*1.7],rotation:[0,0,0,1],scale:[1,1,1]}}));
    let serialized=JSON.stringify(candidate);for(let i=0;i<oldPlacements.length;i++)serialized=serialized.replaceAll(oldPlacements[i],candidate.placements[i].id);Object.assign(candidate,JSON.parse(serialized));
    candidate.accessibility.artworkDescriptions=candidate.placements.map(p=>({placementId:p.id,text:"Original synthetic artwork for bounded Viewer tests"}));
    assert.equal(validateExhibition(candidate).valid,true,JSON.stringify(validateExhibition(candidate)));
    candidate.extensions={"org.exhibitos.studio/presentation":{version:1,startCamera:{roomId:candidate.rooms[0].id,position:[0,1.6,3.5],target:[0,1.6,0],fov:60},viewpoints:[],credits:"Synthetic Viewer benchmark"}};
    const time=new Date().toISOString(),draft={schemaVersion:"1.0.0-draft.1",kind:"exhibition-draft",id:randomUUID(),exhibitionId:candidate.id,editVersion:1,createdAt:time,updatedAt:time,candidate};
    const saved=await json(request(actors.artist,"POST","/studio/exhibitions",{draft,requestId:randomUUID()}),201),path=`/studio/exhibitions/${candidate.id}`;
    await test("generic remote draft rejects malformed recognized Viewer namespace before storing a row",async()=>{for(const invalid of [{version:2,variants:[]},{version:1,variants:[{assetId:works[0].assetId,detail:"full",triangles:1000001}]}]){const copy=structuredClone(draft);copy.id=randomUUID();copy.exhibitionId=randomUUID();copy.candidate.id=copy.exhibitionId;copy.candidate.artworks[0].extensions["org.exhibitos.viewer/lod"]=invalid;await expected(request(actors.artist,"POST","/studio/exhibitions",{draft:copy,requestId:randomUUID()}),422,"DRAFT_INVALID");assert.equal((await pool.query("SELECT count(*)::int AS n FROM exhibitions WHERE id=$1",[copy.exhibitionId])).rows[0].n,0);}});
    const pub=await json(request(actors.artist,"POST",`${path}/publications`,{requestId:randomUUID()},{"if-match":saved.etag}),201);
    const projection=await json(anonymous(`/api/v1/publications/${pub.publicationId}`));
    await test("twenty exact approved snapshots publish forty qualified full/coarse derivatives with real detail and transfer reduction",async()=>{
      assert.equal(projection.exhibition.artworks.length,20);assert.equal(projection.assets.length,40);
      for(const artwork of projection.exhibition.artworks){const lod=artwork.extensions["org.exhibitos.viewer/lod"],metric=artwork.artworkType==="image"?"textureSize":"triangles";assert.equal(lod.version,1);assert.equal(lod.variants.length,2);const full=lod.variants.find(v=>v.detail==="full"),low=lod.variants.find(v=>v.detail==="coarse");assert.ok(low[metric]<full[metric]);for(const v of lod.variants){const inv=artwork.assets.find(a=>a.id===v.assetId),slot=projection.assets.find(a=>a.assetId===v.assetId),r=await expected(anonymous(slot.url),200);assert.equal(sha256(r.rawPayload),inv.sha256);assert.equal(r.rawPayload.length,inv.bytes);assert.equal(r.headers["x-exhibitos-publication-revision"],pub.revisionSha256);}assert.ok(artwork.assets.find(a=>a.id===low.assetId).bytes<artwork.assets.find(a=>a.id===full.assetId).bytes);}
    });
    await test("coarse corruption and missing blobs fail closed; maintenance retains every immutable variant",async()=>{const coarse=projection.exhibition.artworks[0].extensions["org.exhibitos.viewer/lod"].variants.find(v=>v.detail==="coarse"),row=(await pool.query("SELECT * FROM publication_assets WHERE id=$1",[coarse.assetId])).rows[0],bytes=await blobs.get(row.object_key),url=projection.assets.find(a=>a.assetId===row.id).url;await blobs.remove(row.object_key);await expected(anonymous(url),404,"PUBLICATION_UNAVAILABLE");await blobs.put(row.object_key,Buffer.from("corrupt"));await expected(anonymous(url),404,"PUBLICATION_UNAVAILABLE");await blobs.remove(row.object_key);await blobs.put(row.object_key,bytes);const orphaned=await new Storage(pool,blobs).reconcile({tenantId:tenant,userId:admin.userId},true);for(const asset of (await pool.query("SELECT * FROM publication_assets WHERE publication_id=$1",[pub.publicationId])).rows){assert.equal(orphaned.includes(asset.object_key),false);assert.equal(sha256(await blobs.get(asset.object_key)),asset.sha256);}});
    await test("qualified high-complexity coarse refusal publishes measured full-only inventory, never invents low detail",async()=>{const original=fixtures[0].bytes;fixtures[0].bytes=(await import("./viewer-fixtures.mjs")).denseCubeGlb(96);let work;try{work=await createApproved("sculpture");}finally{fixtures[0].bytes=original;}const copy=structuredClone(draft);copy.id=randomUUID();copy.exhibitionId=randomUUID();copy.candidate.id=copy.exhibitionId;copy.candidate.artworks[0]=work.artwork;copy.candidate.placements[0].artworkRevisionId=work.artwork.revisionId;copy.candidate.placements[0].assetId=work.artwork.primaryAssetId;const savedCopy=await json(request(actors.artist,"POST","/studio/exhibitions",{draft:copy,requestId:randomUUID()}),201),published=await json(request(actors.artist,"POST",`/studio/exhibitions/${copy.exhibitionId}/publications`,{requestId:randomUUID()},{"if-match":savedCopy.etag}),201),data=await json(anonymous(`/api/v1/publications/${published.publicationId}`)),art=data.exhibition.artworks[0],lod=art.extensions["org.exhibitos.viewer/lod"];assert.equal(lod.variants.length,1);assert.equal(lod.variants[0].detail,"full");assert.ok(lod.variants[0].triangles>100000);assert.equal(art.assets.length,1);});
    await test("quiesced PostgreSQL backup restores forty immutable variant bindings and every stored byte hash",async()=>{const lock=await pool.connect();let dump;try{await lock.query("SELECT pg_advisory_lock(82002)");dump=execFileSync(docker,["exec",name,"pg_dump","-U","postgres","-Fc","postgres"],{timeout:120000});}finally{await lock.query("SELECT pg_advisory_unlock(82002)");lock.release();}run("exec",name,"createdb","-U","postgres","restored");execFileSync(docker,["exec","-i",name,"pg_restore","-U","postgres","-d","restored"],{input:dump,timeout:120000,stdio:["pipe","pipe","pipe"]});const restored=new Pool({host:"127.0.0.1",port:Number(run("port",name,"5432/tcp").split(":").at(-1)),user:"postgres",password,database:"restored"});try{for(const table of ["studio_publications","publication_assets","publication_states","publication_events"]){const sql=`SELECT row_to_json(t) AS value FROM ${table} t ORDER BY row_to_json(t)::text`;assert.deepEqual((await restored.query(sql)).rows,(await pool.query(sql)).rows);}for(const row of (await restored.query("SELECT * FROM publication_assets WHERE publication_id=$1",[pub.publicationId])).rows){assert.equal(sha256(await blobs.get(row.object_key)),row.sha256);}}finally{await restored.end();}});
    // Actual production web served beside the actual anonymous API, with no mutable draft adapter.
    await app.close();const {createServer}=await import("node:net"),reserve=createServer();await new Promise(r=>reserve.listen(0,"127.0.0.1",r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const browserOrigin=`http://127.0.0.1:${port}`;
    app=buildApp({pool,blobs,auth:{mode:"local",origin:browserOrigin,bindHost:"127.0.0.1"}});
    const dist=new URL("../apps/web/dist/",import.meta.url),assets=new Set(await readdir(new URL("assets/",dist)));
    app.get("/p/:id",async(_req,reply)=>reply.header("cache-control","no-store").type("text/html").send(await readFile(new URL("index.html",dist))));
    app.get("/assets/:file",async(req,reply)=>{const file=req.params.file;if(!assets.has(file)||!/^[-\w.]+$/.test(file))return reply.code(404).send();return reply.type(file.endsWith(".js")?"application/javascript":"text/css").send(await readFile(new URL(`assets/${file}`,dist)));});
    await app.listen({host:"127.0.0.1",port});
    if(process.env.EXHIBITOS_VIEWER_SKIP_BROWSER!=="1"){const {runViewerBrowser}=await import("./viewer-browser.mjs");const result=await runViewerBrowser({origin:browserOrigin,publicationId:pub.publicationId});checks.push(...result.checks);console.log(JSON.stringify(result,null,2));}
    await test("current rights revoke metadata and both full/coarse bytes on every new anonymous read",async()=>{const grant=(await pool.query("SELECT r.* FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.id=$1",[works[0].assetId])).rows[0];await pool.query("UPDATE rights SET metadata=$2 WHERE id=$1",[grant.id,{...grant.metadata,permissions:{...grant.metadata.permissions,display:false}}]);for(const url of [`/api/v1/publications/${pub.publicationId}`,...projection.assets.map(a=>a.url)])await expected(anonymous(url),404,"PUBLICATION_UNAVAILABLE");});
    console.log(JSON.stringify({checks,scope:"Actual isolated PostgreSQL, immutable full/coarse publication and production browser Viewer synthetic twenty-artwork reference"},null,2));
}finally{await app?.close();await pool?.end();if(started)run("rm","-f",name);}
