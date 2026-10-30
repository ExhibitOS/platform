// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import type {Pool} from 'pg';
import {inventoryCanonical,type ServiceInventory} from './service-inventory.js';
import {verifyMigratedInventory,verifyRestoredInventory} from './service-backup.js';
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const schema=(v:ServiceInventory)=>sha(inventoryCanonical({schemaDigest:v.schemaDigest,schemaVersion:v.schemaVersion,migrations:v.migrations}));
function fixture(){
 const raw='{"name": "001.sql", "sha256": "'+sha('old SQL')+'", "applied_at": "2026-01-01T00:00:00+00:00"}';
 const inventory:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:'2026-01-01T00:00:00Z',schemaDigest:sha('original catalog'),migrations:[{name:'001.sql',sha256:sha('old SQL')}],tables:[{name:'accounts',rowCount:1,sha256:sha('private row')},{name:'ids',rowCount:1,sha256:sha('sequence state')},{name:'schema_migrations',rowCount:1,sha256:sha(raw+'\n')}],objects:[{key:'synthetic/objects/one',bytes:3,sha256:sha('obj'),referenced:false,bindings:[]}],references:[],issues:[]};
 const manifest={schemaVersion:'1.0.0-draft.1',kind:'service-backup',id:'bcf0ef6a-2758-4b2c-b950-05ae6f6f062b',createdAt:inventory.createdAt,sourceIdentity:{systemIdentifier:'123',databaseOid:'456',database:'synthetic'},inventory,files:[{role:'database',path:'files/00000000.gcm',bytes:1,cipherBytes:37,sha256:sha('dump'),cipherSha256:sha('cipher')},{role:'object',path:'files/00000001.gcm',key:'synthetic/objects/one',bytes:3,cipherBytes:39,sha256:sha('obj'),cipherSha256:sha('cipher obj')}]};
 const actual=structuredClone(inventory);actual.schemaDigest=sha('target catalog');actual.migrations.push({name:'002.sql',sha256:sha('new SQL')});actual.tables[2]={name:'schema_migrations',rowCount:2,sha256:sha('old and new logs')};actual.tables.push({name:'new_table',rowCount:0,sha256:sha('')});
 const manifestBytes=Buffer.from(JSON.stringify(manifest)),queries:string[]=[];let historySent=false,released:boolean|undefined;
 const client={async query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>{queries.push(sql);if(sql.startsWith('DECLARE')){historySent=false;expect(values).toEqual([['001.sql']]);return {rows:[]};}if(sql.startsWith('FETCH')){if(historySent)return {rows:[]};historySent=true;return {rows:[{raw}]};}return {rows:sql.includes('pg_try_advisory')?[{locked:true}]:sql.includes('pg_advisory_unlock')?[{unlocked:true}]:sql.includes('pg_control_system')?[{system:'789',oid:'999',database:'synthetic'}]:[]};},release(broken:boolean){released=broken;}};
 const pool={async connect(){return client;}} as unknown as Pool;
 return {inventory,actual,client,queries,released:()=>released,options:{pool,manifestBytes,expectedManifestSha256:sha(manifestBytes),snapshotSystemIdentifier:'789',targetSchemaSha256:schema(actual),targetMigrations:structuredClone(actual.migrations),snapshot:async()=>structuredClone(actual)}};
}
test('additive catalog/log change preserves original data with two native-history snapshots and bounded proof',async()=>{
 const f=fixture(),result=await verifyMigratedInventory({...f.options,snapshot:async(...args)=>{expect(args).toHaveLength(1);return structuredClone(f.actual);}});
 expect(result.originalDataPreserved).toBe(true);expect(result.operation).toBe('migrated-inventory-preserved');expect(result.currentInventoryVerified).toBe(false);expect(result.preflightVerified).toBe(false);expect(result.updateExecuted).toBe(false);expect(result.configurationVerified).toBe(false);
 expect(JSON.stringify(result)).not.toContain('synthetic/objects');expect(f.queries.filter(q=>q==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')).toHaveLength(2);expect(f.queries.filter(q=>q.startsWith('CLOSE'))).toHaveLength(2);expect(f.released()).toBe(false);
 // The old exact-restoration contract still refuses a changed schema.
 await expect(verifyRestoredInventory(f.options)).rejects.toThrow('SOURCE_INVENTORY_MISMATCH');
});
test.each(['row','count','sequence','missing-table','duplicate-table','object','binding','reference','issue','catalog','migration'])('changed %s refuses preservation',async kind=>{
 const f=fixture(),v=f.actual;
 if(kind==='row')v.tables[0]!.sha256=sha('changed');if(kind==='count')v.tables[0]!.rowCount=2;
 if(kind==='sequence')v.tables[1]!.sha256=sha('advanced');if(kind==='missing-table')v.tables.shift();if(kind==='duplicate-table')v.tables.push({...v.tables[0]!});
 if(kind==='object')v.objects[0]!.sha256=sha('changed');if(kind==='binding')v.objects[0]!.bindings.push('unbound');if(kind==='reference')v.references.push({key:'synthetic/objects/one',binding:'unexpected',required:false});
 if(kind==='issue')v.issues.push({code:'OBJECT_MISSING'});if(kind==='catalog')v.schemaDigest=sha('wrong target');if(kind==='migration')v.migrations[1]!.sha256=sha('wrong SQL');
 await expect(verifyMigratedInventory(f.options)).rejects.toThrow();expect(f.queries.at(-2)).toBe('ROLLBACK');expect(f.queries.at(-1)).toContain('pg_advisory_unlock');
});
test('old migration applied_at or missing original log refuses, despite correct migration checksums',async()=>{
 for(const mode of ['changed','missing']){const f=fixture(),query=f.client.query;let sent=false;
 f.client.query=async(sql,values)=>{if(sql.startsWith('DECLARE'))sent=false;if(sql.startsWith('FETCH')){if(sent||mode==='missing')return {rows:[]};sent=true;return {rows:[{raw:'changed historical timestamp'}]};}return query(sql,values);};
 await expect(verifyMigratedInventory(f.options)).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');expect(f.queries.some(q=>q.startsWith('CLOSE'))).toBe(true);}
});
test.each(['hash','original','invalid-id','unsorted','duplicate','changed-prefix','no-new-migration','same-schema'])('invalid %s binding refuses before any DB session',async kind=>{
 const f=fixture(),o=f.options;
 if(kind==='hash')o.expectedManifestSha256=sha('wrong');if(kind==='original')o.snapshotSystemIdentifier='123';if(kind==='invalid-id')o.snapshotSystemIdentifier='01';if(kind==='unsorted')o.targetMigrations.reverse();if(kind==='duplicate')o.targetMigrations.push({...o.targetMigrations[1]!});if(kind==='changed-prefix')o.targetMigrations[0]!.sha256=sha('replaced');if(kind==='no-new-migration')o.targetMigrations.pop();if(kind==='same-schema')o.targetSchemaSha256=schema(f.inventory);
 await expect(verifyMigratedInventory(o)).rejects.toThrow();expect(f.queries).toEqual([]);
});
test('second-pass new-table drift refuses and target binding cannot shrink during async collection',async()=>{
 const f=fixture();let pass=0;await expect(verifyMigratedInventory({...f.options,snapshot:async()=>{const v=structuredClone(f.actual);if(++pass===2)v.tables[3]!.sha256=sha('unexpected new rows');return v;}})).rejects.toThrow('MIGRATION_OBSERVATION_CHANGED');
 const g=fixture(),result=await verifyMigratedInventory({...g.options,snapshot:async()=>{g.options.targetMigrations.length=0;return structuredClone(g.actual);}});expect(result.originalDataPreserved).toBe(true);
});
test('foreign physical identity, busy lock and unlock failure cannot produce proof',async()=>{
 for(const kind of ['identity','busy','unlock']){const f=fixture(),query=f.client.query;f.client.query=async(sql,values)=>{
 if(kind==='identity'&&sql.includes('pg_control_system'))return {rows:[{system:'999',oid:'999',database:'synthetic'}]};
 if(kind==='busy'&&sql.includes('pg_try_advisory'))return {rows:[{locked:false}]};if(kind==='unlock'&&sql.includes('pg_advisory_unlock'))return {rows:[{unlocked:false}]};return query(sql,values);};
 await expect(verifyMigratedInventory(f.options)).rejects.toThrow(kind==='identity'?'CANDIDATE_DATABASE_MISMATCH':kind==='busy'?'SOURCE_INVENTORY_BUSY':'SOURCE_INVENTORY_CLEANUP_FAILED');expect(f.released()).toBe(kind==='unlock');}
});

async function oexFixture(){
 const f=fixture(),directory=new URL('../../../database/migrations/',import.meta.url);
 const migrations=await Promise.all((await readdir(directory)).filter(name=>name.endsWith('.sql')&&name<'026_').sort().map(async name=>({name,sha256:sha(await readFile(new URL(name,directory)))})));
 expect(migrations).toHaveLength(25);
 const history=migrations.map(m=>JSON.stringify({...m,applied_at:'2026-01-01T00:00:00+00:00'}));
 const original='{"id": "original-receipt", "expected_bytes": 100}';
 const manifest=JSON.parse(f.options.manifestBytes.toString());
 manifest.inventory.migrations=migrations;
 manifest.inventory.tables=manifest.inventory.tables.filter((t:{name:string})=>t.name!=='schema_migrations');
 manifest.inventory.tables.push({name:'schema_migrations',rowCount:25,sha256:sha(history.map(r=>r+'\n').join(''))},{name:'oex_import_jobs',rowCount:1,sha256:sha(original+'\n')});
 const actual=structuredClone(manifest.inventory) as ServiceInventory;
 actual.schemaDigest=sha('qualified 026 physical catalog');
 actual.migrations.push({name:'026_oex_file_profile.sql',sha256:'b6a8012bc4447bc971af844f0076a1e0868f2cad08ff975ce8c1a3979f233841'});
 actual.tables.find(t=>t.name==='schema_migrations')!.rowCount=26;
 actual.tables.find(t=>t.name==='schema_migrations')!.sha256=sha('full 026 history');
 actual.tables.find(t=>t.name==='oex_import_jobs')!.sha256=sha('same receipt including two null columns');
 const manifestBytes=Buffer.from(JSON.stringify(manifest));
 const options={...f.options,manifestBytes,expectedManifestSha256:sha(manifestBytes),targetMigrations:structuredClone(actual.migrations),targetSchemaSha256:schema(actual),snapshot:async()=>structuredClone(actual)};
 const state={nonNull:false,jobRows:[original]};let rows:string[]=[],sent=false;
 const query=f.client.query;
 f.client.query=async(sql,values)=>{
  if(sql.startsWith('SELECT 1 FROM public.oex_import_jobs')){f.queries.push(sql);return {rows:state.nonNull?[{exists:1}]:[]};}
  if(sql.startsWith('DECLARE')){f.queries.push(sql);sent=false;
   if(sql.includes('FROM public.oex_import_jobs')){expect(sql).toContain("to_jsonb(t) - 'archive_profile' - 'oex_format'");rows=state.jobRows;}
   else{expect(values).toEqual([migrations.map(m=>m.name)]);rows=history;}
   return {rows:[]};
  }
  if(sql.startsWith('FETCH')){f.queries.push(sql);if(sent)return {rows:[]};sent=true;return {rows:rows.map(raw=>({raw}))};}
  return query(sql,values);
 };
 return {...f,actual,options,state};
}
test('exact 025 to 026 preserves every old OEX column while requiring both new columns null in two passes',async()=>{
 const f=await oexFixture();expect((await verifyMigratedInventory(f.options)).originalDataPreserved).toBe(true);
 expect(f.queries.filter(q=>q.startsWith('SELECT 1 FROM public.oex_import_jobs'))).toHaveLength(2);
 expect(f.queries.filter(q=>q.startsWith('DECLARE')&&q.includes('FROM public.oex_import_jobs'))).toHaveLength(2);
 await expect(verifyRestoredInventory(f.options)).rejects.toThrow('SOURCE_INVENTORY_MISMATCH');
});
test.each(['profile-write','old-column-write','row-count','primary-key','other-table','blob-reference','sql-change','extra-migration','second-pass'])('026 refuses %s rather than weakening ordinary preservation or rollback',async kind=>{
 const f=await oexFixture();
 if(kind==='profile-write')f.state.nonNull=true;
 if(kind==='old-column-write')f.state.jobRows=['changed original receipt'];
 if(kind==='row-count')f.actual.tables.find(t=>t.name==='oex_import_jobs')!.rowCount=2;
 if(kind==='primary-key')f.actual.schemaDigest=sha('changed primary key catalog');
 if(kind==='other-table')f.actual.tables.find(t=>t.name==='accounts')!.sha256=sha('changed account');
 if(kind==='blob-reference')f.actual.references.push({key:'synthetic/objects/one',binding:'new binding',required:false});
 if(kind==='sql-change'){f.options.targetMigrations[25]!.sha256=sha('different 026 SQL');f.actual.migrations=structuredClone(f.options.targetMigrations);f.options.targetSchemaSha256=schema(f.actual);}
 if(kind==='extra-migration'){f.options.targetMigrations.push({name:'027_unqualified.sql',sha256:sha('not admitted')});f.actual.migrations=structuredClone(f.options.targetMigrations);f.actual.tables.find(t=>t.name==='schema_migrations')!.rowCount=27;f.options.targetSchemaSha256=schema(f.actual);}
 if(kind==='second-pass'){let pass=0;f.options.snapshot=async()=>{const v=structuredClone(f.actual);if(++pass===2)v.tables.find(t=>t.name==='oex_import_jobs')!.sha256=sha('late raw-row change');return v;};}
 await expect(verifyMigratedInventory(f.options)).rejects.toThrow();
 expect(f.queries.at(-2)).toBe('ROLLBACK');expect(f.queries.at(-1)).toContain('pg_advisory_unlock');
});
