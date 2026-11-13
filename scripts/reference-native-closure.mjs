// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdtemp,open,readdir,realpath,rename,rm,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {safeStaticPath} from './export-static-publication.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';
import {refreshNativeDetailShell,refreshedEntryHtml,isRefreshedShellPath} from './refresh-native-detail-shell.mjs';
import {staticCacheHeaders,STATIC_CACHE_POLICY_VERSION} from './static-cache-policy.mjs';
import {parseStaticJson} from '../apps/web/src/static-json.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),hex=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw Error(code);},within=(path,parent)=>path===parent||path.startsWith(parent===sep?parent:parent+sep);
const webPath=path=>['static.html','static-studio.html','THIRD_PARTY_NOTICES.txt','viewer-favicon.svg','voice-pcm-worklet.js'].includes(path)||/^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(path);
const inputPath=path=>path==='web-inventory.json'||path==='closure.json'||path.startsWith('source/')&&safeStaticPath(path.slice(7))||path.startsWith('web/')&&webPath(path.slice(4));

async function canonicalDirectory(path){
 if(typeof path!=='string'||!path.startsWith('/')||resolve(path)!==path||await realpath(path)!==path)fail('REFERENCE_NATIVE_PATH');
 const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())fail('REFERENCE_NATIVE_PATH');return stat;
}
async function regular(root,path,limit){
 if(!safeStaticPath(path))fail('REFERENCE_NATIVE_PATH');let dir=root;
 for(const part of path.split('/').slice(0,-1)){dir=join(dir,part);const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('REFERENCE_NATIVE_PATH');}
 const handle=await open(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)fail('REFERENCE_NATIVE_INTEGRITY');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const item=await handle.read(bytes,offset,Math.min(bytes.length-offset,1024*1024),offset);if(!item.bytesRead)fail('REFERENCE_NATIVE_INTEGRITY');offset+=item.bytesRead;}const after=await handle.stat();if(after.size!==stat.size||after.dev!==stat.dev||after.ino!==stat.ino)fail('REFERENCE_NATIVE_INTEGRITY');return bytes;}finally{await handle.close();}
}
export async function completeInventory(root,entries,extra=[]){
 const pending=new Set([...entries.keys(),...extra]),directories=new Set([...pending].flatMap(path=>{const parts=path.split('/');return parts.slice(0,-1).map((_,index)=>parts.slice(0,index+1).join('/'));}));let visited=0;
 async function walk(dir,prefix='',depth=0){if(depth>32)fail('REFERENCE_NATIVE_INTEGRITY');for(const item of await readdir(dir,{withFileTypes:true})){if(++visited>40000)fail('REFERENCE_NATIVE_INTEGRITY');const path=prefix+item.name;if(item.isDirectory()){if(!directories.has(path))fail('REFERENCE_NATIVE_INTEGRITY');await walk(join(dir,item.name),path+'/',depth+1);}else if(!item.isFile()||!pending.delete(path))fail('REFERENCE_NATIVE_INTEGRITY');}}
 await walk(root);if(pending.size)fail('REFERENCE_NATIVE_INTEGRITY');
 for(const [path,item]of entries){const bytes=await regular(root,path,item.bytes);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)fail('REFERENCE_NATIVE_INTEGRITY');}
}
const template=(bytes,buildId,cover)=>{
 const text=bytes.toString('utf8'),identities=text.match(/<meta name="exhibitos-viewer-build-id" content="[a-f0-9]{64}">/g);
 if(identities?.length!==1||identities[0]!==`<meta name="exhibitos-viewer-build-id" content="${buildId}">`||text.split('STATIC_INDEX_SHA256').length!==2||text.split('</head>').length!==2||text.includes('exhibitos-demo-decoration')||cover&&text.split('<!--STATIC_COVER_SHELL-->').length!==2)fail('REFERENCE_NATIVE_WEB');
};

/** Read only a complete, externally pinned public input bundle. The admitted
 * R97 reference is publication-specific and grants no ordinary import authority. */
