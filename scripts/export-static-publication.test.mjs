// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { readFile,mkdtemp,mkdir,writeFile,lstat,readdir,rm,symlink,truncate,copyFile,realpath } from "node:fs/promises";
import {pathToFileURL} from "node:url";
import { tmpdir } from "node:os";
import { join,dirname } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import {deflateSync} from "node:zlib";
import { fixtureURL,readOex,revisionHash } from "@exhibitos/spec";
import { exportStaticPublication,exportStaticStudioDemo,safeStaticPath,assertStaticBudget,staticCoverShell } from "./export-static-publication.mjs";
import {FLOOR_TEXTURE_FILES,FLOOR_TEXTURE_PACKS,floorTextureFiles,floorTextureNotice,furnishingCatalogueEntry,applyBenchCommand,applyFurnishingCommand,furnishingsFor} from '@exhibitos/studio-contract';
import {SURFACE_MATERIAL_FILES,SURFACE_MATERIAL_PACKS} from '@exhibitos/spec/surface-material-resources';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {createPagesPublicationSource} from './pages-publication-source.mjs';
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
test('selected furnishing model and notice survive static and Pages roundtrip with fail-closed integrity',async t=>{
 const {fixture,options,directory}=await setup(t),room=fixture.raw.exhibition.rooms[0],id=randomUUID(),viewpointId=randomUUID(),catalog=furnishingCatalogueEntry('backless-oak-bench'),{min,max}=catalog.bounds;
 const bench={id,name:'bench',roomId:room.id,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId};
 fixture.raw.exhibition.extensions={...fixture.raw.exhibition.extensions,'org.exhibitos.viewer/footstep-resources':{version:1,families:['wood']}};
 const base=applyBenchCommand(fixture.raw.exhibition,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}}),doc=applyFurnishingCommand(base,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}}),asset=furnishingsFor(doc).assets[0];
 const model=await readFile(new URL('../'+catalog.path,import.meta.url)),notice=await readFile(new URL('../'+catalog.rights.noticePath,import.meta.url));fixture.raw.exhibition=doc;fixture.raw.publication.revisionSha256=revisionHash(doc);fixture.raw.assets.push({assetId:asset.id,mime:asset.mime,url:`/api/v1/publications/${fixture.id}/assets/${asset.id}`});fixture.raw.furnishingNotices=[{assetId:asset.id,bytes:notice.length,sha256:sha(notice),mime:'text/plain; charset=utf-8',url:`/api/v1/publications/${fixture.id}/furnishing-notices/${asset.id}`}];fixture.decoded.manifest.assets.push({id:asset.id,path:asset.path,mime:asset.mime});fixture.decoded.files.set(asset.path,model);
 const steps=footstepResourcesFor(doc);fixture.raw.resources=steps.map(item=>({sha256:item.sha256,bytes:item.bytes,mime:item.mime,url:`/api/v1/publications/${fixture.id}/resources/${item.sha256}`}));
 const fetcher=options.fetcher;options.fetcher=async(input,init)=>{const path=new URL(input).pathname;if(path.endsWith(`/furnishing-notices/${asset.id}`))return new Response(notice,{headers:{'content-type':'text/plain; charset=utf-8','x-exhibitos-publication-revision':fixture.raw.publication.revisionSha256}});const step=steps.find(v=>path.endsWith(`/resources/${v.sha256}`));if(step)return new Response(await readFile(new URL('../apps/web/public/'+step.artifactPath,import.meta.url)),{headers:{'content-type':step.mime,'x-exhibitos-publication-revision':fixture.raw.publication.revisionSha256}});return fetcher(input,init);};
 const result=await exportStaticPublication(options),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json')));assert.equal(index.version,3);assert.equal(index.furnishingNotices.length,1);
 const source=createPagesPublicationSource({origin:'https://synthetic.pages.dev',publicationId:fixture.id,revisionSha256:result.revisionSha256,indexSha256:result.indexSha256,fetch:async url=>{try{return new Response(await readFile(join(result.output,url.pathname)));}catch{return new Response(null,{status:404});}}});
 assert.deepEqual((await source.asset(fixture.id,asset.id)).bytes,model);assert.deepEqual((await source.furnishingNotice(fixture.id,asset.id)).bytes,notice);assert.equal(sha((await source.resource(fixture.id,steps[0].sha256)).bytes),steps[0].sha256);await assert.rejects(source.furnishingNotice(fixture.id,randomUUID()),/PAGES_PUBLICATION_UNAVAILABLE/);
 const bad=options.fetcher;options.fetcher=async(input,init)=>new URL(input).pathname.includes('/furnishing-notices/')?new Response(Buffer.alloc(notice.length),{headers:{'content-type':'text/plain','x-exhibitos-publication-revision':fixture.raw.publication.revisionSha256}}):bad(input,init);await assert.rejects(exportStaticPublication({...options,output:join(directory,'bad-notice')}),/STATIC_FURNISHING_HASH/);
});
test('selected footsteps export exact versioned resources and remain publication scoped',async t=>{
 const {fixture,options,directory}=await setup(t),{raw,id}=fixture;
 raw.exhibition.extensions={...raw.exhibition.extensions,'org.exhibitos.viewer/footstep-resources':{version:1,families:['wood']}};
 raw.publication.revisionSha256=revisionHash(raw.exhibition);
 const selected=footstepResourcesFor(raw.exhibition);
 raw.resources=selected.map(item=>({sha256:item.sha256,bytes:item.bytes,mime:item.mime,url:`/api/v1/publications/${id}/resources/${item.sha256}`}));
 const prior=options.fetcher;options.fetcher=async input=>{
  const path=new URL(input).pathname,item=selected.find(v=>path===`/api/v1/publications/${id}/resources/${v.sha256}`);
  if(!item)return prior(input);const bytes=await readFile(new URL('../apps/web/public/'+item.artifactPath,import.meta.url));
  return new Response(bytes,{headers:{'content-type':item.mime,'x-exhibitos-publication-revision':raw.publication.revisionSha256}});
 };
 const output=await exportStaticPublication(options),indexBytes=await readFile(join(output.output,'static-publication-index.json')),index=JSON.parse(indexBytes);
 assert.equal(index.version,2);assert.equal(index.resources.length,4);
 const source=createPagesPublicationSource({origin:'https://reference-demo.invalid',publicationId:id,revisionSha256:raw.publication.revisionSha256,indexSha256:sha(indexBytes),fetch:async input=>{
  const path=new URL(input).pathname.slice(1);return new Response(await readFile(join(output.output,path)));
 }});
 const value=await source.anonymous(id);assert.equal(value.resources.length,4);
 const record=selected.find(v=>v.role==='sample');assert.equal(sha((await source.resource(id,record.sha256)).bytes),record.sha256);
 await assert.rejects(source.resource(id,'0'.repeat(64)),/PAGES_PUBLICATION_UNAVAILABLE/);
 raw.resources[0].sha256='0'.repeat(64);await assert.rejects(exportStaticPublication({...options,output:join(directory,'bad')}),/STATIC_RESOURCE_INVENTORY/);
});
test("published public projection exports exact synthetic GLB PNG audio and bound revision, excluding private fields",async t=>{const {fixture,options}=await setup(t),result=await exportStaticPublication(options);assert.equal(fixture.reads,2);const indexBytes=await readFile(join(result.output,"static-publication-index.json")),index=JSON.parse(indexBytes);assert.equal(sha(indexBytes),result.indexSha256);assert.match(await readFile(join(result.output,"index.html"),"utf8"),new RegExp(result.indexSha256));const publication=await readFile(join(result.output,index.publication.path),"utf8");assert(!publication.includes("must-never-export"));for(const entry of index.assets){const bytes=await readFile(join(result.output,entry.path));assert.equal(sha(bytes),entry.sha256);assert.deepEqual(bytes,fixture.decoded.files.get(fixture.decoded.manifest.assets.find(a=>a.id===entry.assetId).path));}const manifest=JSON.parse(await readFile(join(result.output,"static-export-manifest.json")));assert.equal(manifest.format,"exhibitos-static-publication-v1");assert.equal(sha(await readFile(join(result.output,"static-export-manifest.json"))),result.manifestSha256);assert.equal(manifest.files.length+1,result.files);for(const f of manifest.files){const b=await readFile(join(result.output,f.path));assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);}assert.equal(index.assets.length,3);await assert.rejects(exportStaticPublication(options),/STATIC_OUTPUT_EXISTS/);});
test('source-bound cover descriptor survives exact static inventory and changes abort export',async t=>{
 const {fixture,options,directory}=await setup(t),{raw,id,decoded}=fixture,art=raw.exhibition.artworks.find(a=>a.artworkType==='image'),primary=art.assets.find(a=>a.id===art.primaryAssetId),coarseId=randomUUID();
 const crc=data=>{let x=0xffffffff;for(const b of data){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return(x^0xffffffff)>>>0;};
 const chunk=(name,body)=>{const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);h.write(name,4);tail.writeUInt32BE(crc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);};
 const png=(w,h)=>{const head=Buffer.alloc(13),pixels=Buffer.alloc((w*3+1)*h);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([x*7%256,y*7%256,(x+y)*7%256],y*(w*3+1)+1+x*3);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);};
 const full=png(1024,512),{viewerVariants}=await import('../apps/api/dist/viewer-variants.js'),generated=await viewerVariants(full,'image/png'),small=generated.bytes,coarsePath=`assets/${coarseId}/image.png`;assert(small&&small.length<full.length);
 Object.assign(primary,{bytes:full.length,sha256:sha(full)});decoded.files.set('assets/'+primary.path,full);
 const coarse={id:coarseId,path:coarsePath,role:'image',mime:'image/png',bytes:small.length,sha256:sha(small)};art.assets.push(coarse);art.extensions={...art.extensions,'org.exhibitos.viewer/lod':{version:1,variants:[{assetId:primary.id,detail:'full',textureSize:1024},{assetId:coarseId,detail:'coarse',textureSize:512}]}};decoded.manifest.assets.push({id:coarseId,path:'assets/'+coarsePath,mime:'image/png'});decoded.files.set('assets/'+coarsePath,small);raw.assets.push({assetId:coarseId,mime:'image/png',url:`/api/v1/publications/${id}/assets/${coarseId}`});
 raw.exhibition.extensions={...raw.exhibition.extensions,'org.exhibitos.viewer/entrance':{version:1,artist:'Synthetic',introduction:'',imageAssetId:primary.id,imageAlt:'Synthetic test',mobilePosition:'center'}};raw.publication.revisionSha256=revisionHash(raw.exhibition);
 const desc=(a,w,h)=>({assetId:a.id,mime:'image/png',sha256:a.sha256,bytes:a.bytes,width:w,height:h});raw.coverVariants={version:1,revisionSha256:raw.publication.revisionSha256,primary:desc(primary,1024,512),variants:[desc(coarse,512,256)]};
 const result=await exportStaticPublication(options),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'))),snapshot=JSON.parse(await readFile(join(result.output,index.publication.path)));assert.deepEqual(snapshot.coverVariants,raw.coverVariants);assert(index.assets.some(a=>a.assetId===coarseId&&a.sha256===coarse.sha256));
 const prior=options.fetcher;options.fetcher=async(...args)=>{if(fixture.reads===3&&new URL(args[0]).pathname.endsWith(id))raw.coverVariants.variants[0].width=511;return prior(...args);};
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'changed-cover')}),/STATIC_PUBLICATION_CHANGED/);await assert.rejects(lstat(join(directory,'changed-cover')),{code:'ENOENT'});
 // A self-asserted unrelated image may match dimensions/inventory, but cannot
 // survive the independent producer proof; the ordinary primary remains.
 options.fetcher=prior;const forged=png(512,256);assert.notEqual(sha(forged),sha(small));coarse.bytes=forged.length;coarse.sha256=sha(forged);decoded.files.set('assets/'+coarsePath,forged);raw.publication.revisionSha256=revisionHash(raw.exhibition);raw.coverVariants={version:1,revisionSha256:raw.publication.revisionSha256,primary:desc(primary,1024,512),variants:[desc(coarse,512,256)]};
 const rejected=await exportStaticPublication({...options,output:join(directory,'unproven-cover')}),rejectedIndex=JSON.parse(await readFile(join(rejected.output,'static-publication-index.json'))),rejectedSnapshot=JSON.parse(await readFile(join(rejected.output,rejectedIndex.publication.path)));assert.equal(rejectedSnapshot.coverVariants,undefined);assert.equal(rejectedSnapshot.exhibition.extensions['org.exhibitos.viewer/entrance'].imageAssetId,primary.id);
});
test("draft or withdrawn snapshot cannot be exported",async t=>{const {fixture,options}=await setup(t);fixture.raw.publication.status="unpublished";await assert.rejects(exportStaticPublication(options),/STATIC_NOT_PUBLISHED/);await assert.rejects(lstat(options.output),{code:"ENOENT"});});
test("withdrawal during asset export leaves no published directory or staging debris",async t=>{const {fixture,options,directory}=await setup(t),fetcher=options.fetcher;options.fetcher=async(...args)=>{if(fixture.reads===1&&new URL(args[0]).pathname.endsWith(fixture.id))fixture.raw.publication.status="unpublished";return fetcher(...args);};await assert.rejects(exportStaticPublication(options),/STATIC_PUBLICATION_CHANGED/);assert.deepEqual(await readdir(directory),["runtime"]);});
test('an unavailable optional thumbnail does not block static export or alter the immutable snapshot',async t=>{
 const {fixture,options}=await setup(t),art=fixture.raw.exhibition.artworks[0],id=randomUUID(),png=fixture.decoded.files.get(fixture.decoded.manifest.assets.find(a=>a.mime==='image/png').path);
 art.assets.push({id,path:`assets/${id}/thumbnail.png`,role:'preview',mime:'image/png',bytes:png.length,sha256:sha(png)});art.extensions={...art.extensions,'org.exhibitos.viewer/thumbnail':{version:1,assetId:id}};fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);
 const result=await exportStaticPublication(options),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'))),snapshot=JSON.parse(await readFile(join(result.output,index.publication.path)));
 assert.equal(snapshot.exhibition.artworks[0].extensions['org.exhibitos.viewer/thumbnail'].assetId,id);assert.equal(revisionHash(snapshot.exhibition),fixture.raw.publication.revisionSha256);assert(!index.assets.some(a=>a.assetId===id));
});
test('a preview revoked during static export prevents publication of that export',async t=>{
 const {fixture,options,directory}=await setup(t),art=fixture.raw.exhibition.artworks[0],id=randomUUID(),png=fixture.decoded.files.get(fixture.decoded.manifest.assets.find(a=>a.mime==='image/png').path),path=`assets/${id}/thumbnail.png`;
 art.assets.push({id,path,role:'preview',mime:'image/png',bytes:png.length,sha256:sha(png)});art.extensions={...art.extensions,'org.exhibitos.viewer/thumbnail':{version:1,assetId:id}};fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);fixture.raw.assets.push({assetId:id,mime:'image/png',url:`/api/v1/publications/${fixture.id}/assets/${id}`});fixture.decoded.manifest.assets.push({id,path,mime:'image/png'});fixture.decoded.files.set(path,png);
 const fetcher=options.fetcher;options.fetcher=async(...args)=>{if(fixture.reads===1&&new URL(args[0]).pathname.endsWith(fixture.id))fixture.raw.assets=fixture.raw.assets.filter(a=>a.assetId!==id);return fetcher(...args);};await assert.rejects(exportStaticPublication(options),/STATIC_PUBLICATION_CHANGED/);await assert.rejects(lstat(options.output),{code:'ENOENT'});assert.deepEqual(await readdir(directory),['runtime']);
});
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

