// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { readFile,mkdtemp,mkdir,writeFile,lstat,readdir,rm,symlink,truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { fixtureURL,readOex,revisionHash } from "@exhibitos/spec";
import { exportStaticPublication,exportStaticStudioDemo,safeStaticPath,assertStaticBudget,staticCoverShell } from "./export-static-publication.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
test('approved Viewer favicon exports exact bytes and rejects a changed SVG',async t=>{
 const {runtime,options,directory}=await setup(t);
 const icon=await readFile(new URL('../apps/web/public/viewer-favicon.svg',import.meta.url));
 await writeFile(join(runtime,'viewer-favicon.svg'),icon);
 const result=await exportStaticPublication(options);
 assert.deepEqual(await readFile(join(result.output,'viewer-favicon.svg')),icon);
 const manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json')));
 assert.equal(manifest.files.find(f=>f.path==='viewer-favicon.svg').sha256,'c2d259310843e6c9f676ef8e3ecde72edf5305a94fb87afcea44b4657d558263');
 await writeFile(join(runtime,'viewer-favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script>unexpected()</script></svg>');
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'changed-icon')}),/STATIC_RUNTIME_FAVICON/);
});
export async function staticFixture(){
 const decoded=await readOex(await readFile(fixtureURL("oex/v1/examples/synthetic-media.oex"))),id=randomUUID(),exhibition=decoded.exhibition;
 const raw={publication:{id,revisionSha256:revisionHash(exhibition),publishedAt:new Date().toISOString(),status:"published"},exhibition,assets:decoded.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,url:`/api/v1/publications/${id}/assets/${a.id}`})),privateAdminToken:"must-never-export"};
 let reads=0;const fetcher=async url=>{const path=new URL(url).pathname;if(path===`/api/v1/publications/${id}`){reads++;return Response.json(raw);}const asset=decoded.manifest.assets.find(a=>path===`/api/v1/publications/${id}/assets/${a.id}`);if(!asset)return new Response(null,{status:404});return new Response(decoded.files.get(asset.path),{headers:{"content-type":asset.mime,"x-exhibitos-publication-revision":raw.publication.revisionSha256}});};
 return {decoded,raw,id,fetcher,get reads(){return reads;}};
}
async function setup(t){const directory=await mkdtemp(join(tmpdir(),"exhibitos-static-export-test-"));t.after(()=>rm(directory,{recursive:true,force:true}));const runtime=join(directory,"runtime");await mkdir(runtime);await writeFile(join(runtime,"static.html"),'<meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256">');const fixture=await staticFixture(),options={origin:"http://127.0.0.1:3000",publicationId:fixture.id,runtimeRoot:runtime,output:join(directory,"output"),fetcher:fixture.fetcher};return {directory,runtime,fixture,options};}
test("published public projection exports exact synthetic GLB PNG audio and bound revision, excluding private fields",async t=>{const {fixture,options}=await setup(t),result=await exportStaticPublication(options);assert.equal(fixture.reads,2);const indexBytes=await readFile(join(result.output,"static-publication-index.json")),index=JSON.parse(indexBytes);assert.equal(sha(indexBytes),result.indexSha256);assert.match(await readFile(join(result.output,"index.html"),"utf8"),new RegExp(result.indexSha256));const publication=await readFile(join(result.output,index.publication.path),"utf8");assert(!publication.includes("must-never-export"));for(const entry of index.assets){const bytes=await readFile(join(result.output,entry.path));assert.equal(sha(bytes),entry.sha256);assert.deepEqual(bytes,fixture.decoded.files.get(fixture.decoded.manifest.assets.find(a=>a.id===entry.assetId).path));}const manifest=JSON.parse(await readFile(join(result.output,"static-export-manifest.json")));assert.equal(manifest.format,"exhibitos-static-publication-v1");assert.equal(sha(await readFile(join(result.output,"static-export-manifest.json"))),result.manifestSha256);assert.equal(manifest.files.length+1,result.files);for(const f of manifest.files){const b=await readFile(join(result.output,f.path));assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);}assert.equal(index.assets.length,3);await assert.rejects(exportStaticPublication(options),/STATIC_OUTPUT_EXISTS/);});
test("draft or withdrawn snapshot cannot be exported",async t=>{const {fixture,options}=await setup(t);fixture.raw.publication.status="unpublished";await assert.rejects(exportStaticPublication(options),/STATIC_NOT_PUBLISHED/);await assert.rejects(lstat(options.output),{code:"ENOENT"});});
test("withdrawal during asset export leaves no published directory or staging debris",async t=>{const {fixture,options,directory}=await setup(t),fetcher=options.fetcher;options.fetcher=async(...args)=>{if(fixture.reads===1&&new URL(args[0]).pathname.endsWith(fixture.id))fixture.raw.publication.status="unpublished";return fetcher(...args);};await assert.rejects(exportStaticPublication(options),/STATIC_PUBLICATION_CHANGED/);assert.deepEqual(await readdir(directory),["runtime"]);});
test("asset byte corruption is rejected before publish",async t=>{const {fixture,options}=await setup(t),fetcher=options.fetcher;options.fetcher=async(...args)=>{const response=await fetcher(...args);if(new URL(args[0]).pathname.includes("/assets/")){const b=Buffer.from(await response.arrayBuffer());b[b.length-1]^=1;return new Response(b,{headers:response.headers});}return response;};await assert.rejects(exportStaticPublication(options),/STATIC_ASSET_HASH/);await assert.rejects(lstat(options.output),{code:"ENOENT"});assert.equal(fixture.reads,1);});
test("unsafe authored asset path identifies offending filename",async t=>{const {fixture,options}=await setup(t);fixture.raw.exhibition.artworks[0].assets[0].path="../secret.glb";fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);await assert.rejects(exportStaticPublication(options),/STATIC_ASSET_PATH: \.\.\/secret.glb/);});
test("runtime symlink is never followed or published",async t=>{const {options,runtime,directory}=await setup(t);await writeFile(join(directory,"secret.js"),"private");await mkdir(join(runtime,"assets"));await symlink(join(directory,"secret.js"),join(runtime,"assets","leak.js"));await assert.rejects(exportStaticPublication(options),/STATIC_SYMLINK: assets\/leak.js/);await assert.rejects(lstat(options.output),{code:"ENOENT"});});
test("runtime private or deployment-function file is not copied",async t=>{const {options,runtime}=await setup(t);await writeFile(join(runtime,"_worker.js"),"secret");await assert.rejects(exportStaticPublication(options),/STATIC_RUNTIME_UNLISTED: _worker.js/);});
test("Pages per-file and file-count bounds report exact filename without reduction",async t=>{const {options,runtime}=await setup(t);await mkdir(join(runtime,"assets"));const path=join(runtime,"assets","large.js");await writeFile(path,"");await truncate(path,25*1024*1024+1);await assert.rejects(exportStaticPublication(options),/STATIC_FILE_TOO_LARGE: assets\/large.js/);assert.throws(()=>assertStaticBudget("last.js",1,20000),/STATIC_FILE_COUNT: last.js/);assert.doesNotThrow(()=>assertStaticBudget("allowed.js",25*1024*1024,19999));});
test("paths and local API origin reject traversal, credentials and remote endpoints",async t=>{for(const path of ["../x","a/../x","a\\b","a//b","/x",".env","con.txt","a/x."])assert.equal(safeStaticPath(path),false,path);const {options}=await setup(t);for(const origin of ["https://example.com","http://user:pass@127.0.0.1","http://127.0.0.1/path"])await assert.rejects(exportStaticPublication({...options,origin}),/STATIC_LOCAL_ORIGIN/);});

