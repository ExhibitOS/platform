// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const fail=()=>{throw Error('NATIVE_PACKAGE_STATIC_RESOURCES_INVALID');};
/** These are declared export resources, not the 36-file JS/HTML web shell.
 * Load the built shared catalogue after the packager rebuilds that dependency. */
export async function nativeStaticResourceFiles(){
 const [{FLOOR_TEXTURE_FILES,FLOOR_TEXTURE_PACKS},{FOOTSTEP_SAMPLES,FOOTSTEP_NOTICES},{SURFACE_MATERIAL_FILES,SURFACE_MATERIAL_PACKS}]=await Promise.all([import('@exhibitos/studio-contract'),import('@exhibitos/spec/footstep-resources'),import('@exhibitos/spec/surface-material-resources')]);
 const files=[...FLOOR_TEXTURE_FILES.map(f=>({...f,path:f.path})),...[...FOOTSTEP_SAMPLES,...FOOTSTEP_NOTICES,...SURFACE_MATERIAL_FILES].map(f=>({...f,path:f.artifactPath})),...[...FLOOR_TEXTURE_PACKS,...SURFACE_MATERIAL_PACKS].flatMap(pack=>pack.catalogue?[pack.catalogue.thumbnail]:[])];
 const seen=new Set();return files.map(({path,bytes,sha256})=>{if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(path)||!Number.isSafeInteger(bytes)||bytes<1||bytes>25*1024*1024||!/^[a-f0-9]{64}$/.test(sha256))fail();seen.add(path);return {path,bytes,sha256};}).sort((a,b)=>a.path.localeCompare(b.path));
}
/** Refuse shell-only or altered inputs before producing a Native runtime. */
export async function assertNativeStaticResources(root){
 try{
 if(typeof root!=='string'||!root.startsWith('/')||resolve(root)!==root||await realpath(root)!==root)fail();
 const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
 const files=await nativeStaticResourceFiles();
 for(const file of files){
  let directory=root;for(const part of file.path.split('/').slice(0,-1)){directory=join(directory,part);const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail();}
  let handle;try{
   handle=await open(join(root,file.path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=await handle.stat();if(!stat.isFile()||stat.size!==file.bytes)fail();
   const hash=createHash('sha256');let offset=0;const chunk=Buffer.alloc(Math.min(file.bytes,1024*1024));while(offset<file.bytes){const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,file.bytes-offset),offset);if(!bytesRead)fail();hash.update(chunk.subarray(0,bytesRead));offset+=bytesRead;}
   const after=await handle.stat();if(after.size!==file.bytes||hash.digest('hex')!==file.sha256)fail();
  }catch{fail();}finally{await handle?.close();}
 }
 return {files,bytes:files.reduce((n,f)=>n+f.bytes,0)};
 }catch{fail();}
}
