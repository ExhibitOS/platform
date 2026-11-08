// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {FileBlobStore,migrate,transaction,sha256} from '@exhibitos/storage';
import {Imports} from './imports.ts';
import {Cms,validMetadata} from './cms.ts';
import type {Session} from './auth.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {rowObjectReferences} from '../../../packages/storage/dist/service-inventory.js';
// This test isolates the real DB/job/approval transaction from the separately
// measured actual child producer. It is NOT native ownership qualification.
vi.mock('./oam-original-preparation-process.ts',()=>({prepareCompactModelInWorker:async(source:Buffer,identity:{sha256:string;bytes:number})=>{
 const folder=process.env.EXHIBITOS_COMPACT_VARIANT_RETAINED??process.env.EXHIBITOS_COMPACT_VARIANT_EVIDENCE!;
 const result=JSON.parse(await readFile(join(folder,'producer.json'),'utf8'));
 expect(sha256(source)).toBe(identity.sha256);expect(result.receipt.source.sha256).toBe(identity.sha256);expect(source.length).toBe(result.receipt.source.bytes);
 return {...result,bytes:await readFile(join(folder,'candidate.glb'))};
}}));
it.skipIf(!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL||!process.env.EXHIBITOS_COMPACT_VARIANT_EVIDENCE)('prepares and explicitly approves a same-owner full/coarse revision with real PostgreSQL custody and replay',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL}),tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID(),fullId=randomUUID(),rightsId=randomUUID(),otherUser=randomUUID();
 const evidence=process.env.EXHIBITOS_COMPACT_VARIANT_EVIDENCE!,full=await readFile(process.env.EXHIBITOS_COMPACT_VARIANT_SOURCE!),producer=JSON.parse(await readFile(join(process.env.EXHIBITOS_COMPACT_VARIANT_RETAINED??evidence,'producer.json'),'utf8')).receipt;
 const blobs=new FileBlobStore(await mkdtemp(join(tmpdir(),'compact-variant-'))),execution=createServiceModelPreparationExecution(blobs,()=>true),importer=new Imports(pool,blobs,undefined,execution),cms=new Cms(blobs),session={tenantId,userId,role:'admin'} as Session;
 const run=<T>(f:(c:import('pg').PoolClient)=>Promise<T>)=>transaction(pool,f),key=`${tenantId}/approved/${sha256(full)}`;
 const rights={holder:'Isolated component fixture',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Private component fixture'};
 const metadata={title:'Approved model fixture',description:'No public adoption',dimensions:{width:.6,height:1,depth:.4,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'unknown',scaleApplied:false,notes:'Uncalibrated retained full'},displayReference:{version:1,status:'provisional-uncalibrated',assetSha256:sha256(full),rawBounds:producer.source.bounds,referenceHeightMeters:1,pose:{position:[0,0,0],rotation:[0,0,0,1],scale:Array(3).fill(1/(producer.source.bounds.max[1]-producer.source.bounds.min[1]))}}};
 expect(validMetadata(metadata)).toBe(true);
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);await migrate(pool,new URL('../../../database/native-model-preparation/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'compact variant isolated']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2),($3,$4)',[userId,randomUUID(),otherUser,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'admin')",[tenantId,userId,otherUser]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Fixture artist'}]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,artworkId,artistId,metadata]);await pool.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,artworkId,metadata]);
  await blobs.put(key,full);await pool.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,rights]);await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'approved')",[tenantId,fullId,artworkId,rightsId,key,sha256(full),full.length]);
  const snapshot={metadata,asset:{id:fullId,sha256:sha256(full),bytes:full.length,mime:'model/gltf-binary',rightsRevision:1}};
  await pool.query('INSERT INTO artwork_approvals VALUES($1,$2,1,$3,$4,now())',[tenantId,artworkId,fullId,snapshot]);await pool.query('UPDATE artworks SET approved_revision=1,approved_asset_id=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId,fullId]);
  const before=(await run(c=>cms.studioArtwork(c,session,artworkId))).artwork,request={revision:1,assetId:fullId,sha256:sha256(full),bytes:full.length,idempotencyKey:randomUUID(),generation:'saved-generation-1'};
  await expect(run(c=>new Imports(pool,blobs).createCompact(c,session,artworkId,request))).rejects.toMatchObject({code:'MODEL_PREPARATION_UNAVAILABLE'});
  const pending=await run(c=>importer.createCompact(c,session,artworkId,request)),id=String(pending.id);expect(pending.state).toBe('queued');expect(pending.assetId).toBeUndefined();expect(pending.modelPreparation).toMatchObject({purpose:'approved-full-compact',sourceFull:{assetId:fullId}});expect(pending.modelPreparation).not.toHaveProperty('original');
  expect((await run(c=>importer.createCompact(c,session,artworkId,request))).id).toBe(id);
  await expect(run(c=>importer.createCompact(c,session,artworkId,{...request,generation:'different'}))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  await expect(run(c=>importer.createCompact(c,session,artworkId,{...request,idempotencyKey:randomUUID()}))).rejects.toMatchObject({code:'MODEL_PREPARATION_ACTIVE_IMPORT'});
  await expect(run(c=>cms.approveCompact(c,session,artworkId,{revision:1,jobId:id}))).rejects.toMatchObject({code:'WORKER_DRAIN_UNCONFIRMED'});
  expect(await new Imports(pool,blobs,undefined,execution).work()).toBe(true);
  const ready=await run(async c=>importer.view(await importer.access(c,session,id)));expect(ready.modelPreparation).toMatchObject({status:'ready',workerDrained:true,sourceFull:{assetId:fullId}});expect(ready.modelPreparation).not.toHaveProperty('original');
  const row=(await pool.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0],receipt=row.model_preparation.result;
  await writeFile(join(evidence,'typed-variant-ready.json'),JSON.stringify(ready,null,2)+'\n');
  expect(rowObjectReferences('import_jobs',row).issues).toEqual([]);expect(rowObjectReferences('import_jobs',row).references.find(r=>r.binding.endsWith(':approved-compact-variant'))).toMatchObject({expectedBytes:receipt.coarse.bytes,expectedSha256:receipt.coarse.sha256});
  expect((await pool.query('SELECT approved_revision,approved_asset_id FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId])).rows[0]).toEqual({approved_revision:1,approved_asset_id:fullId});
  await expect(run(c=>importer.access(c,{...session,userId:otherUser},id))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(run(c=>cms.approve(c,session,artworkId,{revision:1,assetId:receipt.coarse.assetId}))).rejects.toMatchObject({code:'COMPACT_VARIANT_EXPLICIT_APPROVAL_REQUIRED'});
  const approved=await run(c=>cms.approveCompact(c,session,artworkId,{revision:1,jobId:id}));expect(approved.revision).toBe(2);
  expect(await run(c=>cms.approveCompact(c,session,artworkId,{revision:1,jobId:id}))).toEqual(approved);expect((await run(c=>importer.createCompact(c,session,artworkId,request))).id).toBe(id);
  const after=(await run(c=>new Cms(blobs).studioArtwork(c,session,artworkId))).artwork;
  expect(after.primaryAssetId).toBe(fullId);expect(after.assets).toHaveLength(2);expect(after.transform).toEqual(before.transform);expect(after.dimensions).toEqual(before.dimensions);expect(after.units).toBe(before.units);expect(after.rights).toEqual(before.rights);expect(after.extensions?.['org.exhibitos.studio/display-reference']).toEqual(before.extensions?.['org.exhibitos.studio/display-reference']);expect(after.extensions?.['org.exhibitos.viewer/lod']).toMatchObject({profile:'exhibitos-budget-geometry-pair-v1'});
  expect((await pool.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=1',[tenantId,artworkId])).rows[0].snapshot).toEqual(snapshot);expect(sha256(await blobs.get(key))).toBe(sha256(full));expect((await pool.query('SELECT state FROM assets WHERE tenant_id=$1 AND id=$2',[tenantId,fullId])).rows[0].state).toBe('approved');
  await run(async c=>{await c.query('SAVEPOINT tamper');await c.query("UPDATE asset_derivatives SET metadata=jsonb_set(metadata,'{serverReceipt,coarse,bytes}','1') WHERE tenant_id=$1 AND asset_id=$2",[tenantId,fullId]);await expect(importer.access(c,session,id)).rejects.toMatchObject({code:'COMPACT_VARIANT_CONTEXT_CHANGED'});await c.query('ROLLBACK TO SAVEPOINT tamper');});
 }finally{await pool.end();}
},30000);
