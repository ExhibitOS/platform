// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageReferenceDemo} from './stage-reference-demo.mjs';
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'reference-staging-test-')));
 for(const path of ['input','web','owned'])await mkdir(join(root,path),{mode:0o700});
 return {root,request:{scope:'experimental-staging-only',inputRoot:join(root,'input'),inventorySha256:'a'.repeat(64),webRoot:join(root,'web'),webInventoryPath:join(root,'inventory.json'),webInventorySha256:'b'.repeat(64),webBuildId:'c'.repeat(64),webSourceCommit:'d'.repeat(40),webSourceTree:'e'.repeat(40),outputDir:join(root,'owned','output')}};
}
test('staging requires explicit experimental scope, independent source pins and disjoint canonical output',async()=>{
 const f=await fixture();try{
  for(const change of [{scope:'production'},{webSourceCommit:'main'},{webBuildId:'latest'},{extra:true},{outputDir:join(f.root,'input','output')}])await assert.rejects(stageReferenceDemo({...f.request,...change}),/REFERENCE_STAGING_INVALID/);
  const alias=join(f.root,'alias');await symlink(join(f.root,'owned'),alias);await assert.rejects(stageReferenceDemo({...f.request,outputDir:join(alias,'output')}),/REFERENCE_STAGING_INVALID/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('staging preserves an existing destination and an existing writer lock',async()=>{
 const f=await fixture();try{
  await mkdir(f.request.outputDir);await writeFile(join(f.request.outputDir,'sentinel'),'existing');
  await assert.rejects(stageReferenceDemo(f.request));assert.equal(await readFile(join(f.request.outputDir,'sentinel'),'utf8'),'existing');
  const lock=join(f.root,'owned','.output.reference-staging.lock');await writeFile(lock,'other writer');await assert.rejects(stageReferenceDemo(f.request));assert.equal(await readFile(lock,'utf8'),'other writer');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('unqualified input fails before composition and releases only its own lock',async()=>{
 const f=await fixture();try{
  await assert.rejects(stageReferenceDemo(f.request));assert.deepEqual(await readdir(join(f.root,'owned')),[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
