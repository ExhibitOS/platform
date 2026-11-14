// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,symlink,realpath,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {packageNativeRuntime,copyFreshOexValidationFiles,copyNormalOexSelectedFile,writeNormalOexCapability,nativePackageExcludedFiles} from './package-native-runtime.mjs';
import {WORKSPACE_MATERIAL_CAPABILITY,WORKSPACE_IMPORT_CAPABILITY,WORKSPACE_FURNISHING_CAPABILITY,WORKSPACE_FURNISHING_WRITER_CAPABILITY,WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY,hasWorkspaceFurnishingPublicationCapability,hasWorkspaceMaterialCapability,hasWorkspaceFurnishingCapability,hasWorkspaceFurnishingWriterCapability,verifyWorkspaceMaterialMigrations} from './native-oex-normal-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const spec='vendor/exhibitos-spec-0.1.0-draft.35.tgz',migration='database/fresh-oex-test/026_oex_bounded.sql',normal='database/native-oex-normal/026_oex_file_profile.sql',provenance='database/native-oex-normal/027_oex_exhibition_provenance.sql',material='database/native-oex-normal/028_oex_material_catalogue.sql',floor='database/native-oex-normal/029_oex_quiet_oak_floor.sql',concrete='database/native-oex-normal/030_oex_concrete_surface.sql';
const materialPublication='database/native-workspace-material-publication/039_workspace_material_publication.sql';
const intake='database/native-oex-normal/031_workspace_material.sql',workspaceOex='database/native-oex-normal/032_oex_workspace_material.sql',stage='database/native-oex-workspace-import/033_workspace_material_import_provenance.sql',proof='database/native-oex-workspace-import/034_workspace_material_terminal_proof.sql',wall='database/native-oex-workspace-import-wall/035_workspace_material_wall_import.sql',furnishing='database/native-workspace-furnishing/036_workspace_furnishing.sql',writer='database/native-workspace-furnishing-writer/037_workspace_furnishing_writer_generation.sql',publication='database/native-workspace-furnishing-publication/038_workspace_furnishing_publication.sql';
test('candidate import schema stays outside all current packages and the v5 catalog remains valid',async()=>{
 for(const fresh of [false,true])for(const selected of [false,true]){
  const excluded=nativePackageExcludedFiles(fresh,selected);
  assert.ok(excluded.has('database/native-oex-workspace-import/033_workspace_material_import_provenance.sql'));
  assert.ok(excluded.has('database/native-oex-workspace-import/034_workspace_material_terminal_proof.sql'));
  assert.ok(excluded.has(intake));assert.ok(excluded.has(workspaceOex));assert.ok(excluded.has(wall));assert.ok(excluded.has('database/native-workspace-furnishing/036_workspace_furnishing.sql'));assert.ok(excluded.has('database/native-workspace-furnishing-writer/037_workspace_furnishing_writer_generation.sql'));assert.ok(excluded.has(publication));
  assert.equal(excluded.has(migration),!fresh);assert.equal(excluded.has(normal),!selected);
 }
 assert.equal((await verifyWorkspaceMaterialMigrations(join(root,'database/native-oex-normal'))).length,2);
});
async function fixture(){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-oex-package-'))),source=join(temp,'source'),output=join(temp,'output');await mkdir(source);await mkdir(output);
 for(const name of [spec,migration,normal,provenance,material,floor,concrete,intake,workspaceOex,stage,proof,wall,furnishing,writer,publication,materialPublication]){await mkdir(dirname(join(source,name)),{recursive:true});await copyFile(join(root,name),join(source,name));}
 await writeFile(join(source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':`file:${spec}`}}}}));
 return {temp,source,output,tracked:new Map([['database',new Set()],['vendor',new Set()]])};
}
test('includes locked spec in both modes and test migration only when explicitly requested',async()=>{
 const f=await fixture();try{
  await copyFreshOexValidationFiles(f.source,f.output,f.tracked,false);assert.deepEqual(await readFile(join(f.output,spec)),await readFile(join(f.source,spec)));await assert.rejects(readFile(join(f.output,migration)),{code:'ENOENT'});
  await mkdir(join(f.temp,'second'));await copyFreshOexValidationFiles(f.source,join(f.temp,'second'),f.tracked,true);assert.deepEqual(await readFile(join(f.temp,'second',migration)),await readFile(join(f.source,migration)));
 }finally{await rm(f.temp,{recursive:true,force:true});}
});

test('036 packaged inventory requires explicit selection, exact bytes and the complete v7 parent',async()=>{const f=await fixture();try{
 await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
 await assert.rejects(writeNormalOexCapability(f.output,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true);await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true,true,true,true);
 assert.deepEqual(await readFile(join(f.output,furnishing)),await readFile(join(f.source,furnishing)));const marker=join(f.output,'scripts/native-workspace-furnishing-capability-v1.json');assert.equal(await readFile(marker,'utf8'),WORKSPACE_FURNISHING_CAPABILITY);assert.equal(await hasWorkspaceFurnishingCapability(marker),true);await writeFile(marker,'changed');await assert.rejects(hasWorkspaceFurnishingCapability(marker),/NATIVE_OEX_CATALOG/);
 await writeFile(join(f.source,furnishing),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true,true,true,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
}finally{await rm(f.temp,{recursive:true,force:true});}});

test('037 writer inventory requires explicit 036 parent and exact schema and marker bytes',async()=>{const f=await fixture();try{
 await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);await assert.rejects(writeNormalOexCapability(f.output,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true,true);await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true,true,true,true,true);
 assert.deepEqual(await readFile(join(f.output,writer)),await readFile(join(f.source,writer)));const marker=join(f.output,'scripts/native-workspace-furnishing-writer-capability-v1.json');assert.equal(await readFile(marker,'utf8'),WORKSPACE_FURNISHING_WRITER_CAPABILITY);assert.equal(await hasWorkspaceFurnishingWriterCapability(marker),true);const value=JSON.parse(WORKSPACE_FURNISHING_WRITER_CAPABILITY);assert.equal(value.parentCapabilitySHA256,createHash('sha256').update(WORKSPACE_FURNISHING_CAPABILITY).digest('hex'));assert.equal(value.schemaSHA256,createHash('sha256').update(await readFile(join(f.source,writer))).digest('hex'));await writeFile(marker,'changed');await assert.rejects(hasWorkspaceFurnishingWriterCapability(marker),/NATIVE_OEX_CATALOG/);await writeFile(join(f.source,writer),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true,true,true,true,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
}finally{await rm(f.temp,{recursive:true,force:true});}});
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

test('includes the exact normal selected migration only with explicit opt-in',async()=>{const f=await fixture();try{await copyNormalOexSelectedFile(f.source,f.output,f.tracked,false);await assert.rejects(readFile(join(f.output,normal)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,provenance)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,material)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,floor)),{code:'ENOENT'});await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true);assert.deepEqual(await readFile(join(f.output,floor)),await readFile(join(f.source,floor)));assert.deepEqual(await readFile(join(f.output,normal)),await readFile(join(f.source,normal)));assert.deepEqual(await readFile(join(f.output,provenance)),await readFile(join(f.source,provenance)));assert.deepEqual(await readFile(join(f.output,material)),await readFile(join(f.source,material)));await writeFile(join(f.source,normal),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('normal selected payload requires the pinned OEX spec',async()=>{const f=await fixture();try{await writeFile(join(f.source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':'different'}}}}));await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,false,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('selected capability has exact sealed bytes, is absent by default and refuses replacement',async()=>{const f=await fixture();try{
 const path=join(f.output,'scripts/native-normal-oex-capability-v1.json'),v3=join(f.output,'scripts/native-normal-oex-027-capability-v3.json');await mkdir(dirname(path));
 await writeNormalOexCapability(f.output,false);await assert.rejects(readFile(path),{code:'ENOENT'});await assert.rejects(readFile(v3),{code:'ENOENT'});
 await writeNormalOexCapability(f.output,true);
 assert.equal(await readFile(path,'utf8'),'{"format":1,"kind":"exhibitos-native-normal-oex","protocol":"normal-oex-v1","ownerChannelVersion":2,"schemaPath":"platform/database/native-oex-normal/026_oex_file_profile.sql","schemaSHA256":"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112","archiveFormat":"1.0.0-draft.9","maxArchiveBytes":536870912,"oneShot":true}');
 const proofBytes=await readFile(v3);assert.equal(proofBytes.length,516);assert.equal(createHash('sha256').update(proofBytes).digest('hex'),'f9eecec7b17a7f010a94bcc8711326a44261c9713249b01231cc62b86b18eb6d');
 const proof=JSON.parse(proofBytes.toString('utf8')); assert.deepEqual(proof,{format:1,kind:'exhibitos-native-normal-oex-027',protocol:'normal-oex-027-v3',ownerChannelVersion:3,baseSchemaPath:'platform/database/native-oex-normal/026_oex_file_profile.sql',baseSchemaSHA256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112',schemaPath:'platform/database/native-oex-normal/027_oex_exhibition_provenance.sql',schemaSHA256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7',archiveFormat:'1.0.0-draft.9',maxArchiveBytes:536870912,oneShot:true});
 const v4=await readFile(join(f.output,'scripts/native-normal-oex-028-capability-v4.json'));assert.equal(v4.length,787);assert.equal(createHash('sha256').update(v4).digest('hex'),'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4');
 const supplement=await readFile(join(f.output,'scripts/native-normal-oex-029-floor-capability-v4.json'));const floorProof=JSON.parse(supplement);assert.deepEqual(floorProof,{format:1,kind:'exhibitos-native-normal-oex-floor-supplement',protocol:'normal-oex-028-v4',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',parentCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',schemaPath:'platform/'+floor,schemaSHA256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a',packId:'quiet-oak-herringbone',packVersion:1,freshOnly:true});assert.equal(supplement.toString(),JSON.stringify(floorProof));
 const cp=JSON.parse(await readFile(join(f.output,'scripts/native-normal-oex-030-concrete-capability-v4.json'),'utf8'));assert.deepEqual(cp,{format:1,kind:'exhibitos-native-normal-oex-concrete-supplement',protocol:'normal-oex-028-v4',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',parentCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',schemaPath:'platform/'+concrete,schemaSHA256:'8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848',packId:'fine-gallery-concrete',packVersion:1,roles:['notice','color','roughness','normal'],freshOnly:true});
 const stat=await lstat(path);assert.ok(stat.isFile());assert.equal(stat.mode & 0o111,0);
 await assert.rejects(writeNormalOexCapability(f.output,true),{code:'EEXIST'});
 }finally{await rm(f.temp,{recursive:true,force:true});}});

test('rejects changed or symlinked 027 provenance input',async()=>{for(const kind of ['changed','symlink']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,provenance),'changed');else{await rm(join(f.source,provenance));await symlink(join(root,provenance),join(f.source,provenance));}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});

test('rejects changed or symlinked028 material input',async()=>{for(const kind of ['changed','symlink']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,material),'changed');else{await rm(join(f.source,material));await symlink(join(root,material),join(f.source,material));}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});

// Prior migration bytes remain checked independently; the new supplement must
// also reject source drift, symlinks and changed already-copied tracked bytes.
test('rejects changed, symlinked or drifted tracked029 floor migration',async()=>{for(const kind of ['changed','symlink','tracked']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,floor),'changed');else if(kind==='symlink'){await rm(join(f.source,floor));await symlink(join(root,floor),join(f.source,floor));}else{await mkdir(dirname(join(f.output,floor)),{recursive:true});await writeFile(join(f.output,floor),'changed');f.tracked.get('database').add(floor);}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});

test('rejects changed or symlinked concrete migration',async()=>{for(const kind of ['changed','symlink']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,concrete),'changed');else{await rm(join(f.source,concrete));await symlink(join(root,concrete),join(f.source,concrete));}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});


test('workspace capability and schema pair require explicit v5 selection and exact bytes',async()=>{const f=await fixture();try{
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true);
 for(const path of [intake,workspaceOex])assert.deepEqual(await readFile(join(f.output,path)),await readFile(join(f.source,path)));
 await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true);
 const marker=join(f.output,'scripts/native-workspace-material-capability-v5.json');await assert.rejects(readFile(join(f.output,'scripts/native-workspace-oex-import-capability-v6.json')),{code:'ENOENT'});assert.equal(await readFile(marker,'utf8'),WORKSPACE_MATERIAL_CAPABILITY);assert.equal(await hasWorkspaceMaterialCapability(marker),true);
 await writeFile(marker,'bad');await assert.rejects(hasWorkspaceMaterialCapability(marker),/NATIVE_OEX_CATALOG/);
 await writeFile(join(f.source,intake),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}});

test('draft12 package inputs and capability require explicit selected V6 and exact immutable schemas',async()=>{const f=await fixture();try{
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true);for(const path of [stage,proof])assert.deepEqual(await readFile(join(f.output,path)),await readFile(join(f.source,path)));
 await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true,true);const marker=await readFile(join(f.output,'scripts/native-workspace-oex-import-capability-v6.json'));assert.equal(marker.toString(),WORKSPACE_IMPORT_CAPABILITY);assert.equal(createHash('sha256').update(marker).digest('hex'),'1d5177c8c4ddb9dec26ed7724178376ae4ca615e06e64573b132b7c7abfa25e8');const value=JSON.parse(marker.toString());assert.equal(value.archiveFormat,'1.0.0-draft.12');assert.equal(value.parentCapabilitySHA256,createHash('sha256').update(WORKSPACE_MATERIAL_CAPABILITY).digest('hex'));assert.equal(value.stageSchemaSHA256,createHash('sha256').update(await readFile(join(f.source,stage))).digest('hex'));assert.equal(value.proofSchemaSHA256,createHash('sha256').update(await readFile(join(f.source,proof))).digest('hex'));
 await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);await assert.rejects(writeNormalOexCapability(f.output,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);await writeFile(join(f.source,proof),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'third'),f.tracked,true,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}});


