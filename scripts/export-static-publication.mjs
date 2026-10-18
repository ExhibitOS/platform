// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash,randomUUID } from "node:crypto";
import { lstat,mkdir,readdir,readFile,rename,writeFile,rm,mkdtemp,copyFile } from "node:fs/promises";
import { resolve,dirname,join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { fixtureURL,readOex,revisionHash,validateArtworkFiles,validateExhibition } from "@exhibitos/spec";
import { checkOexProfile } from "../apps/api/dist/oex.js";
const SAMPLE_REVISION="4a561248e1f166dfb3ca2ea4cfb692127e1e533440ce0c8a7aba1df069b58f00";
const MAX=25*1024*1024,COUNT=20000,sha=b=>createHash("sha256").update(b).digest("hex");
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(code,path)=>{throw Error(`${code}: ${path}`);};
export function safeStaticPath(path){return typeof path==="string"&&path.length<=240&&/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(path)&&path.split("/").every(p=>p!==".."&&!p.endsWith(".")&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
export function assertStaticBudget(path,bytes,count){if(bytes>MAX)fail("STATIC_FILE_TOO_LARGE",path);if(count>=COUNT)fail("STATIC_FILE_COUNT",path);}
async function bounded(response,limit,name){if(!response.ok||!response.body)fail("STATIC_FETCH",name);const reader=response.body.getReader(),chunks=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)fail("STATIC_FILE_TOO_LARGE",name);chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}return Buffer.concat(chunks);}
/** Only the public, already-published API projection is accepted; no database or private source reads. */
export async function exportStaticPublication({origin,publicationId,runtimeRoot,output,fetcher=fetch,studioDemo=false}){
 let url;try{url=new URL(origin);}catch{fail("STATIC_LOCAL_ORIGIN","origin");}if(!["http:","https:"].includes(url.protocol)||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)fail("STATIC_LOCAL_ORIGIN","origin");
 if(!uuid.test(publicationId))fail("STATIC_PUBLICATION_ID",publicationId);
 const request=path=>fetcher(new URL(path,url),{credentials:"omit",redirect:"error",signal:AbortSignal.timeout(30000)});
 const raw=JSON.parse((await bounded(await request(`/api/v1/publications/${publicationId}`),1048576,"publication.json")).toString("utf8"));
 if(raw.publication?.id!==publicationId||raw.publication?.status!=="published"||!Number.isFinite(Date.parse(raw.publication.publishedAt)))fail("STATIC_NOT_PUBLISHED",publicationId);
 if(revisionHash(raw.exhibition)!==raw.publication.revisionSha256)fail("STATIC_REVISION",publicationId);
 if(studioDemo&&(raw.publication.revisionSha256!==SAMPLE_REVISION||[...raw.exhibition.artworks,...raw.exhibition.mediaAssets].some(a=>a.rights.licenseId!=="CC0-1.0")))fail("STATIC_DEMO_SAMPLE",publicationId);
 const inventory=[...raw.exhibition.artworks.flatMap(a=>a.assets),...raw.exhibition.mediaAssets],byId=new Map();
 for(const asset of inventory){if(!safeStaticPath(asset.path))fail("STATIC_ASSET_PATH",asset.path);const prior=byId.get(asset.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(asset))fail("STATIC_ASSET_ALIAS",asset.path);byId.set(asset.id,asset);}
 checkOexProfile(raw.exhibition);if(!validateExhibition(raw.exhibition,{publicationTime:new Date().toISOString()}).valid)fail("STATIC_DISPLAY_RIGHTS","publication.json");
 if(!Array.isArray(raw.assets)||raw.assets.length!==byId.size||new Set(raw.assets.map(a=>a.assetId)).size!==byId.size)fail("STATIC_INVENTORY","publication.json");
 const target=resolve(output),parent=dirname(target);try{await lstat(target);fail("STATIC_OUTPUT_EXISTS",target);}catch(e){if(e.code!=="ENOENT")throw e;}
 const parentStat=await lstat(parent);if(!parentStat.isDirectory()||parentStat.isSymbolicLink())fail("STATIC_OUTPUT_PARENT",parent);
 const temporary=join(parent,`.static-export-${randomUUID()}`);await mkdir(temporary,{mode:0o700});
 const files=new Map(),assetIndex=[];const put=async(path,bytes)=>{if(!safeStaticPath(path)||files.has(path))fail("STATIC_PATH_COLLISION",path);assertStaticBudget(path,bytes.length,files.size);await mkdir(dirname(join(temporary,path)),{recursive:true});await writeFile(join(temporary,path),bytes,{flag:"wx",mode:0o600});files.set(path,{bytes:bytes.length,sha256:sha(bytes)});};
 try{
 for(const asset of raw.assets){const item=byId.get(asset.assetId);if(!item||asset.url!==`/api/v1/publications/${publicationId}/assets/${asset.assetId}`||item.mime!==asset.mime)fail("STATIC_ASSET_URL",asset.url);if(item.bytes>MAX)fail("STATIC_FILE_TOO_LARGE",item.path);
 const response=await request(asset.url);if(response.headers.get("x-exhibitos-publication-revision")!==raw.publication.revisionSha256||response.headers.get("content-type")?.split(";")[0]!==item.mime)fail("STATIC_ASSET_RESPONSE",item.path);
 const data=await bounded(response,Math.min(MAX,item.bytes),item.path);if(data.length!==item.bytes||sha(data)!==item.sha256)fail("STATIC_ASSET_HASH",item.path);
 const path=`data/${item.sha256}.bin`;if(!files.has(path))await put(path,data);assetIndex.push({assetId:asset.assetId,path,bytes:item.bytes,sha256:item.sha256,mime:item.mime});}
 for(const artwork of raw.exhibition.artworks){const validation=await mkdtemp(join(tmpdir(),"exhibitos-static-validation-"));try{for(const asset of artwork.assets){const path=join(validation,asset.path);await mkdir(dirname(path),{recursive:true});await copyFile(join(temporary,`data/${asset.sha256}.bin`),path);}const result=await validateArtworkFiles(artwork,validation);if(!result.valid)fail("STATIC_ARTWORK_INVALID",artwork.id);}finally{await rm(validation,{recursive:true,force:true});}}
 const publication={publication:{id:publicationId,revisionSha256:raw.publication.revisionSha256,publishedAt:raw.publication.publishedAt,status:"published"},exhibition:raw.exhibition,assets:raw.assets.map(a=>({assetId:a.assetId,url:a.url,mime:a.mime}))};
 const p=Buffer.from(JSON.stringify(publication)),pPath=`data/${sha(p)}.json`;await put(pPath,p);
 const index=Buffer.from(JSON.stringify({version:1,publication:{path:pPath,bytes:p.length,sha256:sha(p),mime:"application/json"},assets:assetIndex}));if(index.length>1048576)fail("STATIC_INDEX_SIZE","static-publication-index.json");await put("static-publication-index.json",index);
 const runtime=resolve(runtimeRoot);async function walk(dir,prefix=""){const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail("STATIC_RUNTIME_DIRECTORY",prefix||runtime);for(const name of (await readdir(dir)).sort()){const rel=prefix+name;if(!safeStaticPath(rel))fail("STATIC_RUNTIME_PATH",rel);const path=join(dir,name),s=await lstat(path);if(s.isSymbolicLink())fail("STATIC_SYMLINK",rel);if(s.isDirectory())await walk(path,rel+"/");else if(s.isFile()){if(rel==="static-studio.html"&&!studioDemo)continue;if(!["static.html","static-studio.html","THIRD_PARTY_NOTICES.txt","voice-pcm-worklet.js"].includes(rel)&&! /^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(rel))fail("STATIC_RUNTIME_UNLISTED",rel);assertStaticBudget(rel,s.size,files.size);let b=await readFile(path);if(rel==="static.html"||rel==="static-studio.html"){if(b.toString().split("STATIC_INDEX_SHA256").length!==2)fail("STATIC_RUNTIME_INDEX",rel);b=Buffer.from(b.toString().replace("STATIC_INDEX_SHA256",sha(index)));if(rel==="static.html"&&studioDemo){if(!b.toString().includes('<div id="root">'))fail("STATIC_RUNTIME_ENTRY",rel);b=Buffer.from(b.toString().replace('<div id="root">','<nav class="cms-actions" aria-label="샘플 체험"><a href="/studio.html">이 전시로 배치 편집 체험하기</a></nav><div id="root">'));}await put(rel==="static.html"?"index.html":"studio.html",b);}else await put(rel,b);}else fail("STATIC_RUNTIME_TYPE",rel);}}await walk(runtime);
 if(!files.has("index.html"))fail("STATIC_RUNTIME_ENTRY","static.html");
 if(studioDemo&&!files.has("studio.html"))fail("STATIC_RUNTIME_ENTRY","static-studio.html");
 // Recheck public status/revision immediately before publication; no draft/withdrawn snapshot is exported.
 const current=JSON.parse((await bounded(await request(`/api/v1/publications/${publicationId}`),1048576,"publication.json")).toString());if(current.publication?.status!=="published"||current.publication?.revisionSha256!==publication.publication.revisionSha256)fail("STATIC_PUBLICATION_CHANGED",publicationId);
 const manifest=Buffer.from(JSON.stringify({format:"exhibitos-static-publication-v1",publicationId,revisionSha256:publication.publication.revisionSha256,indexSha256:sha(index),files:[...files].map(([path,entry])=>({path,...entry})).sort((a,b)=>a.path.localeCompare(b.path))}));await put("static-export-manifest.json",manifest);
 try{await lstat(target);fail("STATIC_OUTPUT_EXISTS",target);}catch(e){if(e.code!=="ENOENT")throw e;}
 await rename(temporary,target);
 return {publicationId,revisionSha256:publication.publication.revisionSha256,indexSha256:sha(index),manifestSha256:sha(manifest),files:files.size,bytes:[...files.values()].reduce((n,b)=>n+b.bytes,0),output:target};
 }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}

}
/** The demo uses only the existing redistributable fixture; no server or authoring approval is fabricated. */
export async function exportStaticStudioDemo({runtimeRoot,output}){
 const decoded=await readOex(await readFile(fixtureURL("oex/v1/examples/synthetic-media.oex")));
 const id=decoded.exhibition.id,revisionSha256=revisionHash(decoded.exhibition);
 if(revisionSha256!==SAMPLE_REVISION)fail("STATIC_DEMO_SAMPLE",id);
 const raw={publication:{id,revisionSha256,publishedAt:new Date().toISOString(),status:"published"},exhibition:decoded.exhibition,assets:decoded.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,url:`/api/v1/publications/${id}/assets/${a.id}`}))};
 return exportStaticPublication({origin:"http://127.0.0.1",publicationId:id,runtimeRoot,output,studioDemo:true,fetcher:async input=>{
  const path=new URL(input).pathname;
  if(path===`/api/v1/publications/${id}`)return Response.json(raw);
  const asset=decoded.manifest.assets.find(a=>path===`/api/v1/publications/${id}/assets/${a.id}`);
  return asset?new Response(decoded.files.get(asset.path),{headers:{"content-type":asset.mime,"x-exhibitos-publication-revision":revisionSha256}}):new Response(null,{status:404});
 }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args[0]==="--studio-demo"){
  if(args.length!==3)throw Error("Usage: export-static-publication.mjs --studio-demo DIST_STATIC NEW_DIRECTORY");
  console.log(JSON.stringify(await exportStaticStudioDemo({runtimeRoot:args[1],output:args[2]})));
 }else{
  const [origin,publicationId,runtimeRoot,output]=args;
  if(args.length!==4)throw Error("Usage: export-static-publication.mjs LOOPBACK_ORIGIN PUBLICATION_UUID DIST_STATIC NEW_DIRECTORY");
  console.log(JSON.stringify(await exportStaticPublication({origin,publicationId,runtimeRoot,output})));
 }
}
