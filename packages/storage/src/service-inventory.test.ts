// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
import {collectServiceInventory,inventoryCanonical,rowObjectReferences} from './service-inventory.js';
const tenant='4d0bd5cc-76c5-4df4-b763-63d0f2484777',id='89dbf776-904b-4a49-96ab-e946f49ea2f9',key=tenant+'/objects/model.glb',sha='a'.repeat(64);
const row={tenant_id:tenant,id,object_key:key,target_key:tenant+'/objects/final.glb',bytes:123,sha256:sha};
describe('service inventory typed references',()=>{
 it('includes retained/deleted assets and marks unwritten outbox destination optional',()=>{const r=rowObjectReferences('assets',{...row,state:'quarantine',deleted_at:'2020-01-01'});expect(r.references.map(v=>[v.key,v.required])).toEqual([[key,true],[row.target_key,false]]);expect(r.references[0].expectedSha256).toBe(sha);});
 it('uses derivative expectations and refuses foreign tenant keys',()=>{expect(rowObjectReferences('asset_derivatives',{...row,metadata:{objectKey:key,bytes:42,sha256:sha}}).references[0].expectedBytes).toBe(42);expect(rowObjectReferences('assets',{...row,object_key:'another/objects/x',state:'approved'}).issues[0].code).toBe('INVALID_REFERENCE');});
 it('retains immutable thumbnail bytes with exact size and hash in backup inventory',()=>{
  const result=rowObjectReferences('artwork_thumbnail_bindings',row);
  expect(result.issues).toEqual([]);expect(result.references).toEqual([expect.objectContaining({key,required:true,expectedBytes:123,expectedSha256:sha})]);
  expect(rowObjectReferences('artwork_thumbnail_bindings',{...row,object_key:'other/objects/a'}).issues[0].code).toBe('INVALID_REFERENCE');
 });
 it('retains optional pending and required committed imports/audio',()=>{const source={...row,approved_key:row.target_key,expected_bytes:123,expected_hash:sha};expect(rowObjectReferences('import_jobs',{...source,state:'uploading'}).references.every(v=>!v.required)).toBe(true);expect(rowObjectReferences('import_jobs',{...source,state:'approved'}).references.every(v=>v.required)).toBe(true);expect(rowObjectReferences('studio_audio',{...row,state:'approved',revoked:true}).references[0].required).toBe(true);});
 it('keeps original JPEG and prepared PNG custody references distinct through approval',()=>{
  const preparedHash='b'.repeat(64),source={...row,mime:'image/jpeg',approved_key:row.target_key,expected_bytes:123,expected_hash:sha,derived:{mime:'image/png',bytes:17,sha256:preparedHash},derived_object_key:tenant+'/quarantine/import/prepared.png'};
  const approved=rowObjectReferences('import_jobs',{...source,state:'approved'});expect(approved.issues).toEqual([]);expect(approved.references).toHaveLength(3);expect(approved.references.every(v=>v.required)).toBe(true);
  expect(approved.references.find(v=>v.binding.endsWith(':source'))).toMatchObject({expectedBytes:123,expectedSha256:sha});
  for(const suffix of [':prepared',':approved'])expect(approved.references.find(v=>v.binding.endsWith(suffix))).toMatchObject({expectedBytes:17,expectedSha256:preparedHash});
  expect(rowObjectReferences('import_jobs',{...source,state:'uploading'}).references.every(v=>!v.required)).toBe(true);
  expect(rowObjectReferences('import_jobs',{...source,derived:null}).issues).toContainEqual(expect.objectContaining({code:'INVALID_PREPARED_IMPORT'}));
 });
 it('accepts legacy PNG and JPEG imports with nullable worker fields',()=>{
  const source={...row,approved_key:row.target_key,expected_bytes:123,expected_hash:sha,state:'approved',png_drain_version:null,png_worker_tokens:null};
  const png=rowObjectReferences('import_jobs',{...source,mime:'image/png',derived:null,derived_object_key:null});
  expect(png.issues).toEqual([]);expect(png.references.map(v=>v.key)).toEqual([key,row.target_key]);
  const jpeg=rowObjectReferences('import_jobs',{...source,mime:'image/jpeg',derived_object_key:tenant+'/quarantine/prepared',derived:{mime:'image/png',bytes:17,sha256:sha}});
  expect(jpeg.issues).toEqual([]);expect(jpeg.references).toHaveLength(3);
 });
 it('retains approved or revoked independent stills and immutable public copies without scanning arbitrary JSON',()=>{
  for(const state of ['validated','approved'])expect(rowObjectReferences('studio_cover_images',{...row,state,revoked:true}).references[0]).toMatchObject({key,required:true,expectedBytes:123,expectedSha256:sha});
  expect(rowObjectReferences('studio_cover_images',{...row,state:'uploading'}).references[0].required).toBe(false);
  expect(rowObjectReferences('publication_cover_images',row).references[0]).toMatchObject({key,required:true,expectedBytes:123,expectedSha256:sha});
  expect(rowObjectReferences('cover_image_approvals',{snapshot:{object_key:key}}).references).toEqual([]);
 });
 it('records chunk aggregate hashes only for fully received OEX archive',()=>{const source={...row,staging_keys:[key,row.target_key],cleanup_keys:[tenant+'/oex/job/model.glb'],expected_bytes:123,payload_sha256:sha};const r=rowObjectReferences('oex_import_jobs',{...source,state:'queued'});expect(r.references[1].aggregate).toMatchObject({index:1,count:2,bytes:123,sha256:sha});expect(r.references[2].required).toBe(false);expect(rowObjectReferences('oex_import_jobs',{...source,state:'complete'}).references.every(v=>!v.required)).toBe(true);});
 it('rejects unsafe keys and malformed hashes, without treating arbitrary metadata strings as references',()=>{expect(rowObjectReferences('publication_assets',{...row,object_key:tenant+'/../outside'}).issues[0].code).toBe('INVALID_REFERENCE');expect(rowObjectReferences('assets',{...row,sha256:'invalid'}).issues[0].code).toBe('INVALID_EXPECTED_HASH');expect(rowObjectReferences('artworks',{...row,metadata:{url:key}}).references).toEqual([]);});
 it('freezes include revoked historical runtime and ordered full OEX archive',()=>{const manifest={oex:{bytes:123,sha256:sha},runtime:{files:[{path:'index.html',bytes:1,sha256:sha}]}},inventory={oex:[key],runtime:[{path:'index.html',key:row.target_key}]};const r=rowObjectReferences('exhibition_freezes',{...row,manifest,inventory});expect(r.references).toHaveLength(2);expect(r.references[0].aggregate?.sha256).toBe(sha);expect(r.references[1].expectedBytes).toBe(1);expect(rowObjectReferences('freeze_requests',{...row,object_keys:[key],state:'creating'}).references[0].required).toBe(false);expect(rowObjectReferences('freeze_requests',{...row,object_keys:[key],state:'complete'}).references[0].required).toBe(true);});
 it('refuses duplicate runtime mappings and invalid aggregate inventory',()=>{const manifest={oex:{bytes:123,sha256:sha},runtime:{files:[{path:'index.html',bytes:1,sha256:sha}]}},inventory={oex:[],runtime:[{path:'index.html',key},{path:'index.html',key}]};const r=rowObjectReferences('exhibition_freezes',{...row,manifest,inventory});expect(r.issues.map(v=>v.code)).toContain('INVALID_AGGREGATE');expect(r.issues.map(v=>v.code)).toContain('INVALID_INVENTORY');});
 it('canonical hashes preserve every value but ignore property insertion order',()=>{expect(inventoryCanonical({z:[2,1],a:{b:'secret'}})).toBe(inventoryCanonical({a:{b:'secret'},z:[2,1]}));expect(inventoryCanonical({a:1})).not.toBe(inventoryCanonical({a:2}));});
});