test('selected floor maps and notices survive static export with integrity and no invented artwork or sound',async t=>{
 const {fixture,options,runtime,directory}=await setup(t),e=fixture.raw.exhibition,namespace='org.exhibitos.studio/floors';
 const room=e.rooms[0],floor={id:'50000000-0000-4000-8000-000000000021',roomId:room.id,type:'floor',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}};
 e.surfaces.push(floor);
 const floors={version:1,bindings:[{target:{kind:'surface',surfaceId:floor.id},preset:'wood',repeatMeters:[1.8,1.8],rotation:0,normalScale:0,aoStrength:0}]};
 e.extensions={...e.extensions,[namespace]:floors};fixture.raw.publication.revisionSha256=revisionHash(e);
 // Simulate a complete app runtime; export must include only the selected pack.
 for(const file of FLOOR_TEXTURE_FILES){const target=join(runtime,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(new URL('../apps/web/public/'+file.path,import.meta.url),target);}
 const result=await exportStaticPublication(options),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'))),published=JSON.parse(await readFile(join(result.output,index.publication.path)));
 assert.deepEqual(published.exhibition.extensions[namespace],floors);assert.equal(index.assets.length,3);
 const selected=floorTextureFiles(FLOOR_TEXTURE_PACKS.find(p=>p.id==='WoodFloor051'));
 const manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json'))),maps=manifest.files.filter(f=>f.path.startsWith('floor-textures/'));
 assert.deepEqual(maps.map(f=>f.path).sort(),selected.map(f=>f.path).sort());
 for(const file of selected){const bytes=await readFile(join(result.output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 const notices=await readFile(join(result.output,'floor-texture-notices.txt'),'utf8');assert(notices.includes('WoodFloor051'));assert(!notices.includes('Marble006'));assert(!notices.includes('/Volumes/'));
 const first=selected[0],bad=await readFile(join(runtime,first.path));bad[bad.length-1]^=1;await writeFile(join(runtime,first.path),bad);
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'corrupt-floor')}),/STATIC_FLOOR_INTEGRITY/);
 await rm(join(runtime,first.path));await assert.rejects(exportStaticPublication({...options,output:join(directory,'missing-floor')}),/STATIC_FLOOR_MISSING/);
});
test('invalid floor references cannot bypass static profile admission',async t=>{
 const {fixture,options}=await setup(t),e=fixture.raw.exhibition;
 e.extensions={...e.extensions,'org.exhibitos.studio/floors':{version:1,bindings:[{target:{kind:'surface',surfaceId:randomUUID()},preset:'wood',repeatMeters:[1.8,1.8],rotation:0}]}};fixture.raw.publication.revisionSha256=revisionHash(e);
 await assert.rejects(exportStaticPublication(options),/OEX_PROFILE_INVALID/);await assert.rejects(lstat(options.output),{code:'ENOENT'});
});