export async function readNativeReferenceClosure(input){
 if(!exact(input,['inputRoot','inventorySha256'])||!hex.test(input.inventorySha256??''))fail('REFERENCE_NATIVE_REQUEST');
 const {inputRoot,inventorySha256}=input;await canonicalDirectory(inputRoot);
 const bytes=await regular(inputRoot,'integrity.json',2*1024*1024);if(hash(bytes)!==inventorySha256)fail('REFERENCE_NATIVE_INTEGRITY');const inventory=parseStaticJson(bytes);
 if(!exact(inventory,['format','indexSha256','files'])||inventory.format!=='exhibitos-reference-native-input-v1'||!hex.test(inventory.indexSha256)||!Array.isArray(inventory.files)||![178,179,184,188,189].includes(inventory.files.length))fail('REFERENCE_NATIVE_INTEGRITY');
 const entries=new Map();let total=0;
 for(const item of inventory.files){if(!exact(item,['path','bytes','sha256'])||!safeStaticPath(item.path)||!inputPath(item.path)||entries.has(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>25*1024*1024||!hex.test(item.sha256))fail('REFERENCE_NATIVE_INTEGRITY');total+=item.bytes;if(total>512*1024*1024)fail('REFERENCE_NATIVE_INTEGRITY');entries.set(item.path,item);}
 if(![140,141,146,150,151].includes([...entries.keys()].filter(path=>path.startsWith('source/')).length)||[...entries.keys()].filter(path=>path.startsWith('web/')).length!==36||!entries.has('web-inventory.json')||!entries.has('closure.json'))fail('REFERENCE_NATIVE_INTEGRITY');
 await completeInventory(inputRoot,entries,['integrity.json']);
 const closure=parseStaticJson(await regular(inputRoot,'closure.json',1048576));
 if(!exact(closure,['format','publication','viewer','paths'])||closure.format!=='exhibitos-reference-native-closure-v1'||!exact(closure.publication,['publicationId','revisionSha256','indexSha256','manifestSha256'])||!exact(closure.viewer,['sourceCommit','sourceTree','lockSha256','buildId','inventorySha256'])||!exact(closure.paths,['source','web','webInventory'])||closure.paths.source!=='source'||closure.paths.web!=='web'||closure.paths.webInventory!=='web-inventory.json')fail('REFERENCE_NATIVE_CLOSURE');
 const {R97_REFERENCE,R97_MOBILE_REFERENCE,HAYES_VIEW_INTEREST_REFERENCE,HAYES_MOBILE_REFERENCE,R101_VIEW_INTEREST_REFERENCE,R101_WORLD_CONTINUITY_REFERENCE,R107_WORLD_CONTINUITY_REFERENCE,R107_ENTRY_UI_REFERENCE,R107_MOBILE_SEATING_REFERENCE,R107_SMOOTH_SEAT_FOCUS_REFERENCE,R108_CANNON_SOFTNESS_REFERENCE,R108_SIGHT_LOADING_REFERENCE,R108_SEAT_PATH_FEEDBACK_REFERENCE,R115_MODEL_CATALOGUE_REFERENCE,R115_BOTTOM_LAYOUT_REFERENCE,R115_MIN_HEIGHT_REFERENCE,R115_NESTED_MINIMUM_REFERENCE,R117_PORTAL_REFERENCE,R124_DEPTH_PAIR_REFERENCE,R155_ALL_WALLS_REFERENCE,verifiedQualifiedWheat}=await import('./qualified-wheat-reference.mjs');
 const reference=[R97_REFERENCE,R97_MOBILE_REFERENCE,HAYES_VIEW_INTEREST_REFERENCE,HAYES_MOBILE_REFERENCE,R101_VIEW_INTEREST_REFERENCE,R101_WORLD_CONTINUITY_REFERENCE,R107_WORLD_CONTINUITY_REFERENCE,R107_ENTRY_UI_REFERENCE,R107_MOBILE_SEATING_REFERENCE,R107_SMOOTH_SEAT_FOCUS_REFERENCE,R108_CANNON_SOFTNESS_REFERENCE,R108_SIGHT_LOADING_REFERENCE,R108_SEAT_PATH_FEEDBACK_REFERENCE,R115_MODEL_CATALOGUE_REFERENCE,R115_BOTTOM_LAYOUT_REFERENCE,R115_MIN_HEIGHT_REFERENCE,R115_NESTED_MINIMUM_REFERENCE,R117_PORTAL_REFERENCE,R124_DEPTH_PAIR_REFERENCE,R155_ALL_WALLS_REFERENCE].find(item=>item.viewerBuildId===closure.viewer.buildId&&item.indexSha256===closure.publication.indexSha256);
 if(!reference||inventory.indexSha256!==reference.indexSha256||closure.publication.publicationId!==reference.publicationId||closure.publication.revisionSha256!==reference.revisionSha256||closure.publication.indexSha256!==reference.indexSha256||closure.publication.manifestSha256!==reference.nativeManifestSha256||closure.viewer.sourceCommit!==reference.viewerSourceCommit||closure.viewer.sourceTree!==reference.viewerSourceTree||closure.viewer.lockSha256!==reference.viewerLockSha256||closure.viewer.buildId!==reference.viewerBuildId||closure.viewer.inventorySha256!==reference.viewerInventorySha256)fail('REFERENCE_NATIVE_CLOSURE');
 const nativeFiles=reference.nativeFiles??140;
 if(inventory.files.length!==nativeFiles+38||[...entries.keys()].filter(path=>path.startsWith('source/')).length!==nativeFiles)fail('REFERENCE_NATIVE_INTEGRITY');
 const sourceRoot=join(inputRoot,'source'),webRoot=join(inputRoot,'web'),webInventoryPath=join(inputRoot,'web-inventory.json');
 const sourceManifestSha256=entries.get('source/static-export-manifest.json')?.sha256;if(sourceManifestSha256!==reference.nativeManifestSha256||entries.get('source/static-publication-index.json')?.sha256!==reference.indexSha256||entries.get('web-inventory.json')?.sha256!==reference.viewerInventorySha256)fail('REFERENCE_NATIVE_CLOSURE');
 const request={sourceDir:sourceRoot,sourceManifestSha256,indexSha256:reference.indexSha256,publicationId:reference.publicationId,revisionSha256:reference.revisionSha256};
 const local=await localStaticPublicationSource(request),qualified=await verifiedQualifiedWheat({root:sourceRoot});if(qualified.reference.indexSha256!==reference.indexSha256||local.entries.size!==nativeFiles-1)fail('REFERENCE_NATIVE_SOURCE');
 const sourceEntries=new Map([...entries].filter(([path])=>path.startsWith('source/')).map(([path,item])=>[path.slice(7),{...item,path:path.slice(7)}]));
 for(const [path,item]of local.entries){const listed=sourceEntries.get(path);if(!listed||listed.bytes!==item.bytes||listed.sha256!==item.sha256)fail('REFERENCE_NATIVE_SOURCE');}
 const webInventory=parseStaticJson(await regular(inputRoot,'web-inventory.json',2*1024*1024));
 if(!exact(webInventory,['format','buildId','files'])||webInventory.format!=='exhibitos-static-web-input-v1'||webInventory.buildId!==reference.viewerBuildId||!Array.isArray(webInventory.files)||webInventory.files.length!==36)fail('REFERENCE_NATIVE_WEB');
 const webEntries=new Map();for(const item of webInventory.files){const listed=entries.get('web/'+item?.path);if(!exact(item,['path','bytes','sha256'])||!webPath(item.path)||webEntries.has(item.path)||!listed||item.bytes!==listed.bytes||item.sha256!==listed.sha256)fail('REFERENCE_NATIVE_WEB');webEntries.set(item.path,item);}
 if(!webEntries.has('static.html')||!webEntries.has('static-studio.html'))fail('REFERENCE_NATIVE_WEB');
 template(await regular(webRoot,'static.html',webEntries.get('static.html').bytes),reference.viewerBuildId,true);template(await regular(webRoot,'static-studio.html',webEntries.get('static-studio.html').bytes),reference.viewerBuildId,false);
 const manifest=parseStaticJson(await regular(sourceRoot,'static-export-manifest.json',2*1024*1024)),index=qualified.index,headers=staticCacheHeaders(index,manifest.files);
 if(!headers)fail('REFERENCE_NATIVE_SOURCE');
 return {inputRoot,inventorySha256,indexSha256:reference.indexSha256,closure,reference,sourceRoot,webRoot,webInventoryPath,sourceManifestSha256,webInventorySha256:reference.viewerInventorySha256,webBuildId:reference.viewerBuildId,sourceEntries,headers,index,webEntries};
}

/** Apply only the established public-demo session configuration to reviewed
 * native entry HTML. Native exports retain their ordinary browser-copy mode. */
export async function sessionHostingOverlay(source,read=(path,limit)=>regular(source.sourceRoot,path,limit)){
 const overlays=new Map();
 for(const path of ['index.html','studio.html']){
  const entry=source.sourceEntries.get(path),bytes=await read(path,entry.bytes);
  if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)fail('REFERENCE_NATIVE_INTEGRITY');
  const html=bytes.toString('utf8');
  if(!Buffer.from(html).equals(bytes)||html.includes('exhibitos-demo-decoration')||html.split('</head>').length!==2)fail('REFERENCE_NATIVE_WEB');
  overlays.set(path,Buffer.from(html.replace('</head>','<meta name="exhibitos-demo-decoration" content="session-v1"></head>')));
 }
 const original=source.sourceEntries.get('static-export-manifest.json'),bytes=await read(original.path,original.bytes);
 if(bytes.length!==original.bytes||hash(bytes)!==original.sha256)fail('REFERENCE_NATIVE_INTEGRITY');
 const manifest=parseStaticJson(bytes);
 manifest.files=manifest.files.map(entry=>{const bytes=overlays.get(entry.path);return bytes?{...entry,bytes:bytes.length,sha256:hash(bytes)}:entry;});
 const manifestBytes=Buffer.from(JSON.stringify(manifest));
 overlays.set('static-export-manifest.json',manifestBytes);
 const entries=new Map(source.sourceEntries);
 for(const [path,bytes]of overlays)entries.set(path,{path,bytes:bytes.length,sha256:hash(bytes)});
 const headers=Buffer.from(staticCacheHeaders(source.index,manifest.files));
 overlays.set('_headers',headers);entries.set('_headers',{path:'_headers',bytes:headers.length,sha256:hash(headers)});
 return {overlays,entries,manifestSha256:hash(manifestBytes),headers};
}

