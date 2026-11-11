// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,mkdtemp,open,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {revisionHash} from '@exhibitos/spec';
import {safeStaticPath,assertStaticBudget} from './export-static-publication.mjs';
import {localStaticPublicationSource,assertSamePublicationContent,retainedPrivateEditor} from './local-static-publication-source.mjs';
import {buildNativeDetailPlan} from './native-detail-plan.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),hex=/^[a-f0-9]{64}$/;
const keys=['sourceDir','sourceManifestSha256','indexSha256','publicationId','revisionSha256','webRoot','webInventoryPath','webInventorySha256','webBuildId','outputDir'];
const exact=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw Error(code);},within=(path,parent)=>path===parent||path.startsWith(parent+sep);
const shell=path=>['static.html','static-studio.html','THIRD_PARTY_NOTICES.txt','viewer-favicon.svg','voice-pcm-worklet.js'].includes(path)||/^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(path);
const outputShell=path=>shell(path)||path==='index.html'||path==='studio.html';

async function regular(root,path,limit,cancelled){
 if(cancelled())fail('REFRESH_CANCELLED');if(!safeStaticPath(path))fail('REFRESH_WEB_INVALID');
 let current=root;for(const part of path.split('/').slice(0,-1)){current=join(current,part);const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('REFRESH_WEB_INVALID');}
 const handle=await open(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)fail('REFRESH_WEB_INVALID');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){if(cancelled())fail('REFRESH_CANCELLED');const read=await handle.read(bytes,offset,Math.min(1024*1024,bytes.length-offset),offset);if(!read.bytesRead)fail('REFRESH_WEB_INVALID');offset+=read.bytesRead;}const after=await handle.stat();if(after.size!==stat.size||after.dev!==stat.dev||after.ino!==stat.ino)fail('REFRESH_WEB_INVALID');return bytes;}finally{await handle.close();}
}

async function webSource(request,cancelled){
 const bytes=await regular(dirname(request.webInventoryPath),basename(request.webInventoryPath),2*1024*1024,cancelled);
 if(hash(bytes)!==request.webInventorySha256)fail('REFRESH_WEB_INVALID');let manifest;try{manifest=JSON.parse(bytes);}catch{fail('REFRESH_WEB_INVALID');}
 if(!exact(manifest,['format','buildId','files'])||manifest.format!=='exhibitos-static-web-input-v1'||manifest.buildId!==request.webBuildId||!Array.isArray(manifest.files)||manifest.files.length>20000)fail('REFRESH_WEB_INVALID');
 let total=0;const entries=new Map();
 for(const item of manifest.files){if(!exact(item,['path','bytes','sha256'])||!safeStaticPath(item.path)||!shell(item.path)||entries.has(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>25*1024*1024||!hex.test(item.sha256))fail('REFRESH_WEB_INVALID');total+=item.bytes;if(total>512*1024*1024)fail('REFRESH_WEB_INVALID');entries.set(item.path,item);}
 if(!entries.has('static.html'))fail('REFRESH_WEB_INVALID');
 const pending=new Set(entries.keys()),directories=new Set([...entries.keys()].flatMap(path=>{const parts=path.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));}));let visited=0;
 async function walk(dir,prefix='',depth=0){if(cancelled())fail('REFRESH_CANCELLED');if(depth>32)fail('REFRESH_WEB_INVALID');for(const item of await readdir(dir,{withFileTypes:true})){if(++visited>40000)fail('REFRESH_WEB_INVALID');const path=prefix+item.name;if(item.isDirectory()){if(!directories.has(path))fail('REFRESH_WEB_INVALID');await walk(join(dir,item.name),path+'/',depth+1);}else if(!item.isFile()||!pending.delete(path))fail('REFRESH_WEB_INVALID');}}
 await walk(request.webRoot);if(pending.size)fail('REFRESH_WEB_INVALID');
 const read=async path=>{const item=entries.get(path);if(!item)fail('REFRESH_WEB_INVALID');const data=await regular(request.webRoot,path,item.bytes,cancelled);if(data.length!==item.bytes||hash(data)!==item.sha256)fail('REFRESH_WEB_INVALID');return data;};
 for(const path of entries.keys())await read(path);
 return {entries,read};
}

export {html as refreshedEntryHtml,outputShell as isRefreshedShellPath};