test('v7 file selection keeps default and v6 unchanged and binds exact 035 and marker',async()=>{
 for(const mode of ['default','v6','v7']){const f=await fixture();try{
  const selected=mode!=='default',v7=mode==='v7';await copyNormalOexSelectedFile(f.source,f.output,f.tracked,selected,selected,selected,v7);await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,selected,selected,selected,v7);
  const marker=join(f.output,'scripts/native-workspace-oex-import-capability-v7.json');if(!v7){await assert.rejects(readFile(join(f.output,wall)),{code:'ENOENT'});await assert.rejects(readFile(marker),{code:'ENOENT'});}else{assert.deepEqual(await readFile(join(f.output,wall)),await readFile(join(f.source,wall)));assert.equal(createHash('sha256').update(await readFile(join(f.output,wall))).digest('hex'),'c347183b3e58805c46d1dde7ae6e2defc37762af52f585846357181b9635a544');assert.equal(createHash('sha256').update(await readFile(marker)).digest('hex'),'7229cba9fbf98301960f44d39927c8d528ed55c3eb5e5fbdf203341261f342d5');assert.equal(createHash('sha256').update(await readFile(join(f.output,'scripts/native-workspace-oex-import-capability-v6.json'))).digest('hex'),'1d5177c8c4ddb9dec26ed7724178376ae4ca615e06e64573b132b7c7abfa25e8');}
 }finally{await rm(f.temp,{recursive:true,force:true});}}
 const f=await fixture();try{await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);await assert.rejects(writeNormalOexCapability(f.output,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);await writeFile(join(f.source,wall),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}
});