/** Derive the exact refreshed native inventory from independently admitted
 * source/web bytes. This shares HTML generation with the guarded refresher and
 * never copies original assets or accepts caller-provided output manifests. */
async function referenceRawShell(source){
 const old=source.sourceEntries.get('index.html'),oldBytes=await regular(source.sourceRoot,'index.html',old.bytes);
 if(oldBytes.length!==old.bytes||hash(oldBytes)!==old.sha256)fail('REFERENCE_NATIVE_INTEGRITY');
 const entries=new Map([...source.sourceEntries].filter(([path])=>path!=='static-export-manifest.json'&&!isRefreshedShellPath(path))),virtual=new Map();
 for(const [path,item]of source.webEntries){
  let bytes=await regular(source.webRoot,path,item.bytes),target=path;
  if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)fail('REFERENCE_NATIVE_INTEGRITY');
  if(path==='static.html'||path==='static-studio.html'){
   bytes=refreshedEntryHtml(bytes,oldBytes.toString('utf8'),source.reference.indexSha256,source.webBuildId,true,path==='static.html');target=path==='static.html'?'index.html':'studio.html';virtual.set(target,bytes);
  }
  entries.set(target,{path:target,bytes:bytes.length,sha256:hash(bytes)});
 }
 const manifest=Buffer.from(JSON.stringify({format:'exhibitos-static-publication-v1',publicationId:source.reference.publicationId,revisionSha256:source.reference.revisionSha256,indexSha256:source.reference.indexSha256,files:[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path))}));
 virtual.set('static-export-manifest.json',manifest);entries.set('static-export-manifest.json',{path:'static-export-manifest.json',bytes:manifest.length,sha256:hash(manifest)});
 const raw={...source,sourceEntries:entries};
 return {source:raw,manifestSha256:hash(manifest),read:async path=>{const bytes=virtual.get(path);if(!bytes)fail('REFERENCE_NATIVE_PATH');return bytes;}};
}

