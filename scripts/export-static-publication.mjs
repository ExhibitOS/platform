// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash,randomUUID } from "node:crypto";
import { open,lstat,mkdir,readdir,readFile,rename,writeFile,rm,mkdtemp,copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve,dirname,join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { fixtureURL,readOex,revisionHash,validateArtworkFiles,validateExhibition } from "@exhibitos/spec";
import { checkOexProfile } from "../apps/api/dist/oex.js";
import {validateCoverImage} from '../apps/api/dist/cover-images.js';
import {FLOOR_TEXTURE_PACKS,FLOOR_TEXTURE_FILES,requiredFloorTexturePacks,floorTextureFiles,floorTextureNotice,furnishingAsset,furnishingCatalogueEntry,artworkThumbnailFor,ARTWORK_THUMBNAIL_NAMESPACE} from '@exhibitos/studio-contract';
import {spaceStillFor} from '@exhibitos/spec/space-still';
import {footstepResourcesFor,FOOTSTEP_SAMPLES,FOOTSTEP_NOTICES} from '@exhibitos/spec/footstep-resources';
import {SURFACE_MATERIAL_PACKS,SURFACE_MATERIAL_FILES,packageSurfaceMaterialManifest} from '@exhibitos/spec/surface-material-resources';
/** Inert public text only; actionable entry waits for verified index/document data. */
export function staticCoverShell(title,artist="",introduction="",hasImage=false,unfold=true,ratio=4/3){
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const copy=`<h1>${escape(title||'전시')}</h1>${artist?`<p class="entrance-cover-artist">${escape(artist)}</p>`:""}${introduction?`<p class="entrance-cover-introduction">${escape(introduction)}</p>`:""}`;
 return `<section class="entrance-cover publication-bootstrap" data-cover-bootstrap data-cover-ratio="${Number.isFinite(ratio)&&ratio>0?ratio:4/3}" data-has-image="${hasImage}" data-paper-state="${hasImage&&unfold?'folded':'flat'}"><div class="entrance-cover-spread"><div class="entrance-cover-copy entrance-paper-left">${copy}</div>${hasImage?`<div class="entrance-paper-leaf" style="aspect-ratio:${Number.isFinite(ratio)&&ratio>0?ratio:4/3}"><div class="entrance-paper-outside entrance-cover-copy" aria-hidden="true">${copy}</div><div class="entrance-paper-inside"></div></div>`:""}</div><div class="entrance-cover-actions"><p class="publication-entry-status-quiet" role="status">전시 정보를 확인하고 있어요.</p></div></section>`;
}
const SAMPLE_REVISION="4a561248e1f166dfb3ca2ea4cfb692127e1e533440ce0c8a7aba1df069b58f00";
const WALKING_SAMPLE_REVISION="fa261e9791bc482f92c30cf4aca325a9e3a9fc6609e67d3e12ae81d00c148afa";
const MAX=25*1024*1024,COUNT=20000,sha=b=>createHash("sha256").update(b).digest("hex");
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(code,path)=>{throw Error(`${code}: ${path}`);};
export function safeStaticPath(path){return typeof path==="string"&&path.length<=240&&/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(path)&&path.split("/").every(p=>p!==".."&&!p.endsWith(".")&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
export function assertStaticBudget(path,bytes,count){if(bytes>MAX)fail("STATIC_FILE_TOO_LARGE",path);if(count>=COUNT)fail("STATIC_FILE_COUNT",path);}
async function bounded(response,limit,name){if(!response.ok||!response.body)fail("STATIC_FETCH",name);const reader=response.body.getReader(),chunks=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)fail("STATIC_FILE_TOO_LARGE",name);chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}return Buffer.concat(chunks);}
/** Only the public, already-published API projection is accepted; no database or private source reads. */
export async function exportStaticPublication({origin,publicationId,runtimeRoot,output,fetcher=fetch,studioDemo=false,privateEditor=false}){
 let url;try{url=new URL(origin);}catch{fail("STATIC_LOCAL_ORIGIN","origin");}if(!["http:","https:"].includes(url.protocol)||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)fail("STATIC_LOCAL_ORIGIN","origin");
 if(!uuid.test(publicationId))fail("STATIC_PUBLICATION_ID",publicationId);
 const request=path=>fetcher(new URL(path===`/api/v1/publications/${publicationId}`?path+'?footsteps=1':path,url),{credentials:"omit",redirect:"error",signal:AbortSignal.timeout(30000)});
 const raw=JSON.parse((await bounded(await request(`/api/v1/publications/${publicationId}`),1048576,"publication.json")).toString("utf8"));
 if(raw.publication?.id!==publicationId||raw.publication?.status!=="published"||!Number.isFinite(Date.parse(raw.publication.publishedAt)))fail("STATIC_NOT_PUBLISHED",publicationId);
 if(revisionHash(raw.exhibition)!==raw.publication.revisionSha256)fail("STATIC_REVISION",publicationId);
 const still=spaceStillFor(raw.exhibition),rightsSources=[...raw.exhibition.artworks,...raw.exhibition.mediaAssets,...(still?[still]:[])];
 if(studioDemo&&(![SAMPLE_REVISION,WALKING_SAMPLE_REVISION].includes(raw.publication.revisionSha256)||rightsSources.some(a=>a.rights.licenseId!=="CC0-1.0")))fail("STATIC_DEMO_SAMPLE",publicationId);
 if(privateEditor&&rightsSources.some(a=>a.rights.licenseId!=="CC0-1.0"||!a.rights.permissions.display||!a.rights.permissions.export))fail("STATIC_PRIVATE_EDITOR_RIGHTS",publicationId);
 const inventory=[...raw.exhibition.artworks.flatMap(a=>a.assets),...raw.exhibition.mediaAssets,...(still?[still]:[])],byId=new Map();
 for(const asset of inventory){if(!safeStaticPath(asset.path))fail("STATIC_ASSET_PATH",asset.path);const prior=byId.get(asset.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(asset))fail("STATIC_ASSET_ALIAS",asset.path);byId.set(asset.id,asset);}
 checkOexProfile(raw.exhibition);if(!validateExhibition(raw.exhibition,{publicationTime:new Date().toISOString()}).valid)fail("STATIC_DISPLAY_RIGHTS","publication.json");
 const stepResources=footstepResourcesFor(raw.exhibition),declared=raw.resources;
 if(stepResources.length){
  if(!Array.isArray(declared)||declared.length!==stepResources.length||new Set(declared.map(x=>x.sha256)).size!==stepResources.length||stepResources.some(item=>!declared.some(x=>Object.keys(x).sort().join(',')==='bytes,mime,sha256,url'&&x.sha256===item.sha256&&x.bytes===item.bytes&&x.mime===item.mime&&x.url===`/api/v1/publications/${publicationId}/resources/${item.sha256}`)))fail('STATIC_RESOURCE_INVENTORY','publication.json');
 }else if(declared!==undefined)fail('STATIC_RESOURCE_INVENTORY','publication.json');
 const requiredIds=new Set([...raw.exhibition.artworks.flatMap(a=>{const preview=artworkThumbnailFor(a)?.id;return a.assets.filter(x=>x.id!==preview).map(x=>x.id);}),...raw.exhibition.mediaAssets.map(a=>a.id),...(still?[still.id]:[])]);
 if(!Array.isArray(raw.assets)||new Set(raw.assets.map(a=>a.assetId)).size!==raw.assets.length||raw.assets.some(a=>!byId.has(a.assetId))||[...requiredIds].some(id=>!raw.assets.some(a=>a.assetId===id)))fail("STATIC_INVENTORY","publication.json");
 const floorPacks=requiredFloorTexturePacks(raw.exhibition),selectedFloorFiles=new Map(floorPacks.flatMap(floorTextureFiles).map(file=>[file.path,file])),knownFloorFiles=new Map(FLOOR_TEXTURE_FILES.map(file=>[file.path,file]));
 const knownSteps=new Map([...FOOTSTEP_SAMPLES,...FOOTSTEP_NOTICES].map(file=>[file.artifactPath,file]));
 const copiedFloorFiles=new Set(),surfaceResources=packageSurfaceMaterialManifest(raw.exhibition),selectedSurfaceFiles=new Map(surfaceResources.map(file=>[file.artifactPath,file])),knownSurfaceFiles=new Map(SURFACE_MATERIAL_FILES.map(file=>[file.artifactPath,file])),copiedSurfaceFiles=new Set();
 // Optional editor choices are independent of the immutable publication's required packs.
 const requiredSurfacePacks=new Set(surfaceResources.map(file=>file.packId));
 const optionalSurfaceFiles=privateEditor?SURFACE_MATERIAL_FILES.filter(file=>!requiredSurfacePacks.has(file.packId)&&SURFACE_MATERIAL_PACKS.some(pack=>pack.id===file.packId&&pack.version===file.packVersion&&pack.license==='CC0-1.0')):[];
 const includedFloorPacks=new Set(floorPacks.map(pack=>pack.id));
 const optionalGroups=[...new Set(optionalSurfaceFiles.map(file=>file.packId))].map(packId=>({files:optionalSurfaceFiles.filter(file=>file.packId===packId)}));
 if(privateEditor)for(const pack of FLOOR_TEXTURE_PACKS){if(pack.license==='CC0-1.0'&&!includedFloorPacks.has(pack.id))optionalGroups.push({floorPack:pack.id,files:floorTextureFiles(pack).map(file=>({...file,artifactPath:file.path}))});}
 const optionalFiles=optionalGroups.flatMap(group=>group.files),requiredPaths=[...surfaceResources.map(file=>file.artifactPath),...selectedFloorFiles.keys()];
 const optionalPaths=new Set(optionalFiles.map(file=>file.artifactPath));
 const optionalAncestors=new Set(optionalFiles.flatMap(file=>{const parts=file.artifactPath.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));}).filter(path=>!requiredPaths.some(file=>file.startsWith(path+'/'))));
 const target=resolve(output),parent=dirname(target);try{await lstat(target);fail("STATIC_OUTPUT_EXISTS",target);}catch(e){if(e.code!=="ENOENT")throw e;}
 const parentStat=await lstat(parent);if(!parentStat.isDirectory()||parentStat.isSymbolicLink())fail("STATIC_OUTPUT_PARENT",parent);
 const temporary=join(parent,`.static-export-${randomUUID()}`);await mkdir(temporary,{mode:0o700});
 const files=new Map(),assetIndex=[],resourceIndex=[];const put=async(path,bytes)=>{if(!safeStaticPath(path)||files.has(path))fail("STATIC_PATH_COLLISION",path);assertStaticBudget(path,bytes.length,files.size);await mkdir(dirname(join(temporary,path)),{recursive:true});await writeFile(join(temporary,path),bytes,{flag:"wx",mode:0o600});files.set(path,{bytes:bytes.length,sha256:sha(bytes)});};
 try{
 for(const asset of raw.assets){const item=byId.get(asset.assetId);if(!item||asset.url!==`/api/v1/publications/${publicationId}/assets/${asset.assetId}`||item.mime!==asset.mime)fail("STATIC_ASSET_URL",asset.url);if(item.bytes>MAX)fail("STATIC_FILE_TOO_LARGE",item.path);
 const response=await request(asset.url);if(response.headers.get("x-exhibitos-publication-revision")!==raw.publication.revisionSha256||response.headers.get("content-type")?.split(";")[0]!==item.mime)fail("STATIC_ASSET_RESPONSE",item.path);
 const data=await bounded(response,Math.min(MAX,item.bytes),item.path);if(data.length!==item.bytes||sha(data)!==item.sha256)fail("STATIC_ASSET_HASH",item.path);
 if(still?.id===item.id)await validateCoverImage(data);
 const path=`data/${item.sha256}.bin`;if(!files.has(path))await put(path,data);assetIndex.push({assetId:asset.assetId,path,bytes:item.bytes,sha256:item.sha256,mime:item.mime});}
 for(const item of stepResources){
  const response=await request(`/api/v1/publications/${publicationId}/resources/${item.sha256}`);
  if(response.headers.get('x-exhibitos-publication-revision')!==raw.publication.revisionSha256||response.headers.get('content-type')?.split(';')[0]!==item.mime.split(';')[0])fail('STATIC_RESOURCE_RESPONSE',item.artifactPath);
  const data=await bounded(response,item.bytes,item.artifactPath);if(data.length!==item.bytes||sha(data)!==item.sha256)fail('STATIC_RESOURCE_HASH',item.artifactPath);
  const path=`data/${item.sha256}.bin`;if(!files.has(path))await put(path,data);resourceIndex.push({path,bytes:item.bytes,sha256:item.sha256,mime:item.mime});
 }
 for(const artwork of raw.exhibition.artworks){const validation=await mkdtemp(join(tmpdir(),"exhibitos-static-validation-"));try{const copy=structuredClone(artwork),preview=artworkThumbnailFor(copy);if(preview&&!raw.assets.some(a=>a.assetId===preview.id)){copy.assets=copy.assets.filter(a=>a.id!==preview.id);delete copy.extensions[ARTWORK_THUMBNAIL_NAMESPACE];}for(const asset of copy.assets){const path=join(validation,asset.path);await mkdir(dirname(path),{recursive:true});await copyFile(join(temporary,`data/${asset.sha256}.bin`),path);}const result=await validateArtworkFiles(copy,validation);if(!result.valid)fail("STATIC_ARTWORK_INVALID",artwork.id);}finally{await rm(validation,{recursive:true,force:true});}}
 const publication={publication:{id:publicationId,revisionSha256:raw.publication.revisionSha256,publishedAt:raw.publication.publishedAt,status:"published"},exhibition:raw.exhibition,assets:raw.assets.map(a=>({assetId:a.assetId,url:a.url,mime:a.mime})),...(stepResources.length?{resources:declared}: {})};
 const p=Buffer.from(JSON.stringify(publication)),pPath=`data/${sha(p)}.json`;await put(pPath,p);
 const index=Buffer.from(JSON.stringify({version:stepResources.length?2:1,publication:{path:pPath,bytes:p.length,sha256:sha(p),mime:"application/json"},assets:assetIndex,...(stepResources.length?{resources:resourceIndex}:{})}));if(index.length>1048576)fail("STATIC_INDEX_SIZE","static-publication-index.json");await put("static-publication-index.json",index);
 // New theme bootstraps use the same compiled React presentation modules as the Viewer.
 // Fixed trusted source-build companion, never code loaded from caller-supplied runtimeRoot.
 const themeShell=raw.exhibition.extensions?.['org.exhibitos.viewer/entrance']?.design?await import('../apps/web/dist-cover-shell/entrance-shell.js').then(m=>m.renderEntranceShell(raw.exhibition)):null;
 const runtime=resolve(runtimeRoot),optionalPacks=[];
 // Retain verified bytes until the entire pack is accepted; never emit a partial choice.
 // Check every ancestor before reading so unavailable optional symlinks are not followed.
 const runtimeStat=await lstat(runtime);if(!runtimeStat.isDirectory()||runtimeStat.isSymbolicLink())fail("STATIC_RUNTIME_DIRECTORY",runtime);
 for(const group of optionalGroups){
  const accepted=[];
  try{
   for(const file of group.files){
    const parts=file.artifactPath.split('/');
    for(let i=1;i<parts.length;i++){const stat=await lstat(join(runtime,...parts.slice(0,i)));if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('OPTIONAL_MATERIAL_DIRECTORY');}
    const path=join(runtime,file.artifactPath),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes)throw Error('OPTIONAL_MATERIAL_FILE');
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
     const held=await handle.stat();if(!held.isFile()||held.size!==file.bytes)throw Error('OPTIONAL_MATERIAL_FILE');
     const bytes=Buffer.alloc(file.bytes+1);let length=0;
     while(length<bytes.length){const {bytesRead}=await handle.read(bytes,length,bytes.length-length,null);if(!bytesRead)break;length+=bytesRead;}
     if(length!==file.bytes||sha(bytes.subarray(0,length))!==file.sha256)throw Error('OPTIONAL_MATERIAL_INTEGRITY');
     accepted.push([file.artifactPath,bytes.subarray(0,length)]);
    }finally{await handle.close();}
   }
   optionalPacks.push(accepted);
   if(group.floorPack)includedFloorPacks.add(group.floorPack);
  }catch{ /* An unavailable optional choice must not block the published exhibition. */ }
 }
 async function walk(dir,prefix=""){const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail("STATIC_RUNTIME_DIRECTORY",prefix||runtime);for(const name of (await readdir(dir)).sort()){const rel=prefix+name;if(!safeStaticPath(rel))fail("STATIC_RUNTIME_PATH",rel);if(optionalPaths.has(rel))continue;const path=join(dir,name),s=await lstat(path);if(optionalAncestors.has(rel)&&(!s.isDirectory()||s.isSymbolicLink()))continue;if(s.isSymbolicLink())fail("STATIC_SYMLINK",rel);if(s.isDirectory())await walk(path,rel+"/");else if(s.isFile()){if(knownSteps.has(rel)){const entry=knownSteps.get(rel);if(s.size!==entry.bytes||sha(await readFile(path))!==entry.sha256)fail('STATIC_RESOURCE_INTEGRITY',rel);continue;}if(knownSurfaceFiles.has(rel)){const descriptor=selectedSurfaceFiles.get(rel);if(!descriptor)continue;if(s.size!==descriptor.bytes)fail("STATIC_MATERIAL_INTEGRITY",rel);const bytes=await readFile(path);if(sha(bytes)!==descriptor.sha256)fail("STATIC_MATERIAL_INTEGRITY",rel);await put(rel,bytes);copiedSurfaceFiles.add(rel);continue;}if(knownFloorFiles.has(rel)){const descriptor=selectedFloorFiles.get(rel);if(!descriptor)continue;if(s.size!==descriptor.bytes)fail("STATIC_FLOOR_INTEGRITY",rel);const bytes=await readFile(path);if(sha(bytes)!==descriptor.sha256)fail("STATIC_FLOOR_INTEGRITY",rel);await put(rel,bytes);copiedFloorFiles.add(rel);continue;}if(rel==="static-studio.html"&&!studioDemo&&!privateEditor)continue;if(!["static.html","static-studio.html","THIRD_PARTY_NOTICES.txt","voice-pcm-worklet.js","viewer-favicon.svg"].includes(rel)&&! /^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(rel))fail("STATIC_RUNTIME_UNLISTED",rel);assertStaticBudget(rel,s.size,files.size);let b=await readFile(path);if(rel==="viewer-favicon.svg"&&sha(b)!=="c2d259310843e6c9f676ef8e3ecde72edf5305a94fb87afcea44b4657d558263")fail("STATIC_RUNTIME_FAVICON",rel);if(rel==="static.html"||rel==="static-studio.html"){if(b.toString().split("STATIC_INDEX_SHA256").length!==2)fail("STATIC_RUNTIME_INDEX",rel);b=Buffer.from(b.toString().replace("STATIC_INDEX_SHA256",sha(index)));if(rel==="static.html"){const artist=raw.exhibition.extensions?.["org.exhibitos.viewer/entrance"]?.artist??"";const coverWork=raw.exhibition.artworks.find(a=>a.assets.some(v=>v.id===raw.exhibition.extensions?.["org.exhibitos.viewer/entrance"]?.imageAssetId));const ratio=coverWork&&coverWork.dimensions.height>0?coverWork.dimensions.width/coverWork.dimensions.height:4/3;const shell=themeShell??staticCoverShell(raw.exhibition.title,artist,raw.exhibition.extensions?.["org.exhibitos.viewer/entrance"]?.introduction??"",Boolean(raw.exhibition.extensions?.["org.exhibitos.viewer/entrance"]?.imageAssetId),raw.exhibition.extensions?.["org.exhibitos.viewer/entrance"]?.presentation?.coverUnfold!==false,ratio);b=Buffer.from(b.toString().replace("<!--STATIC_COVER_SHELL-->",()=>shell).replace(/<title>[^<]*<\/title>/,()=>`<title>${String(raw.exhibition.title).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</title>`));}if(rel==="static.html"&&(studioDemo||privateEditor)){if(!b.toString().includes('<div id="root">'))fail("STATIC_RUNTIME_ENTRY",rel);b=Buffer.from(b.toString().replace('<div id="root">','<nav class="cms-actions" aria-label="샘플 체험"><a href="/studio.html">직접 꾸며보기</a></nav><div id="root">'));}await put(rel==="static.html"?"index.html":"studio.html",b);}else await put(rel,b);}else fail("STATIC_RUNTIME_TYPE",rel);}}await walk(runtime);
 // This optional private library is not part of the publication's UUID inventory.
 // Read only the existing trusted catalogue source, never runtime-supplied GLBs.
 let benchFiles=[];
 if(privateEditor)try{
  const id='backless-oak-bench',entry=furnishingCatalogueEntry(id);
  if(entry.rights.licenseId==='CC0-1.0'){
   const asset=furnishingAsset(publicationId,id),{readFurnishingBytes}=await import('../apps/api/dist/furnishings.js');
   const model=await readFurnishingBytes(asset,'model'),notice=await readFurnishingBytes(asset,'notice');
   benchFiles=[['furnish-catalog/backless-oak-bench/1/model.glb',model],['furnish-catalog/backless-oak-bench/1/LICENSE-NOTICE.txt',notice]];
  }
 }catch{ /* Missing or invalid optional library bytes omit the entire pair. */ }
 // Output collisions and write failures remain fatal after optional source admission.
 for(const [path,bytes] of benchFiles)await put(path,bytes);
 for(const pack of optionalPacks)for(const [path,bytes] of pack)await put(path,bytes);
 if(copiedSurfaceFiles.size!==selectedSurfaceFiles.size)fail("STATIC_MATERIAL_MISSING","surface-material-textures");
 if(copiedFloorFiles.size!==selectedFloorFiles.size)fail("STATIC_FLOOR_MISSING","floor-textures");
 const noticePacks=FLOOR_TEXTURE_PACKS.filter(pack=>includedFloorPacks.has(pack.id));
 if(noticePacks.length)await put("floor-texture-notices.txt",Buffer.from(noticePacks.map(floorTextureNotice).join("\n")));
 if(!files.has("index.html"))fail("STATIC_RUNTIME_ENTRY","static.html");
 if((studioDemo||privateEditor)&&!files.has("studio.html"))fail("STATIC_RUNTIME_ENTRY","static-studio.html");
 // Recheck public status/revision immediately before publication; no draft/withdrawn snapshot is exported.
 const current=JSON.parse((await bounded(await request(`/api/v1/publications/${publicationId}`),1048576,"publication.json")).toString());const membership=assets=>JSON.stringify(assets.map(a=>[a.assetId,a.mime,a.url]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));if(current.publication?.status!=="published"||current.publication?.revisionSha256!==publication.publication.revisionSha256||!Array.isArray(current.assets)||membership(current.assets)!==membership(raw.assets)||JSON.stringify(current.resources??null)!==JSON.stringify(raw.resources??null))fail("STATIC_PUBLICATION_CHANGED",publicationId);
 const manifest=Buffer.from(JSON.stringify({format:"exhibitos-static-publication-v1",publicationId,revisionSha256:publication.publication.revisionSha256,indexSha256:sha(index),files:[...files].map(([path,entry])=>({path,...entry})).sort((a,b)=>a.path.localeCompare(b.path))}));await put("static-export-manifest.json",manifest);
 try{await lstat(target);fail("STATIC_OUTPUT_EXISTS",target);}catch(e){if(e.code!=="ENOENT")throw e;}
 await rename(temporary,target);
 return {publicationId,revisionSha256:publication.publication.revisionSha256,indexSha256:sha(index),manifestSha256:sha(manifest),files:files.size,bytes:[...files.values()].reduce((n,b)=>n+b.bytes,0),output:target};
 }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}

}
/** The demo uses only the existing redistributable fixture; no server or authoring approval is fabricated. */
export async function exportStaticStudioDemo({runtimeRoot,output}){
 const decoded=await readOex(await readFile(fixtureURL("oex/v1/examples/synthetic-media.oex")));
 const id=decoded.exhibition.id;
 if(revisionHash(decoded.exhibition)!==SAMPLE_REVISION)fail("STATIC_DEMO_SAMPLE",id);
 // The reference OEX is unchanged. Give its demo copy an authored, interior start
 // instead of attempting to walk from the stationary overview camera.
 const exhibition=structuredClone(decoded.exhibition);
 exhibition.extensions={...exhibition.extensions,"org.exhibitos.studio/presentation":{
  version:1,startCamera:{roomId:exhibition.rooms[0].id,position:[0,1.6,2],target:[0,1.6,0],fov:60},viewpoints:[],credits:"",
 }};
 const revisionSha256=revisionHash(exhibition);
 if(revisionSha256!==WALKING_SAMPLE_REVISION)fail("STATIC_DEMO_SAMPLE",id);
 const raw={publication:{id,revisionSha256,publishedAt:new Date().toISOString(),status:"published"},exhibition,assets:decoded.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,url:`/api/v1/publications/${id}/assets/${a.id}`}))};
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