async function surfaceEditorSetup(t){
 const state=await setup(t);state.options.privateEditor=true;
 await writeFile(join(state.runtime,'static.html'),'<meta content="STATIC_INDEX_SHA256"><div id="root"></div>');
 await writeFile(join(state.runtime,'static-studio.html'),'<meta content="STATIC_INDEX_SHA256">');
 for(const file of SURFACE_MATERIAL_FILES){const path=join(state.runtime,file.artifactPath);await mkdir(dirname(path),{recursive:true});await copyFile(new URL('../apps/web/public/'+file.artifactPath,import.meta.url),path);}
 return state;
}
async function exportedSurfaceFiles(options){
 const result=await exportStaticPublication(options),manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json')));
 const files=manifest.files.filter(file=>SURFACE_MATERIAL_FILES.some(known=>known.artifactPath===file.path));
 for(const file of files){const bytes=await readFile(join(result.output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 return files;
}
test('private editor exports complete exact registered CC0 surface packs; ordinary exports stay unchanged',async t=>{
 const {options,directory}=await surfaceEditorSetup(t);
 const expected=SURFACE_MATERIAL_FILES.map(file=>({path:file.artifactPath,bytes:file.bytes,sha256:file.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 assert.deepEqual(await exportedSurfaceFiles(options),expected);
 assert.deepEqual(await exportedSurfaceFiles({...options,privateEditor:false,output:join(directory,'ordinary')}),[]);
});
test('optional surface pack omission is atomic for missing, corrupt, wrong-size and nonordinary local files',async t=>{
 for(const damage of ['missing-map','corrupt-notice','wrong-size','file-directory','file-link','directory-link'])await t.test(damage,async t=>{
  const {runtime,options,directory}=await surfaceEditorSetup(t),pack=SURFACE_MATERIAL_PACKS[0],files=SURFACE_MATERIAL_FILES.filter(file=>file.packId===pack.id),file=damage==='corrupt-notice'?files.find(file=>file.role==='notice'):files.find(file=>file.role==='color'),path=join(runtime,file.artifactPath);
  if(damage==='missing-map')await rm(path);
  if(damage==='corrupt-notice'){const bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);}
  if(damage==='wrong-size')await truncate(path,1);
  if(damage==='file-directory'){await rm(path);await mkdir(path);}
  if(damage==='file-link'){await rm(path);await symlink(new URL('../apps/web/public/'+file.artifactPath,import.meta.url).pathname,path);}
  if(damage==='directory-link'){const dir=dirname(path);await rm(dir,{recursive:true});await symlink(dirname(new URL('../apps/web/public/'+file.artifactPath,import.meta.url).pathname),dir);}
  const emitted=await exportedSurfaceFiles(options);
  assert.deepEqual(emitted.map(file=>file.path),SURFACE_MATERIAL_FILES.filter(file=>file.packId!==pack.id).map(file=>file.artifactPath).sort((a,b)=>a.localeCompare(b)));
  if(damage==='file-link'||damage==='directory-link')await assert.rejects(exportStaticPublication({...options,privateEditor:false,output:join(directory,'ordinary')}),/STATIC_SYMLINK/);
 });
});
test('private editor still fails closed for missing or corrupt required surface packs',async t=>{
 const {runtime,fixture,options,directory}=await surfaceEditorSetup(t),pack=SURFACE_MATERIAL_PACKS[0],wall=fixture.raw.exhibition.surfaces.find(surface=>surface.type==='wall');
 fixture.raw.exhibition.extensions={...fixture.raw.exhibition.extensions,'org.exhibitos.studio/materials':{version:1,surfaces:{},surfaceTextures:{[wall.id]:{pack:{id:pack.id,version:pack.version},repeatMeters:[1,1],rotation:0,normalScale:1}}}};
 fixture.raw.publication.revisionSha256=revisionHash(fixture.raw.exhibition);
 assert.equal((await exportedSurfaceFiles(options)).length,SURFACE_MATERIAL_FILES.length);
 const file=SURFACE_MATERIAL_FILES.find(file=>file.packId===pack.id&&file.role==='notice'),path=join(runtime,file.artifactPath),bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'corrupt-required')}),/STATIC_MATERIAL_INTEGRITY/);
 await rm(path);
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'missing-required')}),/STATIC_MATERIAL_MISSING/);
});