async function publication(local,request){
 const read=async path=>Buffer.from(await (await local.fetch(local.origin+'/'+path)).arrayBuffer());
 const indexBytes=await read('static-publication-index.json'),index=JSON.parse(indexBytes);
 if(index.version!==4||!Array.isArray(index.detailAssets)||!index.detailAssets.length||!exact(index.publication,['path','bytes','sha256','mime'])||index.publication.path!==`data/${index.publication.sha256}.json`||index.publication.mime!=='application/json')fail('REFRESH_DETAIL_INVALID');
 const rawBytes=await read(index.publication.path);if(rawBytes.length!==index.publication.bytes||hash(rawBytes)!==index.publication.sha256)fail('REFRESH_DETAIL_INVALID');const raw=JSON.parse(rawBytes);
 if(raw.publication?.id!==request.publicationId||raw.publication.status!=='published'||raw.publication.revisionSha256!==request.revisionSha256||revisionHash(raw.exhibition)!==request.revisionSha256||!Array.isArray(raw.detailAssets)||!Array.isArray(index.assets))fail('REFRESH_DETAIL_INVALID');
 const plan=await buildNativeDetailPlan(request.publicationId,raw.exhibition,raw.assets,raw.detailAssets);
 if(plan.entries.length!==index.detailAssets.length)fail('REFRESH_DETAIL_INVALID');
 const ids=new Set();for(const item of index.detailAssets){const entry=plan.entries.find(value=>value.assetId===item.assetId);if(!exact(item,['assetId','path','bytes','sha256','mime'])||!entry||ids.has(item.assetId)||item.path!==`data/${entry.sha256}.bin`||item.bytes!==entry.bytes||item.sha256!==entry.sha256||item.mime!==entry.mime)fail('REFRESH_DETAIL_INVALID');ids.add(item.assetId);const held=local.entries.get(item.path);if(!held||held.bytes!==item.bytes||held.sha256!==item.sha256)fail('REFRESH_DETAIL_INVALID');}
 return {indexBytes,raw,detailSetSha256:plan.detailSetSha256};
}

function html(bytes,oldIndex,indexSha256,buildId,editor,isIndex){
 let text=bytes.toString('utf8');
 const identities=text.match(/<meta name="exhibitos-viewer-build-id" content="[a-f0-9]{64}">/g);
 if(text.split('STATIC_INDEX_SHA256').length!==2||identities?.length!==1||identities[0]!==`<meta name="exhibitos-viewer-build-id" content="${buildId}">`)fail('REFRESH_WEB_BUILD_INVALID');
 text=text.replace('STATIC_INDEX_SHA256',indexSha256);
 if(isIndex){
  const body=oldIndex.match(/<body><div id="root">([\s\S]*)<\/div><\/body>/),title=oldIndex.match(/<title>[^<]*<\/title>/);
  if(!body||!title||text.split('<!--STATIC_COVER_SHELL-->').length!==2||text.match(/<title>[^<]*<\/title>/g)?.length!==1)fail('REFRESH_WEB_INVALID');
  text=text.replace('<!--STATIC_COVER_SHELL-->',()=>body[1]).replace(/<title>[^<]*<\/title>/,()=>title[0]);
  if(editor){if(text.split('</head>').length!==2)fail('REFRESH_WEB_INVALID');text=text.replace('</head>','<meta name="exhibitos-private-editor" content="enabled"></head>');}
 }
 return Buffer.from(text);
}

/** Replace only the qualified web shell of an already exported v4 publication.
 * This copies no private source, creates no approval and calls no API/export.
 * Caller exclusively owns the output parent; all existing content is immutable. */
