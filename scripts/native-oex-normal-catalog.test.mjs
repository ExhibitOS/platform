// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,copyFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {recognizeNormalOexCatalog,preflightNormalOexCatalog,verifyNormalOexFloorMigration,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,verifyNormalOexConcreteMigration,verifyWorkspaceMaterialMigrations,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_IMPORT_CAPABILITY,hasWorkspaceImportCapability,verifyWorkspaceImportMigrations} from './native-oex-normal-catalog.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){const root=await mkdtemp(join(tmpdir(),'native-catalog-')),base=join(root,'base'),extra=join(root,'extra');await mkdir(base);await mkdir(extra);const rows=[];for(let i=1;i<=25;i++){const name=String(i).padStart(3,'0')+'_fixture.sql',data='SELECT '+i+';';await writeFile(join(base,name),data);rows.push({name,sha256:sha(data)});}await copyFile(fileURLToPath(new URL('../database/native-oex-normal/026_oex_file_profile.sql',import.meta.url)),join(extra,NORMAL_OEX_MIGRATION));rows.push({name:NORMAL_OEX_MIGRATION,sha256:NORMAL_OEX_SHA256});return{root,base,extra,rows,pool:{query:async()=>({rows})}};}
test('recognizes only the complete pinned normal catalog, without modifying it',async()=>{const f=await fixture();try{assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);f.rows.pop();assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),undefined);}finally{await rm(f.root,{recursive:true,force:true});}});
test('refuses drift, unknown rows, changed supplemental bytes and symlinks',async()=>{for(const kind of ['old-hash','extra-row','new-hash','bytes','symlink']){const f=await fixture();try{if(kind==='old-hash')f.rows[0].sha256='0'.repeat(64);if(kind==='extra-row')f.rows.push({name:'027_unknown.sql',sha256:'0'.repeat(64)});if(kind==='new-hash')f.rows[25].sha256='0'.repeat(64);if(kind==='bytes')await writeFile(join(f.extra,NORMAL_OEX_MIGRATION),'changed');if(kind==='symlink'){await rm(join(f.extra,NORMAL_OEX_MIGRATION));await symlink(join(f.base,f.rows[0].name),join(f.extra,NORMAL_OEX_MIGRATION));}await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);}finally{await rm(f.root,{recursive:true,force:true});}}});

