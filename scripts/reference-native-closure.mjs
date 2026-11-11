// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdtemp,open,readdir,realpath,rename,rm,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {safeStaticPath} from './export-static-publication.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';
import {refreshNativeDetailShell} from './refresh-native-detail-shell.mjs';
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
async function completeInventory(root,entries,extra=[]){
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
 if(!exact(inventory,['format','indexSha256','files'])||inventory.format!=='exhibitos-reference-native-input-v1'||!hex.test(inventory.indexSha256)||!Array.isArray(inventory.files)||inventory.files.length!==178)fail('REFERENCE_NATIVE_INTEGRITY');
 const entries=new Map();let total=0;
 for(const item of inventory.files){if(!exact(item,['path','bytes','sha256'])||!safeStaticPath(item.path)||!inputPath(item.path)||entries.has(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>25*1024*1024||!hex.test(item.sha256))fail('REFERENCE_NATIVE_INTEGRITY');total+=item.bytes;if(total>512*1024*1024)fail('REFERENCE_NATIVE_INTEGRITY');entries.set(item.path,item);}
 if([...entries.keys()].filter(path=>path.startsWith('source/')).length!==140||[...entries.keys()].filter(path=>path.startsWith('web/')).length!==36||!entries.has('web-inventory.json')||!entries.has('closure.json'))fail('REFERENCE_NATIVE_INTEGRITY');
 await completeInventory(inputRoot,entries,['integrity.json']);
 const closure=parseStaticJson(await regular(inputRoot,'closure.json',1048576));
 if(!exact(closure,['format','publication','viewer','paths'])||closure.format!=='exhibitos-reference-native-closure-v1'||!exact(closure.publication,['publicationId','revisionSha256','indexSha256','manifestSha256'])||!exact(closure.viewer,['sourceCommit','sourceTree','lockSha256','buildId','inventorySha256'])||!exact(closure.paths,['source','web','webInventory'])||closure.paths.source!=='source'||closure.paths.web!=='web'||closure.paths.webInventory!=='web-inventory.json')fail('REFERENCE_NATIVE_CLOSURE');
 const {R97_REFERENCE:reference,verifiedQualifiedWheat}=await import('./qualified-wheat-reference.mjs');
 if(!reference||inventory.indexSha256!==reference.indexSha256||closure.publication.publicationId!==reference.publicationId||closure.publication.revisionSha256!==reference.revisionSha256||closure.publication.indexSha256!==reference.indexSha256||closure.publication.manifestSha256!==reference.nativeManifestSha256||closure.viewer.sourceCommit!==reference.viewerSourceCommit||closure.viewer.sourceTree!==reference.viewerSourceTree||closure.viewer.lockSha256!==reference.viewerLockSha256||closure.viewer.buildId!==reference.viewerBuildId||closure.viewer.inventorySha256!==reference.viewerInventorySha256)fail('REFERENCE_NATIVE_CLOSURE');
 const sourceRoot=join(inputRoot,'source'),webRoot=join(inputRoot,'web'),webInventoryPath=join(inputRoot,'web-inventory.json');
 const sourceManifestSha256=entries.get('source/static-export-manifest.json')?.sha256;if(sourceManifestSha256!==reference.nativeManifestSha256||entries.get('source/static-publication-index.json')?.sha256!==reference.indexSha256||entries.get('web-inventory.json')?.sha256!==reference.viewerInventorySha256)fail('REFERENCE_NATIVE_CLOSURE');
 const request={sourceDir:sourceRoot,sourceManifestSha256,indexSha256:reference.indexSha256,publicationId:reference.publicationId,revisionSha256:reference.revisionSha256};
 const local=await localStaticPublicationSource(request),qualified=await verifiedQualifiedWheat({root:sourceRoot});if(qualified.reference!==reference||local.entries.size!==139)fail('REFERENCE_NATIVE_SOURCE');
 const sourceEntries=new Map([...entries].filter(([path])=>path.startsWith('source/')).map(([path,item])=>[path.slice(7),{...item,path:path.slice(7)}]));
 for(const [path,item]of local.entries){const listed=sourceEntries.get(path);if(!listed||listed.bytes!==item.bytes||listed.sha256!==item.sha256)fail('REFERENCE_NATIVE_SOURCE');}
 const webInventory=parseStaticJson(await regular(inputRoot,'web-inventory.json',2*1024*1024));
 if(!exact(webInventory,['format','buildId','files'])||webInventory.format!=='exhibitos-static-web-input-v1'||webInventory.buildId!==reference.viewerBuildId||!Array.isArray(webInventory.files)||webInventory.files.length!==36)fail('REFERENCE_NATIVE_WEB');
 const webEntries=new Map();for(const item of webInventory.files){const listed=entries.get('web/'+item?.path);if(!exact(item,['path','bytes','sha256'])||!webPath(item.path)||webEntries.has(item.path)||!listed||item.bytes!==listed.bytes||item.sha256!==listed.sha256)fail('REFERENCE_NATIVE_WEB');webEntries.set(item.path,item);}
 if(!webEntries.has('static.html')||!webEntries.has('static-studio.html'))fail('REFERENCE_NATIVE_WEB');
 template(await regular(webRoot,'static.html',webEntries.get('static.html').bytes),reference.viewerBuildId,true);template(await regular(webRoot,'static-studio.html',webEntries.get('static-studio.html').bytes),reference.viewerBuildId,false);
 const manifest=parseStaticJson(await regular(sourceRoot,'static-export-manifest.json',2*1024*1024)),index=qualified.index,headers=staticCacheHeaders(index,manifest.files);
 if(!headers)fail('REFERENCE_NATIVE_SOURCE');
 return {inputRoot,inventorySha256,indexSha256:reference.indexSha256,closure,reference,sourceRoot,webRoot,webInventoryPath,sourceManifestSha256,webInventorySha256:reference.viewerInventorySha256,webBuildId:reference.viewerBuildId,sourceEntries,headers};
}

/** Verify all raw R97 bytes and the separate trusted hosting-control overlay. */
export async function inspectNativeReferenceClosure(input){
 if(!exact(input,['output','inputRoot','inventorySha256']))fail('REFERENCE_NATIVE_REQUEST');
 const {output,inputRoot,inventorySha256}=input;if(typeof output!=='string')fail('REFERENCE_NATIVE_PATH');await canonicalDirectory(output);
 if(within(output,inputRoot)||within(inputRoot,output))fail('REFERENCE_NATIVE_PATH');
 const closure=await readNativeReferenceClosure({inputRoot,inventorySha256}),entries=new Map(closure.sourceEntries),headers=Buffer.from(closure.headers);entries.set('_headers',{path:'_headers',bytes:headers.length,sha256:hash(headers)});
 await completeInventory(output,entries);
 const manifest=await regular(output,'static-export-manifest.json',2*1024*1024);if(hash(manifest)!==closure.reference.nativeManifestSha256)fail('REFERENCE_NATIVE_OUTPUT');
 return {publicationId:closure.reference.publicationId,revisionSha256:closure.reference.revisionSha256,indexSha256:closure.reference.indexSha256,manifestSha256:closure.reference.nativeManifestSha256,viewerBuildId:closure.webBuildId,viewerSourceCommit:closure.reference.viewerSourceCommit,inventorySha256,rawFiles:140,files:141,outputFiles:141,bytes:[...entries.values()].reduce((sum,item)=>sum+item.bytes,0),cachePolicy:STATIC_CACHE_POLICY_VERSION,cachePolicySha256:hash(headers)};
}

/** Compose the reviewed native shell deterministically from public inputs. No
 * network, web build, original approval, profile or publication export occurs. */
export async function exportNativeReferenceClosure(input){
 if(!exact(input,['inputRoot','inventorySha256','outputDir']))fail('REFERENCE_NATIVE_REQUEST');
 const {inputRoot,inventorySha256,outputDir}=input;if(typeof outputDir!=='string'||!outputDir.startsWith('/')||resolve(outputDir)!==outputDir)fail('REFERENCE_NATIVE_PATH');
 const parent=dirname(outputDir),parentStat=await canonicalDirectory(parent);if(parentStat.uid!==process.getuid?.()||(parentStat.mode&0o022)!==0||within(outputDir,inputRoot)||within(inputRoot,outputDir))fail('REFERENCE_NATIVE_PATH');
 const lockPath=join(parent,`.${basename(outputDir)}.reference-native-closure.lock`),lock=await open(lockPath,'wx',0o600);let stage;
 try{
  try{await lstat(outputDir);fail('REFERENCE_NATIVE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const source=await readNativeReferenceClosure({inputRoot,inventorySha256});
  stage=await mkdtemp(join(parent,'.reference-native-closure-'));const candidate=join(stage,'output');
  const result=await refreshNativeDetailShell({sourceDir:source.sourceRoot,sourceManifestSha256:source.sourceManifestSha256,indexSha256:source.reference.indexSha256,publicationId:source.reference.publicationId,revisionSha256:source.reference.revisionSha256,webRoot:source.webRoot,webInventoryPath:source.webInventoryPath,webInventorySha256:source.webInventorySha256,webBuildId:source.webBuildId,outputDir:candidate});
  if(result.manifestSha256!==source.reference.nativeManifestSha256||result.files!==140)fail('REFERENCE_NATIVE_OUTPUT');
  await writeFile(join(candidate,'_headers'),source.headers,{flag:'wx',mode:0o600});
  const proof=await inspectNativeReferenceClosure({output:candidate,inputRoot,inventorySha256});
  const currentParent=await canonicalDirectory(parent);if(currentParent.dev!==parentStat.dev||currentParent.ino!==parentStat.ino)fail('REFERENCE_NATIVE_PATH');
  try{await lstat(outputDir);fail('REFERENCE_NATIVE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(candidate,outputDir);return {...proof,output:outputDir};
 }finally{if(stage)await rm(stage,{recursive:true,force:true});await lock.close();await unlink(lockPath);}
}
