// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {FileBlobStore,migrate,collectServiceInventory,createServiceBackup,verifyServiceBackup} from '../packages/storage/dist/index.js';
import {IsolatedBackends} from './service-backup-adapters.mjs';
const root=await realpath(await mkdtemp('/private/tmp/exhibitos-source-inventory-proof-'));
const images=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))),backends=new IsolatedBackends(images),checks=[];
const hash=data=>createHash('sha256').update(data).digest('hex'),migrationDirectory=new URL('../database/migrations/',import.meta.url).pathname;
const step=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
let source,manifestPath,manifestBytes,store,environment,report;
function cli(flags=[],override={}){
 try{return {ok:true,value:JSON.parse(execFileSync(process.execPath,[new URL('./service-backup.mjs',import.meta.url).pathname,'check-source-inventory','--manifest-file',manifestPath,'--manifest-sha256',hash(manifestBytes),...flags],{env:{...process.env,...environment,...override},encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe']}))};}
 catch(e){assert(!String(e.stdout??'').includes(environment.DATABASE_URL));assert(!String(e.stderr??'').includes(source.password));return {ok:false};}
}
const snapshot=c=>collectServiceInventory(c,store,{migrationDirectory});
try{
 source=await backends.postgres('source');await migrate(source.pool,migrationDirectory);
 await source.pool.query('CREATE SEQUENCE synthetic_update_seq');await source.pool.query("CREATE TABLE synthetic_update_rows (id bigint PRIMARY KEY DEFAULT nextval('synthetic_update_seq'), value text NOT NULL)");await source.pool.query("INSERT INTO synthetic_update_rows(value) VALUES ('synthetic preserved row')");
 await mkdir(root+'/blobs',{mode:0o700});store=new FileBlobStore(root+'/blobs');const originalObject=Buffer.from('synthetic preserved object');await store.put('synthetic/objects/preserved',originalObject);
 const archive=root+'/archive',key=randomBytes(32);await createServiceBackup({pool:source.pool,store,destination:archive,encryptionKey:key,snapshot,dump:(path,id)=>backends.pgFile(source,path,'dump',id)});
 const verified=await verifyServiceBackup({source:archive,destination:root+'/authenticated',encryptionKey:key});key.fill(0);manifestPath=root+'/authenticated/manifest.json';manifestBytes=await readFile(manifestPath);
 environment={DATABASE_URL:`postgresql://postgres:${source.password}@127.0.0.1:${source.database.port}/postgres`,BLOB_ROOT:root+'/blobs',BACKUP_BLOB_BACKEND:'filesystem'};
 await step('actual encrypted authenticated backup matches two fresh source DB/blob snapshots',async()=>{const result=cli(['--quiesced']);assert(result.ok);assert.equal(result.value.backupId,verified.manifest.id);assert.equal(result.value.authenticatedManifestSha256,hash(manifestBytes));assert.equal(result.value.currentInventoryVerified,true);assert.equal(result.value.configurationVerified,false);assert.equal(result.value.preflightVerified,false);assert.equal(result.value.updateExecuted,false);assert(!JSON.stringify(result.value).includes('synthetic preserved'));});
 await step('missing quiescence acknowledgement refuses before observation',async()=>{assert.equal(cli().ok,false);});
 await step('tampered private authenticated manifest refuses pinned raw hash',async()=>{try{await writeFile(manifestPath,Buffer.concat([manifestBytes,Buffer.from(' ')]),{mode:0o600});assert.equal(cli(['--quiesced']).ok,false);}finally{await writeFile(manifestPath,manifestBytes,{mode:0o600});}});
 await step('committed source row change refuses and exact row restoration matches again',async()=>{try{await source.pool.query("UPDATE synthetic_update_rows SET value='synthetic changed row'");assert.equal(cli(['--quiesced']).ok,false);}finally{await source.pool.query("UPDATE synthetic_update_rows SET value='synthetic preserved row'");}assert(cli(['--quiesced']).ok);});
 await step('sequence-only state change refuses without a row change',async()=>{const state=(await source.pool.query('SELECT last_value::text,is_called FROM synthetic_update_seq')).rows[0];try{await source.pool.query("SELECT nextval('synthetic_update_seq')");assert.equal(cli(['--quiesced']).ok,false);}finally{await source.pool.query('SELECT setval($1::regclass,$2::bigint,$3)',['synthetic_update_seq',state.last_value,state.is_called]);}assert(cli(['--quiesced']).ok);});
 await step('changed unreferenced object bytes in a separate copied root refuse',async()=>{await mkdir(root+'/changed-blobs',{mode:0o700});const changed=new FileBlobStore(root+'/changed-blobs');await changed.put('synthetic/objects/preserved',Buffer.from('synthetic different object'));assert.equal(cli(['--quiesced'],{BLOB_ROOT:changed.root}).ok,false);assert.deepEqual(await store.get('synthetic/objects/preserved'),originalObject);assert(cli(['--quiesced']).ok);});
 await step('extra orphan in separate copied blob root refuses full inventory',async()=>{await mkdir(root+'/extra-blobs',{mode:0o700});const extra=new FileBlobStore(root+'/extra-blobs');await extra.put('synthetic/objects/preserved',originalObject);await extra.put('unknown/orphans/extra',Buffer.from('synthetic extra retained'));assert.equal(cli(['--quiesced'],{BLOB_ROOT:extra.root}).ok,false);});
 await step('busy exclusive maintenance fence refuses and is usable after unlock',async()=>{const c=await source.pool.connect();try{await c.query('SELECT pg_advisory_lock(82002)');assert.equal(cli(['--quiesced']).ok,false);}finally{await c.query('SELECT pg_advisory_unlock(82002)');c.release();}assert(cli(['--quiesced']).ok);});
 await step('foreign database identity cannot supply original source proof',async()=>{const foreign=await backends.postgres('foreign');assert.equal(cli(['--quiesced'],{DATABASE_URL:`postgresql://postgres:${foreign.password}@127.0.0.1:${foreign.database.port}/postgres`}).ok,false);});
 await step('final source inventory and original authenticated bytes remain exact',async()=>{assert.deepEqual(await readFile(manifestPath),manifestBytes);assert.deepEqual(await store.get('synthetic/objects/preserved'),originalObject);assert(cli(['--quiesced']).ok);});
 report={checks,manifestSha256:hash(manifestBytes),backupId:verified.manifest.id,sourceRetained:true,containersStoppedAndRetained:false,fullManagerPreflightVerified:false};
}finally{
 for(const pool of backends.pools)await pool.end().catch(()=>{});
 for(const name of backends.containers){assert.equal(backends.run(['inspect','--format','{{index .Config.Labels "exhibitos.service.backup.test"}}',name]),backends.owner);backends.stop(name);}
 // All synthetic containers, archives, blobs and evidence remain; no volume deletion.
}

report.containersStoppedAndRetained=true;await writeFile(root+'/source-inventory-report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({report:root+'/source-inventory-report.json',checks:checks.length}));