test("known display rights expiry is retained and enforced before static export",async t=>{const {fixture,options}=await setup(t);fixture.raw.exhibition.artworks[0].rights.expiresAt="2026-01-01T00:00:00.000Z";fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);await assert.rejects(exportStaticPublication(options),/STATIC_DISPLAY_RIGHTS/);await assert.rejects(lstat(options.output),{code:"ENOENT"});});

test("explicit demo exports only the fixed CC0 sample and separate Studio entry",async t=>{
 const {runtime,options,fixture,directory}=await setup(t);
 await writeFile(join(runtime,"static.html"),'<html><meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"><div id="root"></div></html>');
 await writeFile(join(runtime,"static-studio.html"),'<meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256">');
 const result=await exportStaticStudioDemo({runtimeRoot:runtime,output:options.output});
 assert.equal(revisionHash(fixture.decoded.exhibition),"4a561248e1f166dfb3ca2ea4cfb692127e1e533440ce0c8a7aba1df069b58f00");
 assert.equal(result.revisionSha256,"fa261e9791bc482f92c30cf4aca325a9e3a9fc6609e67d3e12ae81d00c148afa");
 const index=JSON.parse(await readFile(join(result.output,"static-publication-index.json"))),derived=JSON.parse(await readFile(join(result.output,index.publication.path)));
 const expected=structuredClone(fixture.decoded.exhibition);
 expected.extensions={...expected.extensions,"org.exhibitos.studio/presentation":{version:1,startCamera:{roomId:expected.rooms[0].id,position:[0,1.6,2],target:[0,1.6,0],fov:60},viewpoints:[],credits:""}};
 assert.deepEqual(derived.exhibition,expected);
 assert.deepEqual((await readOex(await readFile(fixtureURL("oex/v1/examples/synthetic-media.oex")))).exhibition,fixture.decoded.exhibition);
 assert.match(await readFile(join(result.output,"index.html"),"utf8"),/href="\/studio.html"/);
 assert.match(await readFile(join(result.output,"studio.html"),"utf8"),new RegExp(result.indexSha256));
 const ordinary=await exportStaticPublication({...options,output:join(directory,"ordinary")});
 await assert.rejects(lstat(join(ordinary.output,"studio.html")),{code:"ENOENT"});
 assert(!((await readFile(join(ordinary.output,"index.html"),"utf8")).includes("/studio.html")));
 const legacy=await exportStaticPublication({...options,studioDemo:true,output:join(directory,"legacy-demo")});
 assert.equal(legacy.revisionSha256,revisionHash(fixture.decoded.exhibition));
 fixture.raw.exhibition=structuredClone(expected);
 fixture.raw.exhibition.extensions["org.exhibitos.studio/presentation"].startCamera.position[2]=3;
 fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);
 await assert.rejects(exportStaticPublication({...options,studioDemo:true,output:join(directory,"camera-tampered")}),/STATIC_DEMO_SAMPLE/);
 fixture.raw.exhibition.title="Unapproved CC0 sample";fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);
 await assert.rejects(exportStaticPublication({...options,studioDemo:true,output:join(directory,"modified")}),/STATIC_DEMO_SAMPLE/);
});
test("demo requires its fixed entry and still refuses extra HTML",async t=>{
 const {runtime,options,directory}=await setup(t);
 await writeFile(join(runtime,"static.html"),'<meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"><div id="root"></div>');
 await assert.rejects(exportStaticStudioDemo({runtimeRoot:runtime,output:options.output}),/STATIC_RUNTIME_ENTRY: static-studio.html/);
 await writeFile(join(runtime,"other.html"),"must not export");
 await assert.rejects(exportStaticStudioDemo({runtimeRoot:runtime,output:join(directory,"extra")}),/STATIC_RUNTIME_UNLISTED: other.html/);
});