/** Verify exact native content plus the deterministic public-demo session and
 * hosting-control overlays. No caller-provided HTML or manifest is accepted. */
export async function inspectNativeReferenceClosure(input){
 if(!exact(input,['output','inputRoot','inventorySha256']))fail('REFERENCE_NATIVE_REQUEST');
 const {output,inputRoot,inventorySha256}=input;if(typeof output!=='string')fail('REFERENCE_NATIVE_PATH');await canonicalDirectory(output);
 if(within(output,inputRoot)||within(inputRoot,output))fail('REFERENCE_NATIVE_PATH');
 const closure=await readNativeReferenceClosure({inputRoot,inventorySha256}),raw=await referenceRawShell(closure),{entries,manifestSha256,headers}=await sessionHostingOverlay(raw.source,raw.read);
 await completeInventory(output,entries);
 const manifest=await regular(output,'static-export-manifest.json',2*1024*1024);if(hash(manifest)!==manifestSha256)fail('REFERENCE_NATIVE_OUTPUT');
 return {publicationId:closure.reference.publicationId,revisionSha256:closure.reference.revisionSha256,indexSha256:closure.reference.indexSha256,manifestSha256,nativeManifestSha256:closure.reference.nativeManifestSha256,refreshedManifestSha256:raw.manifestSha256,hostingMode:'session-v1',viewerBuildId:closure.webBuildId,viewerSourceCommit:closure.reference.viewerSourceCommit,inventorySha256,rawFiles:closure.sourceEntries.size,files:entries.size,outputFiles:entries.size,bytes:[...entries.values()].reduce((sum,item)=>sum+item.bytes,0),cachePolicy:STATIC_CACHE_POLICY_VERSION,cachePolicySha256:hash(headers)};
}

