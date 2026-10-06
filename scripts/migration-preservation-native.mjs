// SPDX-License-Identifier: AGPL-3.0-or-later
// Explicit native component test; requires a fresh disposable PostgreSQL cluster.
import pg from 'pg';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {migrate} from '../packages/storage/dist/index.js';
import {collectServiceInventory,inventoryCanonical} from '../packages/storage/dist/service-inventory.js';
import {verifyMigratedInventory,verifyRestoredInventory} from '../packages/storage/dist/service-backup.js';
const databaseUrl=process.env.EXHIBITOS_MIGRATION_TEST_DATABASE_URL;
if(!databaseUrl)throw Error('DISPOSABLE_DATABASE_URL_REQUIRED');
const sha=x=>createHash('sha256').update(x).digest('hex'),pool=new pg.Pool({connectionString:databaseUrl});
const data=new Map([['synthetic/objects/one',Buffer.from('obj')]]),store={listAll:async()=>[...data.keys()],get:async k=>data.get(k)};
const snapshot=d=>c=>collectServiceInventory(c,store,{migrationDirectory:d});
const collect=async d=>{const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');return await snapshot(d)(c);}finally{await c.query('ROLLBACK');c.release();}};
const expectRefusal=async(code,fn)=>{try{await fn();throw Error('UNEXPECTED_ACCEPTANCE');}catch(e){if(!String(e.message).includes(code))throw e;return true;}};
try{
 const existing=await pool.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'");
 if(existing.rows.length)throw Error('DISPOSABLE_DATABASE_NOT_EMPTY');
 const root=await mkdtemp(join(tmpdir(),'exhibitos-migration-component-'));
 for(const name of ['original','target','failure']){const directory=join(root,name);await mkdir(directory);await writeFile(join(directory,'001.sql'),"CREATE TABLE accounts(id bigserial PRIMARY KEY, label text NOT NULL); INSERT INTO accounts(label) VALUES ('synthetic-original');");if(name!=='original')await writeFile(join(directory,'002.sql'),'CREATE TABLE additive(id bigint PRIMARY KEY, note text);');if(name==='failure')await writeFile(join(directory,'003.sql'),'CREATE TABLE must_rollback(id bigint); SELECT * FROM definitely_absent_table;');}
 await migrate(pool,join(root,'original'));const before=await collect(join(root,'original'));
 const current=(await pool.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
 const manifest={schemaVersion:'1.0.0-draft.1',kind:'service-backup',id:'bcf0ef6a-2758-4b2c-b950-05ae6f6f062b',createdAt:before.createdAt,sourceIdentity:{systemIdentifier:'1',databaseOid:'1',database:'postgres'},inventory:before,files:[{role:'database',path:'files/00000000.gcm',bytes:1,cipherBytes:37,sha256:sha('synthetic-dump-description'),cipherSha256:sha('synthetic-cipher-description')},{role:'object',path:'files/00000001.gcm',key:'synthetic/objects/one',bytes:3,cipherBytes:39,sha256:sha('obj'),cipherSha256:sha('cipher')} ]};
 // Component fixture: hashes below do not claim a real encrypted backup or signed artifact.
 const manifestBytes=Buffer.from(JSON.stringify(manifest));await migrate(pool,join(root,'target'));const target=await collect(join(root,'target'));
 const options={pool,manifestBytes,expectedManifestSha256:sha(manifestBytes),snapshotSystemIdentifier:current,snapshot:snapshot(join(root,'target')),targetMigrations:target.migrations,targetSchemaSha256:sha(inventoryCanonical({schemaDigest:target.schemaDigest,schemaVersion:target.schemaVersion,migrations:target.migrations}))};
 const proof=await verifyMigratedInventory(options),checks={preserved:proof.originalDataPreserved};
 checks.oldExactRestorationRefuses=await expectRefusal('SOURCE_INVENTORY_MISMATCH',()=>verifyRestoredInventory(options));
 await pool.query("UPDATE accounts SET label='changed'");checks.changedRowRefuses=await expectRefusal('MIGRATION_DATA_MISMATCH',()=>verifyMigratedInventory(options));await pool.query("UPDATE accounts SET label='synthetic-original'");
 await pool.query("SELECT nextval('accounts_id_seq')");checks.changedSequenceRefuses=await expectRefusal('MIGRATION_DATA_MISMATCH',()=>verifyMigratedInventory(options));await pool.query("SELECT setval('accounts_id_seq',1,true)");
 const timestamp=(await pool.query("SELECT applied_at::text AS v FROM schema_migrations WHERE name='001.sql'")).rows[0].v;
 await pool.query("UPDATE schema_migrations SET applied_at=applied_at+interval '1 second' WHERE name='001.sql'");checks.changedHistoryRefuses=await expectRefusal('MIGRATION_HISTORY_MISMATCH',()=>verifyMigratedInventory(options));await pool.query("UPDATE schema_migrations SET applied_at=$1::timestamptz WHERE name='001.sql'",[timestamp]);
 data.set('synthetic/objects/one',Buffer.from('bad'));checks.changedBlobRefuses=await expectRefusal('MIGRATION_DATA_MISMATCH',()=>verifyMigratedInventory(options));data.set('synthetic/objects/one',Buffer.from('obj'));
 let failed=false;try{await migrate(pool,join(root,'failure'));}catch{failed=true;}if(!failed)throw Error('FAILED_SQL_ACCEPTED');
 checks.failedSqlRolledBack=(await pool.query("SELECT to_regclass('public.must_rollback') AS table")).rows[0].table===null&&(await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name='003.sql'")).rows[0].n===0;
 checks.preservedAfterFailure=(await verifyMigratedInventory(options)).originalDataPreserved;
 if(!Object.values(checks).every(Boolean))throw Error('NATIVE_CHECK_FAILED');
 console.log(JSON.stringify({status:'PASS',checks,sourceSchemaSha256:proof.sourceSchemaSha256,targetSchemaSha256:proof.targetSchemaSha256,scope:'native PostgreSQL component; synthetic manifest, no encrypted backup/artifact/Manager activation proof'}));
}finally{await pool.end();}
