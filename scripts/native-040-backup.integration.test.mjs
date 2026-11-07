// SPDX-License-Identifier: AGPL-3.0-or-later
// Two explicitly named synthetic databases only; this does not qualify Manager.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {FileBlobStore,migrate} from '../packages/storage/dist/index.js';
import {main,inventorySnapshotOptionsForDatabase} from './service-backup.mjs';
const sourceUrl=new URL(process.env.EXHIBITOS_BACKUP_SOURCE_URL??'invalid://missing'),targetUrl=new URL(process.env.EXHIBITOS_BACKUP_TARGET_URL??'invalid://missing');
if(sourceUrl.hostname!=='127.0.0.1'||targetUrl.hostname!=='127.0.0.1'||sourceUrl.pathname!=='/exhibitos_backup_source_fixture'||targetUrl.pathname!=='/exhibitos_backup_target_fixture'||sourceUrl.href===targetUrl.href)throw Error('DISPOSABLE_BACKUP_DATABASES_REQUIRED');
const pgbin=process.env.EXHIBITOS_BACKUP_PG_BIN;if(!pgbin?.startsWith('/'))throw Error('BACKUP_PG_BIN_REQUIRED');
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-catalog040-backup-'))),sourceStore=new FileBlobStore(join(root,'source')),targetStore=new FileBlobStore(join(root,'target'));
await mkdir(sourceStore.root,{mode:0o700});await mkdir(targetStore.root,{mode:0o700});
const source=new Pool({connectionString:sourceUrl.href}),target=new Pool({connectionString:targetUrl.href});
const base=new URL('../database/migrations/',import.meta.url).pathname,normal=new URL('../database/native-oex-normal/',import.meta.url).pathname;
const supplemental=[['native-oex-normal','026_oex_file_profile.sql'],['native-oex-normal','027_oex_exhibition_provenance.sql'],['native-oex-normal','028_oex_material_catalogue.sql'],['native-oex-normal','029_oex_quiet_oak_floor.sql'],['native-oex-normal','030_oex_concrete_surface.sql'],['native-oex-normal','031_workspace_material.sql'],['native-oex-normal','032_oex_workspace_material.sql'],['native-oex-workspace-import','033_workspace_material_import_provenance.sql'],['native-oex-workspace-import','034_workspace_material_terminal_proof.sql'],['native-oex-workspace-import-wall','035_workspace_material_wall_import.sql'],['native-workspace-furnishing','036_workspace_furnishing.sql'],['native-workspace-furnishing-writer','037_workspace_furnishing_writer_generation.sql'],['native-workspace-furnishing-publication','038_workspace_furnishing_publication.sql'],['native-workspace-material-publication','039_workspace_material_publication.sql'],['native-workspace-material-multimap','040_workspace_material_multimap.sql']];
try{
 await test('catalog 040 creates, verifies and restores an encrypted backup to a distinct empty database',async()=>{
  const {createHash}=await import('node:crypto');await migrate(source,base);
  for(const [dir,name] of supplemental){const bytes=await readFile(new URL(`../database/${dir}/${name}`,import.meta.url));await source.query('BEGIN');try{await source.query(bytes.toString('utf8'));await source.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,createHash('sha256').update(bytes).digest('hex')]);await source.query('COMMIT');}catch(e){await source.query('ROLLBACK');throw e;}}
  await source.query("CREATE TABLE synthetic_backup_sample(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO synthetic_backup_sample VALUES(1,'retained')");
  const blob=Buffer.from('synthetic 040 retained blob');await sourceStore.put('synthetic/objects/example',blob);
  const key=join(root,'key.bin'),archive=join(root,'archive'),verified=join(root,'verified'),restored=join(root,'restored');
  const env=(url,store)=>({DATABASE_URL:url.href,BLOB_ROOT:store.root,BACKUP_BLOB_BACKEND:'filesystem',PG_DUMP_BIN:join(pgbin,'pg_dump'),PG_RESTORE_BIN:join(pgbin,'pg_restore')});
  await main(['key-init','--key-file',key],{});
  assert.equal((await main(['create','--key-file',key,'--destination',archive,'--quiesced'],env(sourceUrl,sourceStore))).operation,'created');
  assert.equal((await main(['verify','--key-file',key,'--source',archive,'--destination',verified],{})).operation,'verified');
  assert.equal((await main(['restore','--key-file',key,'--source',archive,'--destination',restored,'--quiesced','--fresh-destination'],env(targetUrl,targetStore))).operation,'restored-and-verified');
  for(const pool of [source,target]){const rows=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;assert.equal(rows.length,40);assert.equal(rows[39].name,'040_workspace_material_multimap.sql');assert.deepEqual((await inventorySnapshotOptionsForDatabase(pool,base,normal,rows)).migrationCatalog,rows);assert.deepEqual((await pool.query('SELECT * FROM synthetic_backup_sample')).rows,[{id:1,value:'retained'}]);}
  assert.deepEqual(Buffer.from(await targetStore.get('synthetic/objects/example')),blob);
 });
}finally{await source.end();await target.end();await rm(root,{recursive:true,force:true});}