test('installation metadata survives bound static export without changing asset bytes',async t=>{
 const {fixture,options}=await setup(t),e=fixture.raw.exhibition,namespace='org.exhibitos.studio/installation';
 const installation={version:1,placements:[{placementId:e.placements[0].id,pedestal:{kind:'box',position:[0,0,0],yaw:0,dimensions:{width:1,depth:1,height:.8},material:{preset:'paint',color:'#FFFFFF',roughness:0,metalness:0}}}]};
 e.extensions={...e.extensions,[namespace]:installation};fixture.raw.publication.revisionSha256=revisionHash(e);
 const result=await exportStaticPublication(options),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'))),published=JSON.parse(await readFile(join(result.output,index.publication.path)));
 assert.deepEqual(published.exhibition.extensions[namespace],installation);assert.equal(published.publication.revisionSha256,revisionHash(published.exhibition));
 for(const entry of index.assets)assert.equal(sha(await readFile(join(result.output,entry.path))),entry.sha256);
});
test('invalid installation cannot be exported even with a matching authored revision hash',async t=>{
 const {fixture,options}=await setup(t),e=fixture.raw.exhibition;e.extensions={...e.extensions,'org.exhibitos.studio/installation':{version:1,placements:[{placementId:randomUUID(),frame:{kind:'none'}}]}};fixture.raw.publication.revisionSha256=revisionHash(e);
 await assert.rejects(exportStaticPublication(options),/OEX_PROFILE_INVALID/);await assert.rejects(lstat(options.output),{code:'ENOENT'});
});

test("static cover bootstrap escapes authored text and exposes no actionable or asset-loading shell",()=>{
 const html=staticCoverShell('<script>title</script>', 'Artist & "credit"');
 assert(html.includes('&lt;script&gt;title&lt;/script&gt;'));assert(html.includes('Artist &amp; &quot;credit&quot;'));
 const folded=staticCoverShell('Title','Artist','Short introduction',true);
 assert(folded.includes('data-paper-state="folded"'));assert(folded.includes('entrance-paper-left'));assert(folded.includes('entrance-paper-outside entrance-cover-copy" aria-hidden="true"'));assert(folded.includes('Short introduction'));assert(folded.includes('entrance-paper-inside'));assert(!folded.includes('<img'));
 const dollars=staticCoverShell('$& title $` $\'', 'Artist $$');assert(dollars.includes('$&amp; title $` $&#39;'));assert(dollars.includes('Artist $$'));
 assert(!/<(?:script|img|button|a)(?:\s|>)/i.test(html));assert(html.includes('data-cover-bootstrap'));assert(!staticCoverShell('Title').includes('entrance-cover-artist'));
 assert(html.includes('<p class="publication-entry-status-quiet" role="status">'));
 assert(staticCoverShell('').includes('<h1>전시</h1>'));
});

test("static bootstrap insertion preserves literal dollar title through the actual exporter",async t=>{
 const {fixture,options,runtime}=await setup(t);
 fixture.raw.exhibition.title='$& title $` $\'';
 fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);
 await writeFile(join(runtime,'static.html'),'<html><head><meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"><title>ExhibitOS 전시</title></head><body><div id="root"><!--STATIC_COVER_SHELL--></div></body></html>');
 const result=await exportStaticPublication(options),html=await readFile(join(result.output,'index.html'),'utf8');
 assert(html.includes('<h1>$&amp; title $` $&#39;</h1>'));assert(!html.includes('STATIC_COVER_SHELL'));assert(html.includes('<title>$&amp; title $` $&#39;</title>'));
});