test('recognizes exact 027 only with matching bytes and fails closed for missing or drifted provenance',async()=>{const f=await fixture();try{
 const source=fileURLToPath(new URL('../database/native-oex-normal/027_oex_exhibition_provenance.sql',import.meta.url));await copyFile(source,join(f.extra,NORMAL_OEX_PROVENANCE_MIGRATION));
 assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);f.rows.push({name:NORMAL_OEX_PROVENANCE_MIGRATION,sha256:NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256});assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);
 await writeFile(join(f.extra,NORMAL_OEX_PROVENANCE_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 await rm(join(f.extra,NORMAL_OEX_PROVENANCE_MIGRATION));await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/ENOENT/);
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('preflight permits an empty or legacy catalog and rejects unknown or damaged selected catalogs before writes',async()=>{const f=await fixture();try{
 let present=false,rows=[];const client={query:async text=>text.startsWith('SELECT to_regclass')?{rows:[{name:present?'schema_migrations':null}]}:{rows}};
 assert.equal(await preflightNormalOexCatalog(client,f.base,f.extra),undefined);present=true;rows=f.rows.slice(0,25);assert.equal(await preflightNormalOexCatalog(client,f.base,f.extra),undefined);
 rows=structuredClone(f.rows);assert.equal(await preflightNormalOexCatalog(client,f.base,f.extra),f.extra);rows[25].sha256='0'.repeat(64);await assert.rejects(preflightNormalOexCatalog(client,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 rows=[...f.rows.slice(0,25),{name:'026_unknown.sql',sha256:'0'.repeat(64)}];await assert.rejects(preflightNormalOexCatalog(client,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('recognizes exact028 after026/027 and rejects missing, drifted or reordered catalogue rows',async()=>{const f=await fixture();try{
 for(const name of [NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_MATERIAL_MIGRATION])await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));
 f.rows.push({name:NORMAL_OEX_PROVENANCE_MIGRATION,sha256:NORMAL_OEX_PROVENANCE_SHA256},{name:NORMAL_OEX_MATERIAL_MIGRATION,sha256:NORMAL_OEX_MATERIAL_SHA256});
 assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);
 f.rows[27].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);f.rows[27].sha256=NORMAL_OEX_MATERIAL_SHA256;
 f.rows.splice(26,1);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('recognizes only exact029 after028, preserves old catalogs without writes and rejects gaps, drift and extras',async()=>{const f=await fixture();try{
 for(const [name,hash] of [[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256]]){await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));f.rows.push({name,sha256:hash});}
 assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);assert.match(await verifyNormalOexFloorMigration(f.extra),/quiet-oak-herringbone/);
 const exact=structuredClone(f.rows);f.rows.pop();const old=JSON.stringify(f.rows);assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);assert.equal(JSON.stringify(f.rows),old);
 for(const edit of [rows=>rows[28].sha256='0'.repeat(64),rows=>rows.splice(27,1),rows=>rows.reverse(),rows=>rows.push({name:'030_unknown.sql',sha256:'0'.repeat(64)})]){f.rows.splice(0,f.rows.length,...structuredClone(exact));edit(f.rows);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);}
 f.rows.splice(0,f.rows.length,...exact);await writeFile(join(f.extra,NORMAL_OEX_FLOOR_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 await rm(join(f.extra,NORMAL_OEX_FLOOR_MIGRATION));await assert.rejects(verifyNormalOexFloorMigration(f.extra),/ENOENT/);
 await symlink(join(f.base,f.rows[0].name),join(f.extra,NORMAL_OEX_FLOOR_MIGRATION));await assert.rejects(verifyNormalOexFloorMigration(f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('recognizes 030 only after exact 029 and rejects drift and missing dependencies',async()=>{const f=await fixture();try{
 for(const [name,hash] of [[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256],[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256]]){await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));f.rows.push({name,sha256:hash});}
 assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);assert.match(await verifyNormalOexConcreteMigration(f.extra),/fine-gallery-concrete/);
 const exact=structuredClone(f.rows);f.rows.splice(28,1);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...exact);f.rows[29].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...exact);await writeFile(join(f.extra,NORMAL_OEX_CONCRETE_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});


test('accepts both exact workspace migrations atomically and rejects partial or drifted catalogs',async()=>{const f=await fixture();try{
 const additions=[[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256],[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256],[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]];
 for(const [name,hash] of additions){await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));f.rows.push({name,sha256:hash});}
 assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra),f.extra);
 const client={query:async text=>text.startsWith('SELECT to_regclass')?{rows:[{name:'schema_migrations'}]}:{rows:f.rows}};
 await assert.rejects(preflightNormalOexCatalog(client,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 assert.equal(await preflightNormalOexCatalog(client,f.base,f.extra,{allowWorkspaceMaterial:true}),f.extra);
 assert.equal((await verifyWorkspaceMaterialMigrations(f.extra)).length,2);
 const exact=structuredClone(f.rows);f.rows.pop();await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...structuredClone(exact));f.rows[31].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...structuredClone(exact));await writeFile(join(f.extra,WORKSPACE_MATERIAL_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});

test('recognizes the full v6 ledger only with explicit capability and exact 033/034 files',async()=>{const f=await fixture();try{
 const normal=[[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256],[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256],[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]],imports=[[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]],dir=join(f.root,'imports');await mkdir(dir);
 for(const [name,hash] of normal){await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));f.rows.push({name,sha256:hash});}for(const [name,hash] of imports){await copyFile(fileURLToPath(new URL('../database/native-oex-workspace-import/'+name,import.meta.url)),join(dir,name));f.rows.push({name,sha256:hash});}
 const client={query:async text=>text.startsWith('SELECT to_regclass')?{rows:[{name:'schema_migrations'}]}:{rows:f.rows}};await assert.rejects(preflightNormalOexCatalog(client,f.base,f.extra,{allowWorkspaceMaterial:true}),/NATIVE_OEX_CATALOG/);assert.equal(await preflightNormalOexCatalog(client,f.base,f.extra,{allowWorkspaceMaterial:true,workspaceImportDirectory:dir}),f.extra);assert.equal((await verifyWorkspaceImportMigrations(dir)).length,2);
 const marker=join(f.root,'v6.json');assert.equal(await hasWorkspaceImportCapability(marker),false);await writeFile(marker,WORKSPACE_IMPORT_CAPABILITY);assert.equal(await hasWorkspaceImportCapability(marker),true);await writeFile(marker,'changed');await assert.rejects(hasWorkspaceImportCapability(marker),/NATIVE_OEX_CATALOG/);
 const exact=structuredClone(f.rows);f.rows.pop();await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir}),/NATIVE_OEX_CATALOG/);f.rows.splice(0,f.rows.length,...structuredClone(exact));f.rows.push({name:'035_unknown.sql',sha256:'0'.repeat(64)});await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir}),/NATIVE_OEX_CATALOG/);f.rows.splice(0,f.rows.length,...exact);await writeFile(join(dir,WORKSPACE_IMPORT_PROOF_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir}),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});