/** Compose the reviewed native shell deterministically from public inputs.
 * Add only the established Demo session marker and hosting cache headers.
 * No network, web build, original approval, profile or publication export occurs. */
export async function exportNativeReferenceClosure(input){
 if(!exact(input,['inputRoot','inventorySha256','outputDir']))fail('REFERENCE_NATIVE_REQUEST');
 const {inputRoot,inventorySha256,outputDir}=input;if(typeof outputDir!=='string'||!outputDir.startsWith('/')||resolve(outputDir)!==outputDir)fail('REFERENCE_NATIVE_PATH');
 const parent=dirname(outputDir),parentStat=await canonicalDirectory(parent);if(parentStat.uid!==process.getuid?.()||(parentStat.mode&0o022)!==0||within(outputDir,inputRoot)||within(inputRoot,outputDir))fail('REFERENCE_NATIVE_PATH');
 const lockPath=join(parent,`.${basename(outputDir)}.reference-native-closure.lock`),lock=await open(lockPath,'wx',0o600);let stage;
 try{
  try{await lstat(outputDir);fail('REFERENCE_NATIVE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const source=await readNativeReferenceClosure({inputRoot,inventorySha256}),expectedRaw=await referenceRawShell(source);
  stage=await mkdtemp(join(parent,'.reference-native-closure-'));const candidate=join(stage,'output');
  const result=await refreshNativeDetailShell({sourceDir:source.sourceRoot,sourceManifestSha256:source.sourceManifestSha256,indexSha256:source.reference.indexSha256,publicationId:source.reference.publicationId,revisionSha256:source.reference.revisionSha256,webRoot:source.webRoot,webInventoryPath:source.webInventoryPath,webInventorySha256:source.webInventorySha256,webBuildId:source.webBuildId,outputDir:candidate});
  if(result.manifestSha256!==expectedRaw.manifestSha256||result.files!==expectedRaw.source.sourceEntries.size)fail('REFERENCE_NATIVE_OUTPUT');
  const {overlays}=await sessionHostingOverlay(expectedRaw.source,expectedRaw.read);
  for(const [path,bytes]of overlays)await writeFile(join(candidate,path),bytes,{flag:path==='_headers'?'wx':'w',mode:0o600});
  const proof=await inspectNativeReferenceClosure({output:candidate,inputRoot,inventorySha256});
  const currentParent=await canonicalDirectory(parent);if(currentParent.dev!==parentStat.dev||currentParent.ino!==parentStat.ino)fail('REFERENCE_NATIVE_PATH');
  try{await lstat(outputDir);fail('REFERENCE_NATIVE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(candidate,outputDir);return {...proof,output:outputDir};
 }finally{if(stage)await rm(stage,{recursive:true,force:true});await lock.close();await unlink(lockPath);}
}