it('hashes PostgreSQL raw numeric rows without IEEE754 rounding',async()=>{
 const migrationDirectory=await mkdtemp(join(tmpdir(),'exhibitos-numeric-inventory-'));
 const run=async(raw:string)=>{
  let fetched=false;
  const c={query:async(sql:string)=>{
   if(sql.startsWith('SELECT c.relname AS name'))return {rows:[{name:'numeric_fixture',scoped:false}]};
   if(sql.startsWith('DECLARE'))expect(sql).toContain('to_jsonb(t)::text AS raw');
   if(sql.startsWith('FETCH')&&!fetched){fetched=true;return {rows:[{raw}],rowCount:1};}
   return {rows:[],rowCount:0};
  }}as unknown as PoolClient;
  return collectServiceInventory(c,{listAll:async()=>[]}as unknown as BlobStore,{migrationDirectory});
 };
 const first='{"n": 9007199254740992}',second='{"n": 9007199254740993}';
 expect(JSON.parse(first)).toEqual(JSON.parse(second)); // Reproduces the old precision loss.
 const a=await run(first),b=await run(second);
 expect(a.tables[0]?.sha256).toBe(createHash('sha256').update(first+'\n').digest('hex'));
 expect(b.tables[0]?.sha256).not.toBe(a.tables[0]?.sha256);
});


