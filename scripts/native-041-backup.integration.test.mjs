// SPDX-License-Identifier: AGPL-3.0-or-later
// Two explicitly named synthetic databases only; this does not qualify Manager.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import {constants,openSync,closeSync,fstatSync} from 'node:fs';
import {acceptFurnishingWriterLease} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {FileBlobStore,migrate} from '../packages/storage/dist/index.js';
import {main,inventorySnapshotOptionsForDatabase} from './service-backup.mjs';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {WorkspaceFurnishingIntakes} from '../apps/api/dist/workspace-furnishing-intakes.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {transaction,sha256} from '../packages/storage/dist/index.js';
const sourceUrl=new URL(process.env.EXHIBITOS_BACKUP_SOURCE_URL??'invalid://missing'),targetUrl=new URL(process.env.EXHIBITOS_BACKUP_TARGET_URL??'invalid://missing');
if(sourceUrl.hostname!=='127.0.0.1'||targetUrl.hostname!=='127.0.0.1'||sourceUrl.pathname!=='/exhibitos_backup_source_fixture'||targetUrl.pathname!=='/exhibitos_backup_target_fixture'||sourceUrl.href===targetUrl.href)throw Error('DISPOSABLE_BACKUP_DATABASES_REQUIRED');
const pgbin=process.env.EXHIBITOS_BACKUP_PG_BIN;if(!pgbin?.startsWith('/'))throw Error('BACKUP_PG_BIN_REQUIRED');
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-catalog040-backup-'))),sourceStore=new FileBlobStore(join(root,'blobs')),targetStore=new FileBlobStore(join(root,'target'));
await mkdir(sourceStore.root,{mode:0o700});await mkdir(targetStore.root,{mode:0o700});
const source=new Pool({connectionString:sourceUrl.href}),target=new Pool({connectionString:targetUrl.href});
const lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(lock,constants.O_RDWR);}const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),rootStat=fstatSync(rootFd,{bigint:true}),lockStat=fstatSync(fd,{bigint:true});closeSync(rootFd);
const base=new URL('../database/migrations/',import.meta.url).pathname,normal=new URL('../database/native-oex-normal/',import.meta.url).pathname;
const supplemental=[['native-oex-normal','026_oex_file_profile.sql'],['native-oex-normal','027_oex_exhibition_provenance.sql'],['native-oex-normal','028_oex_material_catalogue.sql'],['native-oex-normal','029_oex_quiet_oak_floor.sql'],['native-oex-normal','030_oex_concrete_surface.sql'],['native-oex-normal','031_workspace_material.sql'],['native-oex-normal','032_oex_workspace_material.sql'],['native-oex-workspace-import','033_workspace_material_import_provenance.sql'],['native-oex-workspace-import','034_workspace_material_terminal_proof.sql'],['native-oex-workspace-import-wall','035_workspace_material_wall_import.sql'],['native-workspace-furnishing','036_workspace_furnishing.sql'],['native-workspace-furnishing-writer','037_workspace_furnishing_writer_generation.sql'],['native-workspace-furnishing-publication','038_workspace_furnishing_publication.sql'],['native-workspace-material-publication','039_workspace_material_publication.sql'],['native-workspace-material-multimap','040_workspace_material_multimap.sql'],['native-workspace-frame-preparation','041_workspace_frame_preparation.sql']];
try{
 await test('catalog 041 preserves prepared source and renderable through encrypted backup and restore',async()=>{
  const {createHash}=await import('node:crypto');await migrate(source,base);
  for(const [dir,name] of supplemental){const bytes=await readFile(new URL(`../database/${dir}/${name}`,import.meta.url));await source.query('BEGIN');try{await source.query(bytes.toString('utf8'));await source.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,createHash('sha256').update(bytes).digest('hex')]);await source.query('COMMIT');}catch(e){await source.query('ROLLBACK');throw e;}}
  await source.query("CREATE TABLE synthetic_backup_sample(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO synthetic_backup_sample VALUES(1,'retained')");
  const blob=Buffer.from('synthetic 040 retained blob');await sourceStore.put('synthetic/objects/example',blob);
  const token=()=>randomBytes(32).toString('base64url'),ws={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:token(),csrfToken:token()};
  await openLocalWorkspace(source,ws,'native');const session={id:randomUUID(),tenantId:ws.tenantId,userId:ws.principalId,role:'admin'},owner={workspaceId:ws.workspaceId,tenantId:ws.tenantId,principalId:ws.principalId,workspaceFurnishingStool:true,workspaceFurnishingRoomVisual:true,workspaceFurnishingArtworkFrame:true,workspaceFurnishingArtworkFrameModels:true,workspaceArtworkFramePreparation:true,assertDatabase:async()=>{}};
  const secret=Buffer.alloc(32,9),scope={workspaceId:ws.workspaceId,tenantId:ws.tenantId,principalId:ws.principalId,runtimeGeneration:randomUUID(),mode:'workspace-furnishing-036-initialize-v1'},fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),lockDevice:String(lockStat.dev),lockInode:String(lockStat.ino)};
  let open=true;const channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{open=false;}};
  const writer=await acceptFurnishingWriterLease({channel,secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:sourceStore.root,configRoot:join(root,'config')});
  const service=new WorkspaceFurnishingIntakes(sourceStore,owner,writer),input=process.env.EXHIBITOS_FRAME_PREPARATION_INPUT_DIR;if(!input)throw Error('FRAME_SOURCE_DIRECTORY_REQUIRED');
  const original=await readFile(join(input,'black-aluminum-frame','visual.glb')),declaration={requestId:randomUUID(),kind:'artwork-frame',name:'prepared',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},provenance:'Synthetic backup source',model:{mime:'model/gltf-binary',bytes:original.length,sha256:sha256(original)},preparationPolicy:'omit-unused-invalid-tangent-r1'};
  const call=fn=>transaction(source,c=>fn(c)),intake=await call(c=>service.create(c,session,declaration));await call(c=>service.upload(c,session,intake.intakeId,original));await call(c=>service.complete(c,session,intake.intakeId));await service.work(source);const ready=await call(c=>service.read(c,session,intake.intakeId));assert.equal(ready.phase,'registered');
  const binding=(await source.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[intake.intakeId])).rows[0];

  const key=join(root,'key.bin'),archive=join(root,'archive'),verified=join(root,'verified'),restored=join(root,'restored');
  const env=(url,store)=>({DATABASE_URL:url.href,BLOB_ROOT:store.root,BACKUP_BLOB_BACKEND:'filesystem',PG_DUMP_BIN:join(pgbin,'pg_dump'),PG_RESTORE_BIN:join(pgbin,'pg_restore')});
  await main(['key-init','--key-file',key],{});
  assert.equal((await main(['create','--key-file',key,'--destination',archive,'--quiesced'],env(sourceUrl,sourceStore))).operation,'created');
  assert.equal((await main(['verify','--key-file',key,'--source',archive,'--destination',verified],{})).operation,'verified');
  assert.equal((await main(['restore','--key-file',key,'--source',archive,'--destination',restored,'--quiesced','--fresh-destination'],env(targetUrl,targetStore))).operation,'restored-and-verified');
  for(const pool of [source,target]){const rows=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;assert.equal(rows.length,41);assert.equal(rows[40].name,'041_workspace_frame_preparation.sql');assert.deepEqual((await inventorySnapshotOptionsForDatabase(pool,base,normal,rows)).migrationCatalog,rows);assert.deepEqual((await pool.query('SELECT * FROM synthetic_backup_sample')).rows,[{id:1,value:'retained'}]);}
  assert.deepEqual(Buffer.from(await targetStore.get('synthetic/objects/example')),blob);
  const recovered=(await target.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[intake.intakeId])).rows[0];assert.equal(recovered.state,'registered');assert.equal(recovered.source_sha256,binding.source_sha256);assert.equal(recovered.renderable_sha256,binding.renderable_sha256);
  assert.deepEqual(Buffer.from(await targetStore.get(recovered.source_key)),original);assert.equal(sha256(await targetStore.get(recovered.renderable_key)),ready.preparation.renderableModel.sha256);

 });
}finally{await source.end();await target.end();closeSync(fd);for(const n of extra)closeSync(n);await rm(root,{recursive:true,force:true});}
