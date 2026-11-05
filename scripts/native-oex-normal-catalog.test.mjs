// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,copyFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {recognizeNormalOexCatalog,preflightNormalOexCatalog,verifyNormalOexFloorMigration,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,verifyNormalOexConcreteMigration,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256} from './native-oex-normal-catalog.mjs';
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
 const exact=structuredClone(f.rows);f.rows.pop();await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...structuredClone(exact));f.rows[31].sha256='0'.repeat(64);await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 f.rows.splice(0,f.rows.length,...structuredClone(exact));await writeFile(join(f.extra,WORKSPACE_MATERIAL_MIGRATION),'changed');await assert.rejects(recognizeNormalOexCatalog(f.pool,f.base,f.extra),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