describe('retained migration catalog inventory',()=>{
 const sql='CREATE TABLE fixture(id bigint PRIMARY KEY);',entry={name:'000001_fixture.sql',sha256:createHash('sha256').update(sql).digest('hex')};
 const blobs={listAll:async()=>[]} as unknown as BlobStore;
 const client=(migrations:{name:string;sha256:string}[],onQuery?:()=>void)=>({query:async(sql:string)=>{onQuery?.();return {rows:sql.startsWith('SELECT name,sha256 FROM schema_migrations')?migrations:[],rowCount:0};}} as unknown as PoolClient);
 it('observes the same whole catalog/schema as the existing directory path',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'exhibitos-catalog-inventory-'));
  try{await writeFile(join(directory,entry.name),sql);const a=await collectServiceInventory(client([entry]),blobs,{migrationDirectory:directory}),b=await collectServiceInventory(client([entry]),blobs,{migrationCatalog:[entry]});
   expect({...a,createdAt:''}).toEqual({...b,createdAt:''});expect(b.issues).toEqual([]);
  }finally{await rm(directory,{recursive:true});}
 });
 it('reports missing, replaced and unknown database migrations without accepting input as an observation',async()=>{
  const wrong={...entry,sha256:'b'.repeat(64)},extra={name:'000002_extra.sql',sha256:'c'.repeat(64)};
  for(const actual of [[],[wrong],[entry,extra]]){const r=await collectServiceInventory(client(actual),blobs,{migrationCatalog:[entry]});expect(r.migrations).toEqual(actual);expect(r.issues.length).toBeGreaterThan(0);}
 });
 it('captures the complete caller catalog before asynchronous database queries',async()=>{
  const mutable=[{...entry}];let called=false;const r=await collectServiceInventory(client([entry],()=>{if(!called){called=true;mutable[0]!.sha256='b'.repeat(64);mutable.length=0;}}),blobs,{migrationCatalog:mutable});expect(r.issues).toEqual([]);
 });
 it.each(['empty','duplicate','unsorted','escape','hash','unknown','both','tenant'])('refuses %s before database or blob access',async kind=>{
  let queried=false;const second={name:'000002_extra.sql',sha256:'b'.repeat(64)};let catalog:unknown=[entry];const extra:Record<string,unknown>={};
  if(kind==='empty')catalog=[];if(kind==='duplicate')catalog=[entry,entry];if(kind==='unsorted')catalog=[second,entry];if(kind==='escape')catalog=[{...entry,name:'../escape.sql'}];if(kind==='hash')catalog=[{...entry,sha256:'invalid'}];if(kind==='unknown')catalog=[{...entry,verified:true}];if(kind==='both')extra.migrationDirectory='/unused';if(kind==='tenant')extra.tenantId=tenant;
  await expect(collectServiceInventory(client([],()=>{queried=true;}),blobs,{migrationCatalog:catalog,...extra} as never)).rejects.toThrow('MIGRATION_CATALOG_INVALID');expect(queried).toBe(false);
 });
});