test('038 publication inventory requires the writer parent and exact separate marker',async()=>{const f=await fixture();try{
 await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true,true,true);await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true,true,true,true,true,true);
 assert.deepEqual(await readFile(join(f.output,publication)),await readFile(join(f.source,publication)));const marker=join(f.output,'scripts/native-workspace-furnishing-publication-capability-v1.json');assert.equal(await readFile(marker,'utf8'),WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY);assert.equal(createHash('sha256').update(WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY).digest('hex'),'968dec2c1d4312b3e8a50194fa13d961c3bfb47ec4df17800f94e353a682daf3');assert.equal(await hasWorkspaceFurnishingPublicationCapability(marker),true);await writeFile(marker,'changed');await assert.rejects(hasWorkspaceFurnishingPublicationCapability(marker),/NATIVE_OEX_CATALOG/);
}finally{await rm(f.temp,{recursive:true,force:true});}});

test('039 publication schema and capability require the exact 038 parent',async()=>{const f=await fixture();try{
 await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true,true,false,true),/NATIVE_PACKAGE_INPUT_INVALID/);
 await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true,true,true,true,true,true,true,true);await mkdir(join(f.output,'scripts'));await writeNormalOexCapability(f.output,true,true,true,true,true,true,true,true);
 assert.deepEqual(await readFile(join(f.output,materialPublication)),await readFile(join(f.source,materialPublication)));const marker=await readFile(join(f.output,'scripts/native-workspace-material-publication-capability-v1.json'));assert.equal(marker.length,163);assert.equal(createHash('sha256').update(marker).digest('hex'),'c93117acc9cc397cb978bcb5d4bbc5732699af983f2f3c0413e9b4205455339c');
 }finally{await rm(f.temp,{recursive:true,force:true});}});

test('stool packaging requires explicit 040 parent selection',async()=>{
 await assert.rejects(packageNativeRuntime('/synthetic-unused',{workspaceFurnishingStoolSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
});

test('room-visual packaging requires the separate stool capability',async()=>{
 await assert.rejects(packageNativeRuntime('/synthetic-unused',{workspaceFurnishingRoomVisualSelected:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
});
