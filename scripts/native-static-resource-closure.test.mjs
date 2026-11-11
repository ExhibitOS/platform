// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNativeStaticResources,nativeStaticResourceFiles} from './native-static-resource-closure.mjs';
const source=fileURLToPath(new URL('../apps/web/public',import.meta.url));
test('the repository declared Native export closure verifies all floor, sound, notice and catalogue bytes',async()=>{
 const result=await assertNativeStaticResources(source);assert.equal(result.files.length,43);
 const count=prefix=>result.files.filter(f=>f.path.startsWith(prefix)).length;
 assert.equal(count('floor-textures/'),16);assert.equal(count('footstep-samples/'),13);assert.equal(count('surface-material-textures/'),9);assert.equal(count('surface-material-notices/'),3);assert.equal(count('material-catalogue-thumbnails/'),2);
});
test('a shell-only runtime input is rejected instead of producing a package that cannot export selected floors',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-static-shell-')));try{
  await writeFile(join(root,'static.html'),'<html>qualified shell is not resource closure</html>');
  await assert.rejects(assertNativeStaticResources(root),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('changed bytes and resource path links are rejected without touching the original sources',async()=>{
 const first=(await nativeStaticResourceFiles())[0];
 for(const kind of ['bytes','file-link','ancestor-link','root-link']){
  const root=await realpath(await mkdtemp(join(tmpdir(),'native-static-resource-')));try{
   if(kind==='root-link'){await symlink(source,join(root,'alias'));await assert.rejects(assertNativeStaticResources(join(root,'alias')),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);continue;}
   if(kind==='ancestor-link')await symlink(join(source,'floor-textures'),join(root,'floor-textures'));
   else{await mkdir(dirname(join(root,first.path)),{recursive:true});if(kind==='bytes')await writeFile(join(root,first.path),Buffer.alloc(first.bytes));else await symlink(join(source,first.path),join(root,first.path));}
   await assert.rejects(assertNativeStaticResources(root),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