it('retains immutable imported floor, surface material and footstep resources for backup and privacy',()=>{
 const row={tenant_id:'11111111-1111-4111-8111-111111111111',exhibition_id:'22222222-2222-4222-8222-222222222222',object_key:'11111111-1111-4111-8111-111111111111/oex-import/job/lease/map',bytes:123,sha256:'a'.repeat(64)};
 for(const table of ['studio_floor_resources','studio_surface_material_resources','studio_footstep_resources']){
  for(const role of ['color','notice']){const result=rowObjectReferences(table,{...row,role});expect(result.issues).toEqual([]);expect(result.references[0]).toMatchObject({key:row.object_key,required:true,expectedBytes:123,expectedSha256:row.sha256});}
  expect(rowObjectReferences(table,{...row,object_key:'another-tenant/oex-import/job/map'}).issues[0]?.code).toBe('INVALID_REFERENCE');
 }
});


it('tracks workspace material receipts and immutable maps without treating cancelled uploads as live',()=>{
 const map={bytes:123,sha256:sha},receipt={...map,key},version={tenant_id:tenant,id,version:1,descriptor:{maps:{color:map}},object_keys:{color:key}};
 expect(rowObjectReferences('workspace_material_versions',version)).toEqual({issues:[],references:[expect.objectContaining({key,required:true,expectedBytes:123,expectedSha256:sha})]});
 expect(rowObjectReferences('workspace_material_versions',{...version,object_keys:{color:'other/objects/x'}}).issues[0]?.code).toBe('INVALID_REFERENCE');
 expect(rowObjectReferences('workspace_material_versions',{...version,object_keys:{}}).issues[0]?.code).toBe('INVALID_INVENTORY');
 for(const phase of ['uploading','validating','failed','registered'])expect(rowObjectReferences('workspace_material_intakes',{tenant_id:tenant,id,phase,received:{color:receipt}}).references[0]?.required).toBe(true);
 expect(rowObjectReferences('workspace_material_intakes',{tenant_id:tenant,id,phase:'cancelling',received:{color:receipt}}).references[0]?.required).toBe(false);
 expect(rowObjectReferences('workspace_material_intakes',{tenant_id:tenant,id,phase:'cancelled',received:{color:receipt}}).references).toEqual([]);
});
it('tracks staged workspace import bytes as optional until an immutable version requires them',()=>{
 const job='22222222-2222-4222-8222-222222222222',attempt='33333333-3333-4333-8333-333333333333',source='44444444-4444-4444-8444-444444444444',object='55555555-5555-4555-8555-555555555555',key=`${tenant}/oex-import/${job}/${attempt}/${object}`,digest='a'.repeat(64);
 const stage={tenant_id:tenant,import_job_id:job,attempt_id:attempt,source_material_id:source,source_material_version:1,role:'color',source_path:`resources/workspace-materials/${source}/1/color-${digest}.png`,object_key:key,bytes:123,sha256:digest};
 expect(rowObjectReferences('workspace_material_import_stage',stage)).toEqual({issues:[],references:[expect.objectContaining({key,required:false,expectedBytes:123,expectedSha256:digest})]});
 expect(rowObjectReferences('workspace_material_import_stage',{...stage,object_key:key+'/other'}).issues[0]?.code).toBe('INVALID_INVENTORY');
 expect(rowObjectReferences('workspace_material_import_stage',{...stage,source_path:'resources/other.png'}).issues[0]?.code).toBe('INVALID_INVENTORY');
 const version={tenant_id:tenant,id,version:1,descriptor:{maps:{color:{bytes:123,sha256:digest}}},object_keys:{color:key}};
 expect(rowObjectReferences('workspace_material_versions',version).references[0]).toMatchObject({key,required:true,expectedBytes:123,expectedSha256:digest});
});


