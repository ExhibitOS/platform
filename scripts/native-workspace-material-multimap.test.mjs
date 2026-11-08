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

test('portal marker is exact and requires the fixed models parent for packaging',async()=>{
 const catalog=await import('./native-oex-normal-catalog.mjs'),{packageNativeRuntime}=await import('./package-native-runtime.mjs'),tmp=await mkdtemp(join(tmpdir(),'exhibitos-portal-marker-')),path=join(tmp,'marker');
 try{assert.equal(await catalog.hasWorkspacePortalFinishCapability(path),false);await writeFile(path,catalog.WORKSPACE_PORTAL_FINISH_CAPABILITY);assert.equal(await catalog.hasWorkspacePortalFinishCapability(path),true);const marker=JSON.parse(catalog.WORKSPACE_PORTAL_FINISH_CAPABILITY);assert.equal(marker.parentCapabilitySHA256,createHash('sha256').update(catalog.WORKSPACE_FURNISHING_ARTWORK_FRAME_MODELS_CAPABILITY).digest('hex'));await writeFile(path,catalog.WORKSPACE_PORTAL_FINISH_CAPABILITY+' ');await assert.rejects(catalog.hasWorkspacePortalFinishCapability(path),/NATIVE_OEX_CATALOG/);await assert.rejects(packageNativeRuntime('/synthetic-unused',{workspacePortalFinishSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);}finally{await rm(tmp,{recursive:true,force:true});}
});

test('042 is selected explicitly and binds the exact parent and SQL',async()=>{
 const catalog=await import('./native-oex-normal-catalog.mjs'),base=dir('migrations'),extra=dir('native-oex-normal'),preparation=dir('native-workspace-frame-preparation'),hayes=dir('native-hayes-original'),rows=[];
 for(const directory of [base,extra,...Object.values(options),preparation,hayes])for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,42);const pool={query:async()=>({rows})},selected={...options,workspaceFramePreparationDirectory:preparation,hayesOriginalDirectory:hayes};
 assert.equal(await recognizeNormalOexCatalog(pool,base,extra,selected),extra);await catalog.assertExactHayesOriginalCatalog(pool);
 await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,{...selected,hayesOriginalDirectory:undefined}),/NATIVE_OEX_CATALOG/);
 rows[41].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,selected),/NATIVE_OEX_CATALOG/);
 const tmp=await mkdtemp(join(tmpdir(),'exhibitos-hayes-marker-')),path=join(tmp,'marker');try{assert.equal(await catalog.hasHayesOriginalCapability(path),false);await writeFile(path,catalog.HAYES_ORIGINAL_CAPABILITY);assert.equal(await catalog.hasHayesOriginalCapability(path),true);await writeFile(path,catalog.HAYES_ORIGINAL_CAPABILITY+' ');await assert.rejects(catalog.hasHayesOriginalCapability(path),/NATIVE_OEX_CATALOG/);}finally{await rm(tmp,{recursive:true,force:true});}
});