test('optional surface handling does not admit unregistered runtime files',async t=>{
 const {runtime,options}=await surfaceEditorSetup(t);
 await writeFile(join(runtime,dirname(SURFACE_MATERIAL_FILES[0].artifactPath),'unregistered.txt'),'unapproved');
 await assert.rejects(exportStaticPublication(options),/STATIC_RUNTIME_UNLISTED/);
});

async function floorEditorSetup(t){
 const state=await setup(t);state.options.privateEditor=true;
 await writeFile(join(state.runtime,'static.html'),'<meta content="STATIC_INDEX_SHA256"><div id="root"></div>');
 await writeFile(join(state.runtime,'static-studio.html'),'<meta content="STATIC_INDEX_SHA256">');
 for(const file of FLOOR_TEXTURE_FILES){const path=join(state.runtime,file.path);await mkdir(dirname(path),{recursive:true});await copyFile(new URL('../apps/web/public/'+file.path,import.meta.url),path);}
 return state;
}
async function assertExportedFloorPacks(options,packs){
 const result=await exportStaticPublication(options),manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json'))),expected=packs.flatMap(floorTextureFiles).map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 assert.deepEqual(manifest.files.filter(file=>file.path.startsWith('floor-textures/')),expected);
 for(const file of expected){const bytes=await readFile(join(result.output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 const notice=manifest.files.find(file=>file.path==='floor-texture-notices.txt');
 if(!packs.length){assert.equal(notice,undefined);await assert.rejects(lstat(join(result.output,'floor-texture-notices.txt')),{code:'ENOENT'});}
 else{const bytes=Buffer.from(packs.map(floorTextureNotice).join('\n'));assert.deepEqual(await readFile(join(result.output,notice.path)),bytes);assert.equal(notice.bytes,bytes.length);assert.equal(notice.sha256,sha(bytes));}
 return result;
}
test('private editor includes complete local floor packs with canonical ordered notices; ordinary exports omit optional packs',async t=>{
 const {options,directory}=await floorEditorSetup(t);
 await assertExportedFloorPacks(options,FLOOR_TEXTURE_PACKS);
 await assertExportedFloorPacks({...options,privateEditor:false,output:join(directory,'ordinary')},[]);
});
test('invalid optional floor maps omit the entire pack and its notice while other packs remain available',async t=>{
 for(const damage of ['missing','hash','size','directory','file-link','ancestor-link'])await t.test(damage,async t=>{
  const {runtime,options,directory}=await floorEditorSetup(t),pack=FLOOR_TEXTURE_PACKS[0],file=floorTextureFiles(pack)[1],path=join(runtime,file.path);
  if(damage==='missing')await rm(path);
  if(damage==='hash'){const bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);}
  if(damage==='size')await truncate(path,1);
  if(damage==='directory'){await rm(path);await mkdir(path);}
  if(damage==='file-link'){await rm(path);await symlink(new URL('../apps/web/public/'+file.path,import.meta.url).pathname,path);}
  if(damage==='ancestor-link'){const dir=dirname(path);await rm(dir,{recursive:true});await symlink(dirname(new URL('../apps/web/public/'+file.path,import.meta.url).pathname),dir);}
  await assertExportedFloorPacks(options,FLOOR_TEXTURE_PACKS.slice(1));
  if(damage==='file-link'||damage==='ancestor-link')await assert.rejects(exportStaticPublication({...options,privateEditor:false,output:join(directory,'ordinary')}),/STATIC_SYMLINK/);
 });
});
test('required floor maps still fail closed in private exports with optional packs and preserve original sound metadata',async t=>{
 const {runtime,fixture,options,directory}=await floorEditorSetup(t),e=fixture.raw.exhibition,room=e.rooms[0],pack=FLOOR_TEXTURE_PACKS[2];
 const floor={id:randomUUID(),roomId:room.id,type:'floor',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}};e.surfaces.push(floor);
 e.extensions={...e.extensions,'org.exhibitos.studio/floors':{version:1,bindings:[{target:{kind:'surface',surfaceId:floor.id},preset:'tile',repeatMeters:[2,3],rotation:.2,sound:{mode:'none',gain:.3}}]}};
 fixture.raw.publication.revisionSha256=revisionHash(e);
 // Omit an optional pack, keeping a required pack in registry order among the remaining optional packs.
 await rm(join(runtime,floorTextureFiles(FLOOR_TEXTURE_PACKS[0])[0].path));
 const result=await assertExportedFloorPacks(options,FLOOR_TEXTURE_PACKS.slice(1)),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json'))),published=JSON.parse(await readFile(join(result.output,index.publication.path)));
 assert.deepEqual(published.exhibition,e);assert.equal(revisionHash(published.exhibition),fixture.raw.publication.revisionSha256);
 const path=join(runtime,floorTextureFiles(pack)[0].path),bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);
 await assert.rejects(exportStaticPublication({...options,output:join(directory,'corrupt-required')}),/STATIC_FLOOR_INTEGRITY/);
 await rm(path);await assert.rejects(exportStaticPublication({...options,output:join(directory,'missing-required')}),/STATIC_FLOOR_MISSING/);
});
test('private optional floor handling still rejects unregistered runtime files',async t=>{
 const {runtime,options}=await floorEditorSetup(t);
 await writeFile(join(runtime,dirname(FLOOR_TEXTURE_FILES[0].path),'extra.png'),'unregistered');
 await assert.rejects(exportStaticPublication(options),/STATIC_RUNTIME_UNLISTED/);
});

