// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,symlink,realpath,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {copyFreshOexValidationFiles,copyNormalOexSelectedFile,writeNormalOexCapability} from './package-native-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const spec='vendor/exhibitos-spec-0.1.0-draft.11-7b06dae895ea.tgz',migration='database/fresh-oex-test/026_oex_bounded.sql',normal='database/native-oex-normal/026_oex_file_profile.sql';
async function fixture(){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-oex-package-'))),source=join(temp,'source'),output=join(temp,'output');await mkdir(source);await mkdir(output);
 for(const name of [spec,migration,normal]){await mkdir(dirname(join(source,name)),{recursive:true});await copyFile(join(root,name),join(source,name));}
 await writeFile(join(source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':`file:${spec}`}}}}));
 return {temp,source,output,tracked:new Map([['database',new Set()],['vendor',new Set()]])};
}
test('includes locked spec in both modes and test migration only when explicitly requested',async()=>{
 const f=await fixture();try{
  await copyFreshOexValidationFiles(f.source,f.output,f.tracked,false);assert.deepEqual(await readFile(join(f.output,spec)),await readFile(join(f.source,spec)));await assert.rejects(readFile(join(f.output,migration)),{code:'ENOENT'});
  await mkdir(join(f.temp,'second'));await copyFreshOexValidationFiles(f.source,join(f.temp,'second'),f.tracked,true);assert.deepEqual(await readFile(join(f.temp,'second',migration)),await readFile(join(f.source,migration)));
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('rejects changed or symlinked input and verifies already-copied tracked output',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.source,migration),'changed');await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
  await rm(join(f.source,spec));await symlink(join(root,spec),join(f.source,spec));await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,false),/NATIVE_PACKAGE_INPUT_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
 const g=await fixture();try{await mkdir(join(g.output,'vendor'));await writeFile(join(g.output,spec),'bad');g.tracked.get('vendor').add(spec);await assert.rejects(copyFreshOexValidationFiles(g.source,g.output,g.tracked,false),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(g.temp,{recursive:true,force:true});}
});

test('accepts already-copied tracked inputs only after checking their exact bytes',async()=>{
 const f=await fixture();try{
  for(const path of [spec,migration]){await mkdir(dirname(join(f.output,path)),{recursive:true});await copyFile(join(f.source,path),join(f.output,path));f.tracked.get(path.split('/')[0]).add(path);}
  await copyFreshOexValidationFiles(f.source,f.output,f.tracked,true);
  await writeFile(join(f.output,migration),'changed');await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});

test('includes the exact normal selected migration only with explicit opt-in',async()=>{const f=await fixture();try{await copyNormalOexSelectedFile(f.source,f.output,f.tracked,false);await assert.rejects(readFile(join(f.output,normal)),{code:'ENOENT'});await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true);assert.deepEqual(await readFile(join(f.output,normal)),await readFile(join(f.source,normal)));await writeFile(join(f.source,normal),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('normal selected payload requires the pinned OEX spec',async()=>{const f=await fixture();try{await writeFile(join(f.source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':'different'}}}}));await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,false,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('selected capability has exact sealed bytes, is absent by default and refuses replacement',async()=>{const f=await fixture();try{
 const path=join(f.output,'scripts/native-normal-oex-capability-v1.json');await mkdir(dirname(path));
 await writeNormalOexCapability(f.output,false);await assert.rejects(readFile(path),{code:'ENOENT'});
 await writeNormalOexCapability(f.output,true);
 assert.equal(await readFile(path,'utf8'),'{"format":1,"kind":"exhibitos-native-normal-oex","protocol":"normal-oex-v1","ownerChannelVersion":2,"schemaPath":"platform/database/native-oex-normal/026_oex_file_profile.sql","schemaSHA256":"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112","archiveFormat":"1.0.0-draft.9","maxArchiveBytes":536870912,"oneShot":true}');
 const stat=await lstat(path);assert.ok(stat.isFile());assert.equal(stat.mode & 0o111,0);
 await assert.rejects(writeNormalOexCapability(f.output,true),{code:'EEXIST'});
 }finally{await rm(f.temp,{recursive:true,force:true});}});