it('retains registered and unused workspace furnishing GLB references in full backup inventory',()=>{
 const workspace='9d0bd5cc-76c5-4df4-b763-63d0f2484777',modelKey=`${tenant}/workspace-furnishing-intake/${workspace}/${id}/${sha}`,receipt={key:modelKey,bytes:123,sha256:sha},intake={tenant_id:tenant,workspace_id:workspace,id,declaration:{model:{bytes:123,sha256:sha}}},version={tenant_id:tenant,id,version:1,descriptor:{id,version:1,model:{mime:'model/gltf-binary',bytes:123,sha256:sha}},object_key:key};
 expect(rowObjectReferences('workspace_furnishing_versions',version)).toEqual({issues:[],references:[expect.objectContaining({key,required:true,expectedBytes:123,expectedSha256:sha})]});
 for(const phase of ['uploading','validating','registered','failed'])expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase,received:receipt}).references[0]?.required).toBe(true);
 expect(rowObjectReferences('workspace_furnishing_intakes',{tenant_id:tenant,id,phase:'uploading',received:null})).toEqual({references:[],issues:[]});
 expect(rowObjectReferences('workspace_furnishing_intakes',{tenant_id:tenant,id,phase:'validating',received:null}).issues[0]?.code).toBe('INVALID_INVENTORY');
 expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase:'cancelling',received:receipt}).references[0]?.required).toBe(false);
 expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase:'registered',received:{...receipt,key}}).issues[0]?.code).toBe('INVALID_INVENTORY');
 expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase:'registered',received:{...receipt,bytes:124}}).issues[0]?.code).toBe('INVALID_INVENTORY');
 for(const phase of ['validating','cancelling'])expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase,received:receipt,worker_token:id}).issues.some(issue=>issue.code==='FURNISHING_WORKER_DRAIN_UNCONFIRMED')).toBe(true);
 expect(rowObjectReferences('workspace_furnishing_intakes',{...intake,phase:'validating',received:receipt,worker_token:null}).issues).toEqual([]);
 expect(rowObjectReferences('workspace_furnishing_intakes',{tenant_id:tenant,id,phase:'cancelled',received:receipt}).references).toEqual([]);
 expect(rowObjectReferences('workspace_furnishing_versions',{...version,object_key:'other/foreign'}).issues[0]?.code).toBe('INVALID_REFERENCE');
 expect(rowObjectReferences('workspace_furnishing_versions',{...version,descriptor:{...version.descriptor,id:'different'}}).issues[0]?.code).toBe('INVALID_INVENTORY');
});