test('v7 recognizes only exact 035 with separate capability and preserves v6 isolation',async()=>{const f=await fixture();try{
 const catalog=await import('./native-oex-normal-catalog.mjs');const normal=[[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256],[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256],[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]],imports=[[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]],dir=join(f.root,'imports'),wall=join(f.root,'wall');await mkdir(dir);await mkdir(wall);
 for(const [name,hash] of normal){await copyFile(fileURLToPath(new URL('../database/native-oex-normal/'+name,import.meta.url)),join(f.extra,name));f.rows.push({name,sha256:hash});}for(const [name,hash] of imports){await copyFile(fileURLToPath(new URL('../database/native-oex-workspace-import/'+name,import.meta.url)),join(dir,name));f.rows.push({name,sha256:hash});}
 await copyFile(fileURLToPath(new URL('../database/native-oex-workspace-import-wall/'+catalog.WORKSPACE_WALL_IMPORT_MIGRATION,import.meta.url)),join(wall,catalog.WORKSPACE_WALL_IMPORT_MIGRATION));f.rows.push({name:catalog.WORKSPACE_WALL_IMPORT_MIGRATION,sha256:catalog.WORKSPACE_WALL_IMPORT_SHA256});
 await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir}),/NATIVE_OEX_CATALOG/);assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir,workspaceWallImportDirectory:wall}),f.extra);
 const furnishing=join(f.root,'furnishing');await mkdir(furnishing);await copyFile(fileURLToPath(new URL('../database/native-workspace-furnishing/'+catalog.WORKSPACE_FURNISHING_MIGRATION,import.meta.url)),join(furnishing,catalog.WORKSPACE_FURNISHING_MIGRATION));f.rows.push({name:catalog.WORKSPACE_FURNISHING_MIGRATION,sha256:catalog.WORKSPACE_FURNISHING_SHA256});const options={workspaceImportDirectory:dir,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing};await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir,workspaceWallImportDirectory:wall}),/NATIVE_OEX_CATALOG/);assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra,options),f.extra);
 const writer=join(f.root,'writer');await mkdir(writer);await copyFile(fileURLToPath(new URL('../database/native-workspace-furnishing-writer/'+catalog.WORKSPACE_FURNISHING_WRITER_MIGRATION,import.meta.url)),join(writer,catalog.WORKSPACE_FURNISHING_WRITER_MIGRATION));f.rows.push({name:catalog.WORKSPACE_FURNISHING_WRITER_MIGRATION,sha256:catalog.WORKSPACE_FURNISHING_WRITER_SHA256});await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,options),/NATIVE_OEX_CATALOG/);const writerOptions={...options,workspaceFurnishingWriterDirectory:writer};assert.equal(await recognizeNormalOexCatalog(f.pool,f.base,f.extra,writerOptions),f.extra);f.rows[36].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,writerOptions),/NATIVE_OEX_CATALOG/);f.rows[36].sha256=catalog.WORKSPACE_FURNISHING_WRITER_SHA256;await writeFile(join(writer,catalog.WORKSPACE_FURNISHING_WRITER_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,writerOptions),/NATIVE_OEX_CATALOG/);f.rows.pop();
 f.rows[35].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,options),/NATIVE_OEX_CATALOG/);f.rows[35].sha256=catalog.WORKSPACE_FURNISHING_SHA256;await writeFile(join(furnishing,catalog.WORKSPACE_FURNISHING_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,options),/NATIVE_OEX_CATALOG/);f.rows.pop();
 f.rows[34].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra,{workspaceImportDirectory:dir,workspaceWallImportDirectory:wall}),/NATIVE_OEX_CATALOG/);
 const marker=join(f.root,'v7.json');assert.equal(sha(catalog.WORKSPACE_WALL_IMPORT_CAPABILITY),'7229cba9fbf98301960f44d39927c8d528ed55c3eb5e5fbdf203341261f342d5');await writeFile(marker,catalog.WORKSPACE_WALL_IMPORT_CAPABILITY);assert.equal(await catalog.hasWorkspaceWallImportCapability(marker),true);await writeFile(marker,catalog.WORKSPACE_WALL_IMPORT_CAPABILITY+'\n');await assert.rejects(catalog.hasWorkspaceWallImportCapability(marker),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});


test('selected V6 and V7 modes require matching wall ledger while ordinary reopen remains available',async()=>{
 const {assertWorkspaceImportOwnerMode:check}=await import('./native-oex-normal-catalog.mjs');
 assert.doesNotThrow(()=>check('normal-oex-workspace-import-v6',false));
 assert.throws(()=>check('normal-oex-workspace-import-v6',true),/NATIVE_OEX_CATALOG/);
 assert.throws(()=>check('normal-oex-workspace-import-v7',false),/NATIVE_OEX_CATALOG/);
 assert.doesNotThrow(()=>check('normal-oex-workspace-import-v7',true));
 assert.doesNotThrow(()=>check(undefined,true));
});
