// SPDX-License-Identifier: AGPL-3.0-or-later
// Explicit synthetic database only. This is not Manager/EXB qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {FileBlobStore,transaction,collectServiceInventory} from '../packages/storage/dist/index.js';
import {WorkspaceFurnishingIntakes} from '../apps/api/dist/workspace-furnishing-intakes.js';
const url=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(url.hostname!=='127.0.0.1'||!/^\/exhibitos_frame_test_[a-z0-9]+$/.test(url.pathname))throw Error('DISPOSABLE_FRAME_DATABASE_REQUIRED');
const input=process.env.EXHIBITOS_FRAME_PREPARATION_INPUT_DIR;if(!input)throw Error('FRAME_SOURCE_DIRECTORY_REQUIRED');
const pool=new Pool({connectionString:url.href,max:3,statement_timeout:15000}),root=await mkdtemp(join(tmpdir(),'frame-intake-'));
const workspaceId=randomUUID(),tenantId=randomUUID(),principalId=randomUUID(),owner={workspaceId,tenantId,principalId,workspaceFurnishingStool:true,workspaceFurnishingRoomVisual:true,workspaceFurnishingArtworkFrame:true,workspaceFurnishingArtworkFrameModels:true,workspaceArtworkFramePreparation:true,assertDatabase:async()=>{}},session={id:randomUUID(),tenantId,userId:principalId,role:'admin'},rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},blobs=new FileBlobStore(root),service=new WorkspaceFurnishingIntakes(blobs,owner);
const hash=b=>createHash('sha256').update(b).digest('hex'),call=fn=>transaction(pool,c=>fn(c));
try{
 await pool.query('CREATE TABLE local_workspaces(id uuid NOT NULL,tenant_id uuid NOT NULL,user_id uuid NOT NULL,PRIMARY KEY(id,tenant_id,user_id)); CREATE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'immutable\'; END $$');
 await pool.query(await readFile(new URL('../database/native-workspace-furnishing/036_workspace_furnishing.sql',import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('../database/native-workspace-frame-preparation/041_workspace_frame_preparation.sql',import.meta.url),'utf8'));
 await pool.query('INSERT INTO local_workspaces VALUES($1,$2,$3)',[workspaceId,tenantId,principalId]);
 await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL)');
 const catalog=[];for(const path of ['../database/native-workspace-furnishing/036_workspace_furnishing.sql','../database/native-workspace-frame-preparation/041_workspace_frame_preparation.sql']){const bytes=await readFile(new URL(path,import.meta.url)),name=path.split('/').at(-1),sha256=hash(bytes);catalog.push({name,sha256});await pool.query('INSERT INTO schema_migrations VALUES($1,$2)',[name,sha256]);}

 await test('exact source preparation registers one immutable binding and reopens the result',async()=>{
  for(const id of ['black-aluminum-frame','brushed-silver-frame','natural-oak-flat-frame']){
   const source=await readFile(join(input,id,'visual.glb')),expected=await readFile(new URL(`../apps/api/test-fixtures/${id}-tangent-r1/model.glb`,import.meta.url));
   const declaration={requestId:randomUUID(),kind:'artwork-frame',name:id,rights,provenance:'Synthetic isolated integration',model:{mime:'model/gltf-binary',bytes:source.length,sha256:hash(source)},preparationPolicy:'omit-unused-invalid-tangent-r1'};
   const first=await call(c=>service.create(c,session,declaration));assert.deepEqual(await call(c=>service.create(c,session,declaration)),first);
   await assert.rejects(call(c=>service.create(c,session,{...declaration,name:'conflict'})),{code:'IDEMPOTENCY_CONFLICT'});
   await call(c=>service.upload(c,session,first.intakeId,source));await call(c=>service.complete(c,session,first.intakeId));assert.equal(await service.work(pool),true);
   const ready=await call(c=>service.read(c,session,first.intakeId));assert.equal(ready.phase,'registered');assert.equal(ready.preparation.sourceModel.sha256,hash(source));assert.equal(ready.preparation.renderableModel.sha256,hash(expected));assert.equal(ready.furnishing.model.sha256,hash(expected));assert.equal(ready.furnishing.preparationPolicy,undefined);
   assert.deepEqual((await call(c=>service.model(c,session,ready.furnishing.id,1,'display'))).bytes,expected);
   const records=await pool.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[first.intakeId]);assert.equal(records.rowCount,1);assert.equal(records.rows[0].state,'registered');assert.deepEqual(Buffer.from(await blobs.get(records.rows[0].source_key)),source);
   await assert.rejects(pool.query('DELETE FROM workspace_frame_preparations WHERE intake_id=$1',[first.intakeId]),/immutable/);assert.deepEqual(await call(c=>service.create(c,session,declaration)),ready);
  }
 });
 await test('refuses unsupported source and rights and recovers an interrupted staged write',async()=>{
  const source=await readFile(join(input,'black-aluminum-frame','visual.glb'));
  const base={requestId:randomUUID(),kind:'artwork-frame',name:'recovery',rights,provenance:'Synthetic isolated recovery',model:{mime:'model/gltf-binary',bytes:source.length,sha256:hash(source)},preparationPolicy:'omit-unused-invalid-tangent-r1'};
  await assert.rejects(call(c=>service.create(c,session,{...base,model:{...base.model,sha256:'0'.repeat(64)}})),{code:'FRAME_PREPARATION_SOURCE_UNSUPPORTED'});
  await assert.rejects(call(c=>service.create(c,session,{...base,rights:{...rights,holder:'Another'}})),{code:'FRAME_PREPARATION_RIGHTS_DENIED'});
  const first=await call(c=>service.create(c,session,base));await call(c=>service.upload(c,session,first.intakeId,source));await call(c=>service.complete(c,session,first.intakeId));
  let injected=false;const faulty={get:(...args)=>blobs.get(...args),remove:(...args)=>blobs.remove(...args),put:(...args)=>blobs.put(...args),putDurable:async(key,bytes)=>{if(!injected){injected=true;throw Error('injected write interruption');}return blobs.putDurable(key,bytes);}};
  const interrupted=new WorkspaceFurnishingIntakes(faulty,owner);await interrupted.work(pool);
  const failed=await call(c=>service.read(c,session,first.intakeId));assert.equal(failed.phase,'failed');assert.equal(failed.retryable,true);assert.equal(failed.error.code,'FURNISHING_VALIDATION_UNAVAILABLE');
  let stage=await pool.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[first.intakeId]);assert.equal(stage.rows[0].state,'staged');assert.deepEqual(Buffer.from(await blobs.get(stage.rows[0].source_key)),source);
  const pendingInventory=await call(c=>collectServiceInventory(c,blobs,{migrationCatalog:catalog}));assert.ok(pendingInventory.issues.some(issue=>issue.code==='FRAME_PREPARATION_UNSETTLED'));
  await call(c=>service.retry(c,session,first.intakeId));await service.work(pool);const done=await call(c=>service.read(c,session,first.intakeId));assert.equal(done.phase,'registered');
  stage=await pool.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[first.intakeId]);assert.equal(stage.rowCount,1);assert.equal(stage.rows[0].state,'registered');
 });
 await test('cancel after interruption removes only the staged copy and preserves the caller source',async()=>{
  const source=await readFile(join(input,'black-aluminum-frame','visual.glb')),before=Buffer.from(source);
  const declaration={requestId:randomUUID(),kind:'artwork-frame',name:'cancel',rights,provenance:'Synthetic isolated cancellation',model:{mime:'model/gltf-binary',bytes:source.length,sha256:hash(source)},preparationPolicy:'omit-unused-invalid-tangent-r1'};
  const first=await call(c=>service.create(c,session,declaration));await call(c=>service.upload(c,session,first.intakeId,source));await call(c=>service.complete(c,session,first.intakeId));
  const faulty={get:(...args)=>blobs.get(...args),remove:(...args)=>blobs.remove(...args),put:(...args)=>blobs.put(...args),putDurable:async()=>{throw Error('injected write interruption');}};
  await new WorkspaceFurnishingIntakes(faulty,owner).work(pool);await call(c=>service.cancel(c,session,first.intakeId));await service.work(pool);
  assert.equal((await call(c=>service.read(c,session,first.intakeId))).phase,'cancelled');assert.equal((await pool.query('SELECT 1 FROM workspace_frame_preparations WHERE intake_id=$1',[first.intakeId])).rowCount,0);
  assert.deepEqual(await readFile(join(input,'black-aluminum-frame','visual.glb')),before);
 });
 await test('inventory binds both retained objects and refuses a corrupt source or binding',async()=>{
  const inspect=()=>call(c=>collectServiceInventory(c,blobs,{migrationCatalog:catalog}));
  const baseline=await inspect();assert.deepEqual(baseline.issues,[]);
  const record=(await pool.query("SELECT * FROM workspace_frame_preparations WHERE state='registered' ORDER BY intake_id LIMIT 1")).rows[0];
  const sourcePath=join(root,record.source_key),source=await readFile(sourcePath),damaged=Buffer.from(source);damaged[damaged.length-1]^=1;
  await writeFile(sourcePath,damaged);try{assert.ok((await inspect()).issues.some(issue=>issue.code==='OBJECT_HASH'));}finally{await writeFile(sourcePath,source);}
  const prior=(await pool.query('SELECT declaration FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND id=$2',[workspaceId,record.intake_id])).rows[0].declaration;
  const tamper="UPDATE workspace_furnishing_intakes SET declaration=jsonb_set(declaration,'{name}',to_jsonb('changed'::text)) WHERE workspace_id=$1 AND id=$2";
  await assert.rejects(pool.query(tamper,[workspaceId,record.intake_id]),/immutable/);
  await pool.query('ALTER TABLE workspace_furnishing_intakes DISABLE TRIGGER workspace_frame_preparation_intake_immutable');
  try{await pool.query(tamper,[workspaceId,record.intake_id]);assert.ok((await inspect()).issues.some(issue=>issue.code==='FRAME_PREPARATION_BINDING_INVALID'));}finally{await pool.query('UPDATE workspace_furnishing_intakes SET declaration=$3 WHERE workspace_id=$1 AND id=$2',[workspaceId,record.intake_id,prior]);await pool.query('ALTER TABLE workspace_furnishing_intakes ENABLE TRIGGER workspace_frame_preparation_intake_immutable');}
  assert.deepEqual((await inspect()).issues,[]);
 });
}finally{await pool.end();await rm(root,{recursive:true,force:true});}
