// SPDX-License-Identifier: AGPL-3.0-or-later
// Experimental offline composition only. This entry has no production deployment route.
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,open,readFile,realpath,rename,rm,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readNativeReferenceClosure,sessionHostingOverlay,completeInventory} from './reference-native-closure.mjs';
import {refreshNativeDetailShell} from './refresh-native-detail-shell.mjs';
import {localStaticPublicationSource,assertSamePublicationContent} from './local-static-publication-source.mjs';
const keys=['scope','inputRoot','inventorySha256','webRoot','webInventoryPath','webInventorySha256','webBuildId','webSourceCommit','webSourceTree','outputDir'];
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=()=>{throw Error('REFERENCE_STAGING_INVALID');};
const within=(a,b)=>a===b||a.startsWith(b+sep);

/** The caller owns the output parent and supplies independently reviewed Main
 * staging web pins. The public production closure remains strictly unchanged. */
export async function stageReferenceDemo(request){
 if(!request||typeof request!=='object'||Object.keys(request).length!==keys.length||keys.some(k=>typeof request[k]!=='string'||!request[k])||request.scope!=='experimental-staging-only')fail();
 if(!/^[a-f0-9]{40}$/.test(request.webSourceCommit)||!/^[a-f0-9]{40}$/.test(request.webSourceTree)||!['webInventorySha256','webBuildId'].every(k=>/^[a-f0-9]{64}$/.test(request[k])))fail();
 const target=request.outputDir,parent=dirname(target);
 for(const path of [target,request.inputRoot,request.webRoot,request.webInventoryPath])if(!path.startsWith('/')||resolve(path)!==path)fail();
 if(await realpath(parent)!==parent)fail();const parentStat=await lstat(parent);
 if(!parentStat.isDirectory()||parentStat.uid!==process.getuid?.()||(parentStat.mode&0o022)!==0)fail();
 for(const path of [request.inputRoot,request.webRoot,request.webInventoryPath])if(within(target,path)||within(path,target))fail();
 const lockPath=join(parent,`.${basename(target)}.reference-staging.lock`),lock=await open(lockPath,'wx',0o600);let stage;
 try{
  try{await lstat(target);fail();}catch(e){if(e.code!=='ENOENT')throw e;}
  const source=await readNativeReferenceClosure({inputRoot:request.inputRoot,inventorySha256:request.inventorySha256});
  if(request.webBuildId===source.webBuildId)fail();
  stage=await mkdtemp(join(parent,'.reference-staging-'));const output=join(stage,'output');
  const base={sourceDir:source.sourceRoot,sourceManifestSha256:source.sourceManifestSha256,indexSha256:source.reference.indexSha256,publicationId:source.reference.publicationId,revisionSha256:source.reference.revisionSha256};
  const raw=await refreshNativeDetailShell({...base,webRoot:request.webRoot,webInventoryPath:request.webInventoryPath,webInventorySha256:request.webInventorySha256,webBuildId:request.webBuildId,outputDir:output});
  const local=await localStaticPublicationSource({...base,sourceDir:output,sourceManifestSha256:raw.manifestSha256});
  const manifestBytes=await readFile(join(output,'static-export-manifest.json'));
  if(hash(manifestBytes)!==raw.manifestSha256)fail();
  const sourceEntries=new Map(local.entries);sourceEntries.set('static-export-manifest.json',{path:'static-export-manifest.json',bytes:manifestBytes.length,sha256:raw.manifestSha256});
  const overlay=await sessionHostingOverlay({sourceRoot:output,sourceEntries,index:source.index});
  for(const [path,bytes]of overlay.overlays)await writeFile(join(output,path),bytes,{flag:path==='_headers'?'wx':'w',mode:0o600});
  await completeInventory(output,overlay.entries);
  assertSamePublicationContent(new Map([...source.sourceEntries].filter(([path])=>path!=='static-export-manifest.json')),[...overlay.entries.values()].filter(item=>!['static-export-manifest.json','_headers'].includes(item.path)));
  // Recheck the immutable public closure after use. The refresher independently
  // hashes web inputs as consumed and again before returning its raw artifact.
  await readNativeReferenceClosure({inputRoot:request.inputRoot,inventorySha256:request.inventorySha256});
  const current=await lstat(parent);if(await realpath(parent)!==parent||current.dev!==parentStat.dev||current.ino!==parentStat.ino)fail();
  try{await lstat(target);fail();}catch(e){if(e.code!=='ENOENT')throw e;}
  await rename(output,target);
  const files=[...overlay.entries.values()].map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  return {scope:request.scope,publicationId:source.reference.publicationId,revisionSha256:source.reference.revisionSha256,indexSha256:source.reference.indexSha256,nativeManifestSha256:source.sourceManifestSha256,rawStagingManifestSha256:raw.manifestSha256,manifestSha256:overlay.manifestSha256,hostingMode:'session-v1',viewerSourceCommit:request.webSourceCommit,viewerSourceTree:request.webSourceTree,viewerBuildId:request.webBuildId,webInventorySha256:request.webInventorySha256,inputInventorySha256:request.inventorySha256,cachePolicySha256:hash(overlay.headers),files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),output:target,inventory:files};
 }finally{if(stage)await rm(stage,{recursive:true,force:true});await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{let text='';for await(const part of process.stdin){text+=part;if(Buffer.byteLength(text)>65536)fail();}console.log(JSON.stringify(await stageReferenceDemo(JSON.parse(text))));}
 catch{console.error('REFERENCE_STAGING_FAILED');process.exitCode=1;}
}
