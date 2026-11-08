// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {revisionHash,validateLifecycle} from '@exhibitos/spec';
import {FileBlobStore,migrate,transaction,sha256} from '@exhibitos/storage';
import {pngCrc} from './png-pixels.ts';
import {Imports,type ImportInput} from './imports.ts';
import {Cms} from './cms.ts';
import type {Session} from './auth.ts';
import {assertRequiredModelApproval} from './model-preparation-approval.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {collectServiceInventory,rowObjectReferences} from '../../../packages/storage/dist/service-inventory.js';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {replaceApprovedArtwork,resolveApprovedModelCandidate} from './artwork-replacement.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {Studio} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';

function fixture(colour=192,width=1){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(width,4);ihdr[8]=8;ihdr[9]=2;
 const pixels=Buffer.alloc(width*(1+width*3));for(let y=0;y<width;y++)for(let x=0;x<width;x++){const at=y*(1+width*3)+1+x*3;pixels[at]=colour;pixels[at+1]=40;pixels[at+2]=80;}
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint32Array([0,1,2]).buffer),image];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part] of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const pad=(4-length%4)%4;blocks.push(Buffer.alloc(pad));length+=pad;}
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9729,wrapS:10497,wrapT:10497}],images:[{bufferView:4,mimeType:'image/png'}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5125,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:length}]};
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const out=Buffer.alloc(28+json.length+length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);Buffer.concat(blocks).copy(out,28+json.length);return out;
}
it.skipIf(!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL)('runs ordinary required import, immutable custody, explicit approval and failure/drain on isolated PostgreSQL',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL}),tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID(),otherUser=randomUUID();
 const root=await mkdtemp(join(tmpdir(),'model-preparation-')),blobs=new FileBlobStore(root),execution=createServiceModelPreparationExecution(blobs,()=>true),importer=new Imports(pool,blobs,undefined,execution),session={tenantId,userId,role:'admin'} as Session;
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic'},metadata={title:'Synthetic model',description:'Declared synthetic geometry',dimensions:{width:1,height:1,depth:.05,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:true,notes:''}};
 const run=<T>(fn:(c:import('pg').PoolClient)=>Promise<T>)=>transaction(pool,fn),state=async(id:string)=>run(async c=>importer.view(await importer.access(c,session,id)));
 try{
  const migrations=['migrations','native-oex-normal','native-model-preparation'].map(name=>new URL(`../../../database/${name}/`,import.meta.url).pathname);
  for(const directory of migrations)await migrate(pool,directory);
  const migrationCatalog=(await Promise.all(migrations.map(async dir=>Promise.all((await readdir(dir)).filter(n=>n.endsWith('.sql')).map(async name=>({name,sha256:sha256(await readFile(join(dir,name)))})))))).flat().sort((a,b)=>a.name.localeCompare(b.name));
  const inventory=()=>run(async c=>{await c.query('SELECT pg_advisory_xact_lock(82002)');return collectServiceInventory(c,blobs,{migrationCatalog});});
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated required model']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2),($3,$4)',[userId,randomUUID(),otherUser,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'admin')",[tenantId,userId,otherUser]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic artist'}]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,artworkId,artistId,metadata]);await pool.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,artworkId,metadata]);
  let inputRevision=1;
  const input=(bytes:Buffer):ImportInput=>{const id=randomUUID();return {artworkId,idempotencyKey:id,mime:'model/gltf-binary',sha256:sha256(bytes),bytes:bytes.length,scaleMeters:1,rights,modelPreparation:{version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:id,generation:'persisted-transfer-generation',artworkRevision:inputRevision}};};
  const reserved={...input(Buffer.from('descriptor only')),sha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',bytes:8383096};await expect(run(c=>importer.create(c,session,reserved))).rejects.toMatchObject({code:'MODEL_PREPARATION_DEDICATED_ROUTE_REQUIRED'});expect((await pool.query('SELECT count(*)::int AS n FROM import_jobs')).rows[0].n).toBe(0);
  const source=fixture(192,640),request=input(source);await expect(run(c=>new Imports(pool,blobs).create(c,session,request))).rejects.toMatchObject({code:'MODEL_PREPARATION_UNAVAILABLE'});const created=await run(c=>importer.create(c,session,request)),id=String(created.id);expect(created.assetId).toBeUndefined();
  await expect(run(c=>importer.create(c,session,input(fixture(111))))).rejects.toMatchObject({code:'MODEL_PREPARATION_ACTIVE_IMPORT'});expect((await pool.query('SELECT count(*)::int AS n FROM import_jobs')).rows[0].n).toBe(1);
  expect((await run(c=>importer.create(c,session,request))).id).toBe(id);await expect(run(c=>importer.create(c,session,{...request,scaleMeters:2}))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  await expect(run(c=>importer.access(c,{...session,userId:otherUser},id))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(run(c=>importer.upload(c,session,id,source.subarray(1)))).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});await run(c=>importer.upload(c,session,id,source));await run(c=>importer.upload(c,session,id,source));await run(c=>importer.complete(c,session,id));
  // Durable queued state is consumed by a fresh service instance; no new upload.
  expect(await new Imports(pool,blobs).work()).toBe(false);const inactive=new Imports(pool,blobs,undefined,createServiceModelPreparationExecution(blobs,()=>false));expect(await inactive.work()).toBe(false);expect((await state(id)).state).toBe('queued');
  const reopened=new Imports(pool,blobs,undefined,execution);expect(await reopened.work()).toBe(true);const ready=await state(id);expect(ready.modelPreparation).toMatchObject({status:'ready',workerDrained:true,display:{reusedOriginal:false}});const receipt=ready.modelPreparation&&'serverReceipt' in ready.modelPreparation?ready.modelPreparation.serverReceipt:undefined;expect(receipt).toBeDefined();if(!receipt||!('original' in receipt))throw Error('missing ordinary original receipt');
  // Preserve successful product result before remaining evidence assertions.
  const evidence=process.env.EXHIBITOS_MODEL_TEST_EVIDENCE;if(evidence)await writeFile(join(evidence,'typed-ready-fixture.json'),JSON.stringify(ready,null,2)+'\n');
  expect(receipt.original.assetId).not.toBe(receipt.display.assetId);expect(receipt.display.assetId).toBe(ready.assetId);expect(receipt.original.sha256).toBe(sha256(source));const row=(await pool.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];expect(Buffer.from(await blobs.get(row.object_key)).equals(source)).toBe(true);
  const firstInventory=await inventory();expect(firstInventory.issues).toEqual([]);expect(firstInventory.references.find(r=>r.binding.endsWith(':approved-model'))).toMatchObject({expectedBytes:receipt.display.bytes,expectedSha256:receipt.display.sha256});expect(rowObjectReferences('import_jobs',{...row,approved_key:row.object_key}).issues).toContainEqual(expect.objectContaining({code:'INVALID_REQUIRED_MODEL_IMPORT'}));
  await run(async c=>{await c.query('SAVEPOINT corrupt_lineage');await c.query("UPDATE asset_derivatives SET metadata=jsonb_set(metadata,'{serverReceipt,producer,output,bytes}','1') WHERE tenant_id=$1 AND asset_id=$2",[tenantId,receipt.original.assetId]);await expect(importer.create(c,session,request)).rejects.toMatchObject({code:'MODEL_PREPARATION_RECEIPT_INVALID'});await c.query('ROLLBACK TO SAVEPOINT corrupt_lineage');});
  expect((await run(c=>importer.complete(c,session,id))).assetId).toBe(ready.assetId);expect(await importer.work()).toBe(false);expect((await pool.query('SELECT count(*)::int AS count FROM assets WHERE tenant_id=$1',[tenantId])).rows[0].count).toBe(2);
  expect((await pool.query('SELECT approved_revision FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId])).rows[0].approved_revision).toBeNull();
  const token=randomUUID();await pool.query('UPDATE import_jobs SET png_worker_tokens=ARRAY[$3::uuid] WHERE tenant_id=$1 AND id=$2',[tenantId,id,token]);expect((await state(id)).assetId).toBeUndefined();expect((await inventory()).issues).toContainEqual(expect.objectContaining({code:'MODEL_PREPARATION_WORKER_DRAIN_UNCONFIRMED'}));await expect(run(c=>assertRequiredModelApproval(c,session,artworkId,String(ready.assetId)))).rejects.toMatchObject({code:'WORKER_DRAIN_UNCONFIRMED'});await pool.query("UPDATE import_jobs SET png_worker_tokens='{}' WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
  await run(async c=>{await c.query('SAVEPOINT competing_approval');const otherAsset=randomUUID();await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) SELECT tenant_id,$3,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state FROM assets WHERE tenant_id=$1 AND id=$2",[tenantId,ready.assetId,otherAsset]);await expect(new Cms(blobs).approve(c,session,artworkId,{revision:1,assetId:otherAsset})).rejects.toMatchObject({code:'MODEL_PREPARATION_ACTIVE_IMPORT'});await c.query('ROLLBACK TO SAVEPOINT competing_approval');});
  // Actual CMS approval and direct API create share the artwork lock. A create
  // already waiting on approval must re-read the committed approved revision.
  const approving=await pool.connect(),creating=await pool.connect();
  try{
   await approving.query('BEGIN');await creating.query('BEGIN');
   const approvalPid=(await approving.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,createPid=(await creating.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   await new Cms(blobs).approve(approving,session,artworkId,{revision:1,assetId:String(ready.assetId)});
   const pending=importer.create(creating,session,input(fixture(91))).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
   await expect.poll(async()=>(await pool.query('SELECT pg_blocking_pids($1) AS pids',[createPid])).rows[0].pids,{timeout:2000}).toContain(approvalPid);
   await approving.query('COMMIT');expect((await pending).error).toMatchObject({code:'MODEL_PREPARATION_REVISION_APPROVED'});
  }finally{await approving.query('ROLLBACK');await creating.query('ROLLBACK');approving.release();creating.release();}
  expect((await pool.query('SELECT count(*)::int AS n FROM import_jobs')).rows[0].n).toBe(1);
  await expect(run(c=>importer.create(c,session,input(fixture(92))))).rejects.toMatchObject({code:'MODEL_PREPARATION_REVISION_APPROVED'});
  expect((await run(c=>importer.create(c,session,request))).id).toBe(id);
  expect((await pool.query('SELECT approved_asset_id FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId])).rows[0].approved_asset_id).toBe(ready.assetId);

  // Consume the generated candidate in a real draft transaction. Only the
  // native host binding is synthetic; the model job, CMS approval and bytes are real.
  const workspace={workspaceId:randomUUID(),tenantId,principalId:userId,assertDatabase:async()=>{},assertRecord:async()=>{}} as unknown as NativeOexWorkspaceContext;
  const studio=new Studio(workspace,true),cms=new Cms(blobs),nativeImports=new Imports(pool,blobs,workspace);
  vi.spyOn(nativeImports,'requiredModelReady').mockImplementation((c,s)=>importer.requiredModelReady(c,s));
  const oldArtworkId=randomUUID(),oldAssetId=randomUUID(),oldRightsId=randomUUID(),oldBytes=fixture(30),oldHash=sha256(oldBytes),oldKey=`${tenantId}/approved/${oldHash}`;
  const oldMetadata={...metadata,title:'Previous model'};
  await blobs.put(oldKey,oldBytes);
  const prior=await run(async c=>{
   await c.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,oldArtworkId,artistId,oldMetadata]);
   await c.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,oldArtworkId,oldMetadata]);
   await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,oldRightsId,rights]);
   await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'approved')",[tenantId,oldAssetId,oldArtworkId,oldRightsId,oldKey,oldHash,oldBytes.length]);
   await cms.approve(c,session,oldArtworkId,{revision:1,assetId:oldAssetId});
   return (await cms.studioArtwork(c,session,oldArtworkId)).artwork;
  });
  const candidate=(await run(c=>cms.studioArtwork(c,session,artworkId))).artwork;
  if(prior.schemaVersion!=='1.0.0-draft.1'||candidate.schemaVersion!=='1.0.0-draft.1')throw Error('expected ordinary model projections');
  const draft=newDraft(),placementId=randomUUID(),publicationId=randomUUID();
  draft.candidate.artworks.push(prior);
  draft.candidate.placements.push({id:placementId,roomId:draft.candidate.rooms[0]!.id,artworkRevisionId:prior.revisionId,assetId:prior.primaryAssetId,transform:{position:[1,1,0],rotation:[0,0,0,1],scale:[1,1,1]}});
  draft.candidate.accessibility.artworkDescriptions.push({placementId,text:'A model on display'});
  expect(validateLifecycle(draft).errors).toEqual([]);
  const saved=await run(c=>studio.create(c,session,{draft,requestId:randomUUID()}));
  const publication=saved.draft.candidate,publicationHash=revisionHash(publication);
  await run(async c=>{
   await c.query('INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,publicationId,draft.exhibitionId,saved.revision,userId,publication,publicationHash]);
   await c.query("INSERT INTO publication_states(publication_id,status) VALUES($1,'published')",[publicationId]);
  });
  const replacementRequest={kind:'approved-model-candidate-v1' as const,requestId:randomUUID(),placementId,artworkId,artworkRevision:1,importJobId:id};
  const replace=(input=replacementRequest,match=saved.etag,assetStore=blobs)=>run(c=>replaceApprovedArtwork(c,session,draft.exhibitionId,input,match,studio,cms,nativeImports,assetStore));
  const ownership=async()=>({
   artwork:(await pool.query('SELECT id,revision,approved_revision,approved_asset_id FROM artworks WHERE tenant_id=$1 ORDER BY id',[tenantId])).rows,
   approvals:(await pool.query('SELECT artwork_id,revision,asset_id,snapshot FROM artwork_approvals WHERE tenant_id=$1 ORDER BY artwork_id,revision',[tenantId])).rows,
   assets:(await pool.query('SELECT id,artwork_id,state,object_key,sha256 FROM assets WHERE tenant_id=$1 ORDER BY id',[tenantId])).rows,
  });
  const beforeReplacement=await ownership();
  const resolveCandidate=(candidateId=artworkId,revision=1)=>run(c=>resolveApprovedModelCandidate(c,session,candidateId,revision,cms,nativeImports));
  expect(await resolveCandidate()).toEqual(ready);
  await expect(resolveCandidate(artworkId,2)).rejects.toMatchObject({code:'ARTWORK_REPLACEMENT_STALE'});
  await expect(resolveCandidate(oldArtworkId)).rejects.toMatchObject({code:'MODEL_CANDIDATE_NOT_READY'});
  await expect(replace({...replacementRequest,artworkRevision:2})).rejects.toMatchObject({code:'MODEL_CANDIDATE_NOT_READY'});
  await expect(replace({...replacementRequest,importJobId:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(replace({...replacementRequest,placementId:randomUUID()})).rejects.toMatchObject({code:'ARTWORK_REPLACEMENT_INVALID'});
  await expect(replace(replacementRequest,'"studio-r0-stale"')).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
  await pool.query('UPDATE import_jobs SET png_worker_tokens=ARRAY[$3::uuid] WHERE tenant_id=$1 AND id=$2',[tenantId,id,randomUUID()]);
  await expect(replace()).rejects.toMatchObject({code:'MODEL_CANDIDATE_NOT_READY'});
  await expect(resolveCandidate()).rejects.toMatchObject({code:'MODEL_CANDIDATE_NOT_READY'});
  await pool.query("UPDATE import_jobs SET png_worker_tokens='{}' WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
  await run(async c=>{
   await c.query('SAVEPOINT removed_approval');
   await c.query('UPDATE artworks SET approved_revision=NULL,approved_asset_id=NULL WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId]);
   await expect(replaceApprovedArtwork(c,session,draft.exhibitionId,replacementRequest,saved.etag,studio,cms,nativeImports,blobs)).rejects.toMatchObject({code:'ARTWORK_REPLACEMENT_STALE'});
   await expect(resolveApprovedModelCandidate(c,session,artworkId,1,cms,nativeImports)).rejects.toMatchObject({code:'ARTWORK_REPLACEMENT_STALE'});
   await c.query('ROLLBACK TO SAVEPOINT removed_approval');
  });
  const corrupted=Object.create(blobs) as FileBlobStore;
  corrupted.getBounded=async()=>Buffer.alloc(receipt.display.bytes);
  await expect(replace(replacementRequest,saved.etag,corrupted)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
  await expect(run(async c=>{
   await replaceApprovedArtwork(c,session,draft.exhibitionId,replacementRequest,saved.etag,studio,cms,nativeImports,blobs);
   throw Error('test transaction rollback');
  })).rejects.toThrow('test transaction rollback');
  expect(await run(c=>studio.get(c,session,draft.exhibitionId))).toEqual(saved);
  const replaced=await replace(),expected=structuredClone(saved.draft);
  expected.candidate.artworks[0]=candidate;
  Object.assign(expected.candidate.placements[0]!,{artworkRevisionId:candidate.revisionId,assetId:candidate.primaryAssetId});
  expect(replaced).toMatchObject({revision:saved.revision+1,draft:expected});
  expect(await replace()).toEqual(replaced);
  await expect(replace({...replacementRequest,placementId:randomUUID()})).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
  expect(await run(c=>studio.get(c,session,draft.exhibitionId))).toEqual(replaced);
  expect(await resolveCandidate()).toEqual(ready);
  expect(await ownership()).toEqual(beforeReplacement);
  expect((await pool.query('SELECT p.snapshot,p.revision_sha256,p.draft_revision,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.id=$2',[tenantId,publicationId])).rows[0]).toEqual({snapshot:publication,revision_sha256:publicationHash,draft_revision:saved.revision,status:'published'});

  await run(c=>new Cms(blobs).revise(c,session,artworkId,{...metadata,revision:1} as Parameters<Cms['revise']>[3]));inputRevision=2;
  expect((await pool.query('SELECT count(*)::int AS n FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2',[tenantId,artworkId])).rows[0].n).toBe(1);

  await expect(pool.query("UPDATE import_jobs SET model_preparation=jsonb_set(model_preparation,'{result,producer,output,bytes}','1') WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rejects.toThrow('MODEL_PREPARATION_IMMUTABLE');
  const raw=fixture(80),compatibleRequest=input(raw),compatible=await run(c=>importer.create(c,session,compatibleRequest));await run(c=>importer.upload(c,session,String(compatible.id),raw));await run(c=>importer.complete(c,session,String(compatible.id)));await importer.work();const reused=(await state(String(compatible.id))).modelPreparation;expect(reused).toMatchObject({status:'ready',display:{reusedOriginal:true,sha256:sha256(raw)}});if(reused&&'display' in reused)expect(reused.display.assetId).toBe(reused.original.assetId);expect((await inventory()).issues).toEqual([]);
  await run(c=>new Cms(blobs).revise(c,session,artworkId,{...metadata,revision:2} as Parameters<Cms['revise']>[3]));inputRevision=3;
  const invalid=Buffer.from('unsupported original GLB bytes'),badRequest=input(invalid),bad=await run(c=>importer.create(c,session,badRequest));await run(c=>importer.upload(c,session,String(bad.id),invalid));await run(c=>importer.complete(c,session,String(bad.id)));await importer.work();const failed=await state(String(bad.id));expect(failed.state).toBe('failed');expect(failed.assetId).toBeUndefined();expect(failed.modelPreparation).toMatchObject({status:'failed',workerDrained:true});expect(failed.modelPreparation).not.toHaveProperty('display');
  const badRow=(await pool.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,bad.id])).rows[0];expect(Buffer.from(await blobs.get(badRow.object_key)).equals(invalid)).toBe(true);await pool.query("UPDATE import_jobs SET available_at=now()-interval '1 second',png_worker_tokens=ARRAY[$3::uuid] WHERE tenant_id=$1 AND id=$2",[tenantId,bad.id,randomUUID()]);await expect(run(c=>importer.action(c,session,String(bad.id),'retry'))).rejects.toMatchObject({code:'WORKER_DRAIN_UNCONFIRMED'});await pool.query("UPDATE import_jobs SET png_worker_tokens='{}' WHERE tenant_id=$1 AND id=$2",[tenantId,bad.id]);const replacement=await run(c=>importer.create(c,session,input(fixture(41))));await expect(run(c=>importer.action(c,session,String(bad.id),'retry'))).rejects.toMatchObject({code:'MODEL_PREPARATION_ACTIVE_IMPORT'});await run(c=>importer.action(c,session,String(replacement.id),'cancel'));expect((await run(c=>importer.action(c,session,String(bad.id),'retry'))).state).toBe('queued');await run(c=>importer.action(c,session,String(bad.id),'cancel'));
  const cancelled=await run(c=>importer.create(c,session,input(fixture(40))));await run(c=>importer.upload(c,session,String(cancelled.id),fixture(40)));await run(c=>importer.complete(c,session,String(cancelled.id)));await importer.work({beforeCommit:async()=>{const view=await run(c=>importer.action(c,session,String(cancelled.id),'cancel'));expect(view.modelPreparation).toMatchObject({status:'cancelled',workerDrained:false});expect(view.assetId).toBeUndefined();}});expect((await state(String(cancelled.id))).modelPreparation).toMatchObject({status:'cancelled',workerDrained:true});
  await pool.query('UPDATE artworks SET revision=4 WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId]);await expect(state(id)).rejects.toMatchObject({code:'MODEL_PREPARATION_CONTEXT_CHANGED'});await expect(run(c=>assertRequiredModelApproval(c,session,artworkId,String(ready.assetId)))).rejects.toMatchObject({code:'MODEL_PREPARATION_CONTEXT_CHANGED'});
 }finally{await pool.end();}
},45000);
