// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {recognizeNormalOexCatalog,hasWorkspaceMaterialMultimapCapability,WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY,assertExactWorkspaceMaterialMultimapCatalog} from './native-oex-normal-catalog.mjs';
const root=fileURLToPath(new URL('../database/',import.meta.url));
const dir=name=>join(root,name);
const options={workspaceImportDirectory:dir('native-oex-workspace-import'),workspaceWallImportDirectory:dir('native-oex-workspace-import-wall'),workspaceFurnishingDirectory:dir('native-workspace-furnishing'),workspaceFurnishingWriterDirectory:dir('native-workspace-furnishing-writer'),workspaceFurnishingPublicationDirectory:dir('native-workspace-furnishing-publication'),workspaceMaterialPublicationDirectory:dir('native-workspace-material-publication'),workspaceMaterialMultimapDirectory:dir('native-workspace-material-multimap')};
test('040 catalog requires its own exact bytes while 039 remains independently valid',async()=>{
 const base=dir('migrations'),extra=dir('native-oex-normal'),roots=[base,extra,...Object.values(options)],rows=[];
 for(const directory of roots)for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,40);
 const pool={query:async()=>({rows})};
 assert.equal(await recognizeNormalOexCatalog(pool,base,extra,options),extra);await assertExactWorkspaceMaterialMultimapCatalog(pool);
 const old={...options};delete old.workspaceMaterialMultimapDirectory;await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,old),/NATIVE_OEX_CATALOG/);
 rows[39].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,options),/NATIVE_OEX_CATALOG/);await assert.rejects(assertExactWorkspaceMaterialMultimapCatalog(pool),/NATIVE_OEX_CATALOG/);
 rows.pop();assert.equal(await recognizeNormalOexCatalog(pool,base,extra,old),extra);await assert.rejects(assertExactWorkspaceMaterialMultimapCatalog(pool),/NATIVE_OEX_CATALOG/);
});
test('040 capability must have the sealed exact marker bytes',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'exhibitos-multimap-marker-')),path=join(tmp,'marker');try{
  assert.equal(await hasWorkspaceMaterialMultimapCapability(path),false);await writeFile(path,WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY);assert.equal(await hasWorkspaceMaterialMultimapCapability(path),true);await writeFile(path,WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY+' ');await assert.rejects(hasWorkspaceMaterialMultimapCapability(path),/NATIVE_OEX_CATALOG/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('040 packaging is opt-in and rejects selection without the 039 parent',async()=>{
 const {copyNormalOexSelectedFile,writeNormalOexCapability,nativePackageExcludedFiles}=await import('./package-native-runtime.mjs');
 const tmp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-multimap-package-'))),output=join(tmp,'output'),source=await realpath(fileURLToPath(new URL('../',import.meta.url))),tracked=new Map([['database',new Set()]]);
 try{
  await (await import('node:fs/promises')).mkdir(join(output,'scripts'),{recursive:true});
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-workspace-material-multimap/040_workspace_material_multimap.sql'));
  await assert.rejects(copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
  await copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true);
  const selected=await readFile(join(output,'database/native-workspace-material-multimap/040_workspace_material_multimap.sql'));assert.equal(createHash('sha256').update(selected).digest('hex'),'db01d1910ba01a0a2e223829b92f9fbc0e4ce0240c21d3a8ae6b70963a84ef21');
  await writeNormalOexCapability(output,true,true,true,true,true,true,true,true,true);
  assert.equal(await readFile(join(output,'scripts/native-workspace-material-multimap-capability-v1.json'),'utf8'),WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('041 frame preparation requires its exact catalog and sealed capability',async()=>{
 const catalog=await import('./native-oex-normal-catalog.mjs'),base=dir('migrations'),extra=dir('native-oex-normal'),preparation=dir('native-workspace-frame-preparation'),rows=[];
 for(const directory of [base,extra,...Object.values(options),preparation])for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,41);const pool={query:async()=>({rows})},withPreparation={...options,workspaceFramePreparationDirectory:preparation};
 assert.equal(await recognizeNormalOexCatalog(pool,base,extra,withPreparation),extra);await catalog.assertExactWorkspaceFramePreparationCatalog(pool);
 await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,options),/NATIVE_OEX_CATALOG/);rows[40].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,withPreparation),/NATIVE_OEX_CATALOG/);
 const tmp=await mkdtemp(join(tmpdir(),'exhibitos-frame-preparation-marker-')),path=join(tmp,'marker');try{assert.equal(await catalog.hasWorkspaceFramePreparationCapability(path),false);await writeFile(path,catalog.WORKSPACE_FRAME_PREPARATION_CAPABILITY);assert.equal(await catalog.hasWorkspaceFramePreparationCapability(path),true);await writeFile(path,catalog.WORKSPACE_FRAME_PREPARATION_CAPABILITY+' ');await assert.rejects(catalog.hasWorkspaceFramePreparationCapability(path),/NATIVE_OEX_CATALOG/);}finally{await rm(tmp,{recursive:true,force:true});}
});

test('041 packaging requires its parent and selects the exact SQL separately',async()=>{
 const {copyNormalOexSelectedFile,nativePackageExcludedFiles,packageNativeRuntime}=await import('./package-native-runtime.mjs');
 const tmp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-frame-preparation-package-'))),output=join(tmp,'output'),source=await realpath(fileURLToPath(new URL('../',import.meta.url))),tracked=new Map([['database',new Set()]]);
 try{
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-workspace-frame-preparation/041_workspace_frame_preparation.sql'));
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{workspaceArtworkFramePreparationSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
  await copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true);
  const bytes=await readFile(join(output,'database/native-workspace-frame-preparation/041_workspace_frame_preparation.sql'));assert.equal(createHash('sha256').update(bytes).digest('hex'),'c5a030186557dc4774aa0d2a677be7f432c1010e2ee1c1a34345f69ac7e2723d');
 }finally{await rm(tmp,{recursive:true,force:true});}
});