it('protects both prepared frame references without misclassifying staged rows',()=>{
 const tenant='10000000-0000-4000-8000-000000000001',workspace='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000003',source='a'.repeat(64),renderable='b'.repeat(64),prefix=`${tenant}/workspace-furnishing-intake/${workspace}/${id}`;
 const record={tenant_id:tenant,workspace_id:workspace,intake_id:id,source_key:`${prefix}/${source}`,source_bytes:123,source_sha256:source,renderable_key:`${prefix}/${renderable}`,renderable_bytes:120,renderable_sha256:renderable,recipe:'omit-unused-invalid-tangent-r1',state:'registered'};
 const registered=rowObjectReferences('workspace_frame_preparations',record);expect(registered.issues).toEqual([]);expect(registered.references).toHaveLength(2);expect(registered.references.every(ref=>ref.required)).toBe(true);
 const staged=rowObjectReferences('workspace_frame_preparations',{...record,state:'staged'});expect(staged.issues).toEqual([]);expect(staged.references[1]?.required).toBe(false);
 expect(rowObjectReferences('workspace_frame_preparations',{...record,source_key:'other/foreign'}).issues[0]?.code).toBe('INVALID_INVENTORY');
});
it('retains the job-scoped coarse key and refuses an undrained worker',()=>{
 const source={...row,approved_key:row.target_key,expected_bytes:123,expected_hash:sha,mime:'image/jpeg',state:'approved',png_drain_version:1,png_worker_tokens:[],user_id:'user',derived_object_key:tenant+'/quarantine/prepared',derived:{mime:'image/png',bytes:12,sha256:sha,viewerCoarse:{intent:{version:1,profile:'viewer-png-box-512-v1',approvalId:'approval',artworkRevision:1},workspaceId:'workspace',principalId:'user',assetId:'asset',stageKey:`${tenant}/quarantine/import-${row.id}/coarse-${sha}`,sha256:sha,bytes:9}}};
 const inventory=rowObjectReferences('import_jobs',source);expect(inventory.issues).toEqual([]);expect(inventory.references.find(x=>x.key===source.derived.viewerCoarse.stageKey)?.required).toBe(true);
 const active=rowObjectReferences('import_jobs',{...source,png_worker_tokens:['live']});expect(active.issues).toContainEqual(expect.objectContaining({code:'IMAGE_COARSE_WORKER_DRAIN_UNCONFIRMED'}));
 const wrong=rowObjectReferences('import_jobs',{...source,derived:{...source.derived,viewerCoarse:{...source.derived.viewerCoarse,stageKey:tenant+'/wrong'}}});expect(wrong.issues).toContainEqual(expect.objectContaining({code:'INVALID_IMAGE_COARSE_IMPORT'}));
});


it('retains a cancelled Hayes source and reports unresolved custody',()=>{
 const tenant='10000000-0000-4000-8000-000000000001',digest='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6';
 const row={tenant_id:tenant,id:'job',mime:'model/gltf-binary',state:'cancelled',hayes_attempt_id:'active',object_key:tenant+'/quarantine/source',approved_key:tenant+'/approved/source',expected_hash:digest,expected_bytes:8383096,derived:null};
 const result=rowObjectReferences('import_jobs',row);expect(result.issues).toContainEqual(expect.objectContaining({code:'HAYES_WORKER_DRAIN_UNCONFIRMED'}));expect(result.references.find(x=>x.key===row.object_key)?.required).toBe(true);
 const approved={...row,state:'approved',approved_key:tenant+'/hayes-output/attempt/'+ 'b'.repeat(64)};const refs=rowObjectReferences('import_jobs',approved);expect(refs.references.map(x=>x.key)).toEqual([row.object_key]);expect(refs.issues).toContainEqual(expect.objectContaining({code:'HAYES_WORKER_DRAIN_UNCONFIRMED'}));
});

it('protects a reserved Hayes output even before the bytes are written',()=>{
 const attempt='10000000-0000-4000-8000-000000000002',output='b'.repeat(64),stage={tenant_id:tenant,id,attempt_id:attempt,output_sha256:output,output_bytes:123,object_key:`${tenant}/hayes-output/${attempt}/${output}`};
 const inventory=rowObjectReferences('hayes_output_stages',stage);
 expect(inventory.references).toEqual([expect.objectContaining({key:stage.object_key,required:false,expectedBytes:123,expectedSha256:output})]);
 expect(inventory.issues).toContainEqual(expect.objectContaining({code:'HAYES_WORKER_DRAIN_UNCONFIRMED'}));
 expect(rowObjectReferences('hayes_output_stages',{...stage,object_key:'other/foreign'}).issues).toContainEqual(expect.objectContaining({code:'INVALID_HAYES_OUTPUT_STAGE'}));
 expect(rowObjectReferences('hayes_output_stages',{...stage,output_bytes:16777217}).issues).toContainEqual(expect.objectContaining({code:'INVALID_HAYES_OUTPUT_STAGE'}));
});