export async function refreshNativeDetailShell(request,{cancelled=()=>false}={}){
 if(!exact(request,keys)||keys.some(key=>typeof request[key]!=='string'||!request[key])||!['sourceManifestSha256','indexSha256','revisionSha256','webInventorySha256','webBuildId'].every(key=>hex.test(request[key])))fail('REFRESH_REQUEST_INVALID');
 for(const key of ['sourceDir','webRoot','webInventoryPath','outputDir'])if(!request[key].startsWith('/')||resolve(request[key])!==request[key])fail('REFRESH_PATH_INVALID');
 const source=request.sourceDir,web=request.webRoot,output=request.outputDir,parent=dirname(output);
 if(within(source,web)||within(web,source)||within(output,source)||within(source,output)||within(output,web)||within(web,output)||within(request.webInventoryPath,web)||within(request.webInventoryPath,output))fail('REFRESH_PATH_INVALID');
 for(const path of [source,web,parent,request.webInventoryPath])if(await realpath(path)!==path)fail('REFRESH_PATH_INVALID');
 const parentStat=await lstat(parent),webStat=await lstat(web);if(!parentStat.isDirectory()||!webStat.isDirectory()||parentStat.uid!==process.getuid?.()||(parentStat.mode&0o022)!==0)fail('REFRESH_PATH_INVALID');
 try{await lstat(output);fail('REFRESH_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 const local=await localStaticPublicationSource(request,{cancelled}),pinned=await publication(local,request),inputs=await webSource(request,cancelled),editor=retainedPrivateEditor(local.entries);
 if(editor&&!inputs.entries.has('static-studio.html'))fail('REFRESH_WEB_INVALID');
 const oldEntry=local.entries.get('index.html');if(!oldEntry)fail('REFRESH_SOURCE_INVALID');
 const oldBytes=await regular(source,'index.html',oldEntry.bytes,cancelled);
 if(oldBytes.length!==oldEntry.bytes||hash(oldBytes)!==oldEntry.sha256)fail('REFRESH_CONTENT_CHANGED');
 const oldIndex=oldBytes.toString('utf8');
 const stage=await mkdtemp(join(parent,'.exhibitos-shell-refresh-')),candidate=join(stage,'candidate'),files=new Map();let committed=false,total=0;
 const put=async(path,bytes)=>{if(cancelled())fail('REFRESH_CANCELLED');if(!safeStaticPath(path)||files.has(path))fail('REFRESH_CONTENT_CHANGED');assertStaticBudget(path,bytes.length,files.size);total+=bytes.length;if(total>512*1024*1024)fail('REFRESH_CONTENT_CHANGED');await mkdir(dirname(join(candidate,path)),{recursive:true,mode:0o700});await writeFile(join(candidate,path),bytes,{flag:'wx',mode:0o600});files.set(path,{bytes:bytes.length,sha256:hash(bytes)});};
 try{
  await mkdir(candidate,{mode:0o700});
  for(const [path,item] of local.entries)if(!outputShell(path)){const bytes=await regular(source,path,item.bytes,cancelled);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)fail('REFRESH_CONTENT_CHANGED');await put(path,bytes);}
  for(const path of inputs.entries.keys()){
   if(path==='static-studio.html'&&!editor)continue;
   let bytes=await inputs.read(path),target=path;
   if(path==='static.html'||path==='static-studio.html'){bytes=html(bytes,oldIndex,request.indexSha256,request.webBuildId,editor,path==='static.html');target=path==='static.html'?'index.html':'studio.html';}
   if(path==='viewer-favicon.svg'&&hash(bytes)!=='c2d259310843e6c9f676ef8e3ecde72edf5305a94fb87afcea44b4657d558263')fail('REFRESH_WEB_INVALID');
   await put(target,bytes);
  }
  assertSamePublicationContent(local.entries,[...files].map(([path,item])=>({path,...item})));
  if(files.get('static-publication-index.json')?.sha256!==request.indexSha256)fail('REFRESH_CONTENT_CHANGED');
  const manifest=Buffer.from(JSON.stringify({format:'exhibitos-static-publication-v1',publicationId:request.publicationId,revisionSha256:request.revisionSha256,indexSha256:request.indexSha256,files:[...files].map(([path,item])=>({path,...item})).sort((a,b)=>a.path.localeCompare(b.path))}));
  await put('static-export-manifest.json',manifest);
  await localStaticPublicationSource(request,{cancelled});await webSource(request,cancelled);
  const currentParent=await lstat(parent);if(await realpath(parent)!==parent||currentParent.dev!==parentStat.dev||currentParent.ino!==parentStat.ino)fail('REFRESH_PATH_INVALID');
  if(cancelled())fail('REFRESH_CANCELLED');try{await lstat(output);fail('REFRESH_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(candidate,output);committed=true;let stageCleanup='complete';try{await rm(stage,{recursive:true,force:true});}catch{stageCleanup='pending';}
  return {publicationId:request.publicationId,revisionSha256:request.revisionSha256,indexSha256:request.indexSha256,manifestSha256:hash(manifest),files:files.size,bytes:total,output,sourceManifestSha256:request.sourceManifestSha256,webInventorySha256:request.webInventorySha256,webBuildId:request.webBuildId,detailSetSha256:pinned.detailSetSha256,stageStatus:'verified',stageCleanup};
 }finally{if(!committed)await rm(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let cancelled=false;process.on('SIGTERM',()=>{cancelled=true;});process.on('SIGINT',()=>{cancelled=true;});
 try{let data='';for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>65536)fail('REFRESH_REQUEST_INVALID');}console.log(JSON.stringify(await refreshNativeDetailShell(JSON.parse(data),{cancelled:()=>cancelled})));}
 catch(error){console.error(/^REFRESH_[A-Z_]+$/.test(error.message)?error.message:'REFRESH_FAILED');process.exitCode=1;}
}