const benchPrefix='furnish-catalog/backless-oak-bench/1/';
async function isolatedBenchExporter(t){
 const state=await setup(t);state.options.privateEditor=true;
 await writeFile(join(state.runtime,'static.html'),'<meta content="STATIC_INDEX_SHA256"><div id="root"></div>');
 await writeFile(join(state.runtime,'static-studio.html'),'<meta content="STATIC_INDEX_SHA256">');
 // Isolate the existing compiled trusted reader's source root. Damage tests
 // must never rename or modify the shared catalogue or another checkout.
 const code=join(state.directory,'trusted-code'),api=join(code,'apps/api/dist');await mkdir(api,{recursive:true});await mkdir(join(code,'scripts'));
 await copyFile(new URL('./export-static-publication.mjs',import.meta.url),join(code,'scripts/export-static-publication.mjs'));
 for(const name of ['oex.js','cover-images.js','auth.js'])await symlink(await realpath(new URL('../apps/api/dist/'+name,import.meta.url)),join(api,name));
 await copyFile(new URL('../apps/api/dist/furnishings.js',import.meta.url),join(api,'furnishings.js'));
 await symlink(await realpath(new URL('../node_modules',import.meta.url)),join(code,'node_modules'));
 const entry=furnishingCatalogueEntry('backless-oak-bench');
 for(const path of [entry.path,entry.rights.noticePath]){const destination=join(code,path);await mkdir(dirname(destination),{recursive:true});await copyFile(new URL('../'+path,import.meta.url),destination);}
 const {exportStaticPublication:exporter}=await import(pathToFileURL(join(code,'scripts/export-static-publication.mjs')).href);
 return {...state,code,entry,exporter};
}
async function benchManifest(exporter,options){const result=await exporter(options),manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json')));return {result,entries:manifest.files.filter(file=>file.path.startsWith('furnish-catalog/'))};}
test('private editor includes the exact approved bench model and notice pair without expanding publication inventory',async t=>{
 const {exporter,options,directory,entry}=await isolatedBenchExporter(t),{result,entries}=await benchManifest(exporter,options);
 const expected=[{path:benchPrefix+'LICENSE-NOTICE.txt',bytes:entry.rights.noticeBytes,sha256:entry.rights.noticeSha256},{path:benchPrefix+'model.glb',bytes:entry.bytes,sha256:entry.sha256}];
 assert.deepEqual(entries,expected);
 for(const file of expected){const bytes=await readFile(join(result.output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 const ordinary=await benchManifest(exporter,{...options,privateEditor:false,output:join(directory,'ordinary')});assert.deepEqual(ordinary.entries,[]);
 assert.deepEqual(await readFile(join(result.output,'static-publication-index.json')),await readFile(join(ordinary.result.output,'static-publication-index.json')));
});
test('optional bench pair is omitted atomically for missing, corrupt, wrong-size or linked trusted source files',async t=>{
 for(const damage of ['missing-model','missing-notice','corrupt-model','corrupt-notice','wrong-size','file-link','directory-link'])await t.test(damage,async t=>{
  const {exporter,options,code,entry}=await isolatedBenchExporter(t),path=join(code,damage.includes('notice')?entry.rights.noticePath:entry.path);
  if(damage.startsWith('missing'))await rm(path);
  if(damage.startsWith('corrupt')){const bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);}
  if(damage==='wrong-size')await truncate(path,1);
  if(damage==='file-link'){await rm(path);await symlink(new URL('../'+entry.path,import.meta.url).pathname,path);}
  if(damage==='directory-link'){const dir=dirname(path);await rm(dir,{recursive:true});await symlink(dirname(new URL('../'+entry.path,import.meta.url).pathname),dir);}
  const {result,entries}=await benchManifest(exporter,options);assert.deepEqual(entries,[]);
  await assert.rejects(lstat(join(result.output,'furnish-catalog')),{code:'ENOENT'});
 });
});
test('runtime-supplied bench catalogue paths remain unlisted and cannot shadow trusted bytes',async t=>{
 const {exporter,options,runtime}=await isolatedBenchExporter(t),path=join(runtime,benchPrefix+'model.glb');await mkdir(dirname(path),{recursive:true});await writeFile(path,'untrusted');
 await assert.rejects(exporter(options),/STATIC_RUNTIME_UNLISTED/);
});