test('042 SQL is excluded by default and included only with its selected parent',async()=>{
 const {copyNormalOexSelectedFile,nativePackageExcludedFiles,packageNativeRuntime}=await import('./package-native-runtime.mjs');
 const tmp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-hayes-package-'))),output=join(tmp,'output'),source=await realpath(fileURLToPath(new URL('../',import.meta.url))),tracked=new Map([['database',new Set()]]);
 try{
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-hayes-original/042_hayes_original_attempt.sql'));
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{hayesOriginalSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
  await copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true,true);
  const bytes=await readFile(join(output,'database/native-hayes-original/042_hayes_original_attempt.sql'));assert.equal(createHash('sha256').update(bytes).digest('hex'),'074de4171572039f2f400d49d07aff8a3ec83ec222c1684cbc5452c6cc8b3ece');
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('042 backup catalog requires the exact selected migration',async()=>{
 const {inventorySnapshotOptionsForDatabase}=await import('./service-backup.mjs'),base=dir('migrations'),extra=dir('native-oex-normal'),preparation=dir('native-workspace-frame-preparation'),hayes=dir('native-hayes-original'),rows=[];
 for(const directory of [base,extra,...Object.values(options),preparation,hayes])for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));const pool={query:async()=>({rows})};assert.deepEqual(await inventorySnapshotOptionsForDatabase(pool,base,extra,rows),{migrationCatalog:rows});
 rows[41].sha256='0'.repeat(64);await assert.rejects(inventorySnapshotOptionsForDatabase(pool,base,extra),/NATIVE_OEX_CATALOG/);
});

test('043 selection pins parent, catalog and packaging without enabling defaults',async()=>{
 const catalog=await import('./native-oex-normal-catalog.mjs'),{copyNormalOexSelectedFile,nativePackageExcludedFiles,packageNativeRuntime}=await import('./package-native-runtime.mjs');
 const base=dir('migrations'),extra=dir('native-oex-normal'),preparation=dir('native-workspace-frame-preparation'),original=dir('native-hayes-original'),disposition=dir('native-hayes-disposition'),rows=[];
 for(const directory of [base,extra,...Object.values(options),preparation,original,disposition])for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,43);const pool={query:async()=>({rows})},selected={...options,workspaceFramePreparationDirectory:preparation,hayesOriginalDirectory:original,hayesDispositionDirectory:disposition};
 assert.equal(await recognizeNormalOexCatalog(pool,base,extra,selected),extra);await catalog.assertExactHayesDispositionCatalog(pool);
 const {inventorySnapshotOptionsForDatabase}=await import('./service-backup.mjs');assert.deepEqual(await inventorySnapshotOptionsForDatabase(pool,base,extra,rows),{migrationCatalog:rows});
 await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,{...selected,hayesDispositionDirectory:undefined}),/NATIVE_OEX_CATALOG/);
 assert.equal(JSON.parse(catalog.HAYES_DISPOSITION_CAPABILITY).parentCapabilitySHA256,createHash('sha256').update(catalog.HAYES_ORIGINAL_CAPABILITY).digest('hex'));
 const tmp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-hayes-043-'))),path=join(tmp,'marker'),output=join(tmp,'output'),source=await realpath(fileURLToPath(new URL('../',import.meta.url))),tracked=new Map([['database',new Set()]]);
 try{
  assert.equal(await catalog.hasHayesDispositionCapability(path),false);await writeFile(path,catalog.HAYES_DISPOSITION_CAPABILITY);assert.equal(await catalog.hasHayesDispositionCapability(path),true);await writeFile(path,catalog.HAYES_DISPOSITION_CAPABILITY+' ');await assert.rejects(catalog.hasHayesDispositionCapability(path),/NATIVE_OEX_CATALOG/);
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-hayes-disposition/043_hayes_output_stage.sql'));
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-hayes-release/044_hayes_native_release.sql'));
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{hayesDispositionSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{hayesDispositionProbeSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{normalOexSelected:true,workspaceMaterialSelected:true,workspaceImportSelected:true,workspaceWallImportSelected:true,workspaceFurnishingSelected:true,workspaceFurnishingWriterSelected:true,workspaceFurnishingPublicationSelected:true,workspaceMaterialPublicationSelected:true,workspaceMaterialMultimapSelected:true,workspaceFurnishingStoolSelected:true,workspaceFurnishingRoomVisualSelected:true,workspaceFurnishingArtworkFrameSelected:true,workspaceFurnishingArtworkFrameModelsSelected:true,workspaceArtworkFramePreparationSelected:true,hayesOriginalSelected:true,hayesDispositionSelected:true,hayesDispositionProbeSelected:true,hayesSessionProbeSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
  await copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true,true,true);
  assert.equal(createHash('sha256').update(await readFile(join(output,'database/native-hayes-disposition/043_hayes_output_stage.sql'))).digest('hex'),catalog.HAYES_DISPOSITION_SHA256);
  rows[42].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,selected),/NATIVE_OEX_CATALOG/);await assert.rejects(inventorySnapshotOptionsForDatabase(pool,base,extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('044 requires the exact selected parent, migration and backup catalog',async()=>{
 const catalog=await import('./native-oex-normal-catalog.mjs'),{copyNormalOexSelectedFile,nativePackageExcludedFiles,packageNativeRuntime}=await import('./package-native-runtime.mjs'),{inventorySnapshotOptionsForDatabase}=await import('./service-backup.mjs');
 const base=dir('migrations'),extra=dir('native-oex-normal'),preparation=dir('native-workspace-frame-preparation'),original=dir('native-hayes-original'),disposition=dir('native-hayes-disposition'),release=dir('native-hayes-release'),rows=[];
 for(const directory of [base,extra,...Object.values(options),preparation,original,disposition,release])for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())rows.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
 rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,44);const pool={query:async()=>({rows})},selected={...options,workspaceFramePreparationDirectory:preparation,hayesOriginalDirectory:original,hayesDispositionDirectory:disposition,hayesReleaseDirectory:release};
 assert.equal(await recognizeNormalOexCatalog(pool,base,extra,selected),extra);await catalog.assertExactHayesReleaseCatalog(pool);assert.deepEqual(await inventorySnapshotOptionsForDatabase(pool,base,extra,rows),{migrationCatalog:rows});
 await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,{...selected,hayesReleaseDirectory:undefined}),/NATIVE_OEX_CATALOG/);assert.equal(JSON.parse(catalog.HAYES_RELEASE_CAPABILITY).parentCapabilitySHA256,createHash('sha256').update(catalog.HAYES_DISPOSITION_CAPABILITY).digest('hex'));
 const tmp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-hayes-044-'))),path=join(tmp,'marker'),output=join(tmp,'output'),source=await realpath(fileURLToPath(new URL('../',import.meta.url))),tracked=new Map([['database',new Set()]]);
 try{
  assert.equal(await catalog.hasHayesReleaseCapability(path),false);await writeFile(path,catalog.HAYES_RELEASE_CAPABILITY);assert.equal(await catalog.hasHayesReleaseCapability(path),true);await writeFile(path,catalog.HAYES_RELEASE_CAPABILITY+' ');await assert.rejects(catalog.hasHayesReleaseCapability(path),/NATIVE_OEX_CATALOG/);
  assert.ok(nativePackageExcludedFiles(false,true).has('database/native-hayes-release/044_hayes_native_release.sql'));await assert.rejects(packageNativeRuntime('/synthetic-unused',{hayesReleaseSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{hayesReleaseProbeSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(packageNativeRuntime('/synthetic-unused',{normalOexSelected:true,workspaceMaterialSelected:true,workspaceImportSelected:true,workspaceWallImportSelected:true,workspaceFurnishingSelected:true,workspaceFurnishingWriterSelected:true,workspaceFurnishingPublicationSelected:true,workspaceMaterialPublicationSelected:true,workspaceMaterialMultimapSelected:true,workspaceFurnishingStoolSelected:true,workspaceFurnishingRoomVisualSelected:true,workspaceFurnishingArtworkFrameSelected:true,workspaceFurnishingArtworkFrameModelsSelected:true,workspaceArtworkFramePreparationSelected:true,hayesOriginalSelected:true,hayesDispositionSelected:true,hayesReleaseSelected:true,hayesReleaseProbeSelected:true,hayesDispositionProbeSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
  await assert.rejects(copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
  await copyNormalOexSelectedFile(source,output,tracked,true,true,true,true,true,true,true,true,true,true,true,true,true);
  assert.equal(createHash('sha256').update(await readFile(join(output,'database/native-hayes-release/044_hayes_native_release.sql'))).digest('hex'),catalog.HAYES_RELEASE_SHA256);
  rows[43].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(pool,base,extra,selected),/NATIVE_OEX_CATALOG/);await assert.rejects(inventorySnapshotOptionsForDatabase(pool,base,extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
