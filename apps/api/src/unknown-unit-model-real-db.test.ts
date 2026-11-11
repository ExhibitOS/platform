// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {FileBlobStore,migrate,transaction,sha256} from '@exhibitos/storage';
import {revisionHash,validateLifecycle} from '@exhibitos/spec';
import {pngCrc} from './png-pixels.ts';
import {Imports,type ImportInput} from './imports.ts';
import {Cms,type ArtworkMetadata} from './cms.ts';
import type {Session} from './auth.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {projectPublication} from './publication.ts';
import {inspectModelOriginal} from './model-original-inspection.ts';
import {issueNativeSelectedDraftGrant,recordNativeSelectedProvenance,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {Studio} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {resolveRequiredModelCandidate,approveRequiredModelOriginal,readRequiredModelOriginalApproval,readApprovedRequiredModelOriginal,type RequiredModelOriginalApproval} from './required-model-original.ts';
import {prepareRequiredModelOriginals,persistRequiredModelOriginal,readBoundModelOriginal} from './required-model-original-binding.ts';
function fixture(colour=192,width=1){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(width,4);ihdr[8]=8;ihdr[9]=2;
 const pixels=Buffer.alloc(width*(1+width*3));for(let y=0;y<width;y++)for(let x=0;x<width;x++){const at=y*(1+width*3)+1+x*3;pixels[at]=colour;pixels[at+1]=40;pixels[at+2]=80;}
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,.2,0,1,.4]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint32Array([0,1,2]).buffer),image];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part] of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const pad=(4-length%4)%4;blocks.push(Buffer.alloc(pad));length+=pad;}
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9729,wrapS:10497,wrapT:10497}],images:[{bufferView:4,mimeType:'image/png'}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,Math.fround(.4)]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5125,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:length}]};
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const out=Buffer.alloc(28+json.length+length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);Buffer.concat(blocks).copy(out,28+json.length);return out;
}

it('inspects original bytes without deriving or claiming physical units',()=>{
 const bytes=fixture(),result=inspectModelOriginal(bytes);
 expect(result).toMatchObject({qualification:'structure-only',sourceUnits:'unknown',original:{sha256:sha256(bytes),bytes:bytes.length},triangles:1,vertices:3});
 expect(result.rawBounds).toEqual({min:[0,0,0],max:[1,1,Math.fround(.4)]});
 expect(()=>inspectModelOriginal(Buffer.from('not a GLB'))).toThrow('MODEL_PREPARATION_PROFILE_UNSUPPORTED');
});
it.skipIf(!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL)('retains unknown source revision and explicitly approves only the product-bound next reference revision',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL}),tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID();
 const root=await mkdtemp(join(tmpdir(),'unknown-model-')),blobs=new FileBlobStore(root),execution=createServiceModelPreparationExecution(blobs,()=>true),importer=new Imports(pool,blobs,undefined,execution),cms=new Cms(blobs),session={tenantId,userId,role:'admin'} as Session;
 const run=<T>(fn:(c:import('pg').PoolClient)=>Promise<T>)=>transaction(pool,fn);
 const source=fixture(192,640),inspection=inspectModelOriginal(source),bounds=inspection.rawBounds as {min:[number,number,number];max:[number,number,number]},height=1.5;
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic'};
 const metadata:ArtworkMetadata={title:'Uncalibrated synthetic',description:'Authored provisional display size only',dimensions:{width:1,height,depth:.4,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'unknown',scaleApplied:false,notes:'No physical-unit qualification'},displayReference:{version:1,status:'provisional-uncalibrated',assetSha256:inspection.original.sha256,rawBounds:bounds,referenceHeightMeters:height,pose:{position:[0,0,0],rotation:[0,0,0,1],scale:[height,height,height]}}};
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);await migrate(pool,new URL('../../../database/native-oex-normal/',import.meta.url).pathname);await migrate(pool,new URL('../../../database/native-model-preparation/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated unknown model']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic artist'}]);
  const artwork=await run(c=>cms.createArtwork(c,session,{artistId,...metadata})),artworkId=String(artwork.id),operationID=randomUUID();
  const request:ImportInput={artworkId,idempotencyKey:operationID,mime:'model/gltf-binary',sha256:inspection.original.sha256,bytes:source.length,scaleMeters:1,rights,modelPreparation:{version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID,generation:'durable-unknown-model',artworkRevision:1}};
  await expect(run(c=>importer.create(c,session,{...request,scaleMeters:2}))).rejects.toMatchObject({code:'PROVISIONAL_ASSET_MISMATCH'});
  await expect(run(c=>importer.create(c,session,{...request,modelPreparation:{...request.modelPreparation!,sourceDisplayReference:metadata.displayReference}}))).rejects.toMatchObject({code:'INVALID_MODEL_PREPARATION'});
  const created=await run(c=>importer.create(c,session,request)),jobId=String(created.id);await run(c=>importer.upload(c,session,jobId,source));await run(c=>importer.complete(c,session,jobId));
  const resumed=new Imports(pool,blobs,undefined,execution);expect(await resumed.work()).toBe(true);
  const ready=await run(async c=>resumed.view(await resumed.access(c,session,jobId))),receipt=ready.modelPreparation&&'serverReceipt' in ready.modelPreparation?ready.modelPreparation.serverReceipt:undefined;
  if(!receipt||!('original' in receipt))throw Error('missing ordinary preparation receipt');
  expect(ready.modelPreparation).toMatchObject({status:'ready',workerDrained:true});expect(receipt.display.sha256).not.toBe(inspection.original.sha256);expect(receipt.displayReference).toEqual({...metadata.displayReference,assetSha256:receipt.display.sha256});
  expect((await run(c=>cms.detail(c,session,artworkId))).approvedRevision).toBeNull();
  const olderRightsId=randomUUID(),olderAssetId=randomUUID(),olderKey=`${tenantId}/quarantine/older-model`;
  await blobs.put(olderKey,source);
  await pool.query('INSERT INTO rights(tenant_id,id,metadata,revision) VALUES($1,$2,$3,7)',[tenantId,olderRightsId,rights]);
  await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'quarantine')",[tenantId,olderAssetId,artworkId,olderRightsId,olderKey,sha256(source),source.length]);
  const allRights=async()=>(await pool.query('SELECT r.* FROM rights r WHERE tenant_id=$1 ORDER BY id',[tenantId])).rows;
  const rightsBefore=await allRights();expect(rightsBefore.some(r=>r.id===olderRightsId&&r.revision===7)).toBe(true);
  expect((await run(c=>cms.approve(c,session,artworkId,{revision:1,assetId:receipt.display.assetId}))).revision).toBe(2);
  expect(await allRights()).toEqual(rightsBefore);
  const reopened=new Cms(blobs),again=await run(c=>reopened.approve(c,session,artworkId,{revision:1,assetId:receipt.display.assetId}));expect(again.revision).toBe(2);expect(again.approvedRevision).toBe(2);
  expect(await allRights()).toEqual(rightsBefore);
  expect((await run(c=>resumed.create(c,session,request))).id).toBe(jobId);
  expect((await run(async c=>resumed.view(await resumed.access(c,session,jobId)))).modelPreparation).toMatchObject({status:'ready',workerDrained:true});
  const originalRevision=(await pool.query('SELECT snapshot FROM artwork_revisions WHERE tenant_id=$1 AND artwork_id=$2 AND revision=1',[tenantId,artworkId])).rows[0].snapshot;expect(originalRevision).toEqual(metadata);
  expect(again.metadata).toEqual({...metadata,displayReference:receipt.displayReference});
  const display=await run(c=>reopened.studioArtwork(c,session,artworkId));expect(display.artwork.units).toBe('unknown');expect(display.artwork.transform).toEqual(metadata.displayReference!.pose);expect(display.artwork.assets[0]?.sha256).toBe(receipt.display.sha256);
  const original=(await pool.query('SELECT * FROM assets WHERE tenant_id=$1 AND id=$2',[tenantId,receipt.original.assetId])).rows[0];expect(original.state).toBe('quarantine');expect(sha256(Buffer.from(await blobs.get(original.object_key)))).toBe(inspection.original.sha256);
  // The ordinary retained original becomes an explicitly approved detail source,
  // independently of the cleared transfer and without an adoption operation.
  // Only the native host binding is synthetic: CMS, job/lineage, bytes, saved
  // Studio head, approval and publication binding all use the real database.
  const workspace={workspaceId:randomUUID(),tenantId,principalId:userId,assertDatabase:async()=>{},assertRecord:async()=>{}} as unknown as NativeOexWorkspaceContext;
  const studio=new Studio(workspace,true),nativeImports=new Imports(pool,blobs,workspace);
  vi.spyOn(nativeImports,'requiredModelReady').mockImplementation((c,s)=>importer.requiredModelReady(c,s));
  const discovered=await run(c=>resolveRequiredModelCandidate(c,session,artworkId,2,reopened,nativeImports));
  expect(discovered.requiredModelCustody).toMatchObject({workspaceId:workspace.workspaceId,artworkId,artworkRevision:2,artworkRevisionId:display.artwork.revisionId,importJobId:jobId,serverReceiptSha256:receipt.sha256,original:receipt.original,display:receipt.display});
  await expect(run(c=>resolveRequiredModelCandidate(c,session,artworkId,1,reopened,nativeImports))).rejects.toMatchObject({code:'REQUIRED_MODEL_ORIGINAL_UNAVAILABLE'});
  if(display.artwork.schemaVersion!=='1.0.0-draft.2')throw Error('expected unknown-unit artwork projection');
  const baseDraft=newDraft(),placementId=randomUUID();
  const draft:import('./studio.ts').Draft={...baseDraft,schemaVersion:'1.0.0-draft.2',candidate:{...baseDraft.candidate,schemaVersion:'1.0.0-draft.2',artworks:[display.artwork]}};
  draft.candidate.placements.push({id:placementId,roomId:draft.candidate.rooms[0]!.id,artworkRevisionId:display.artwork.revisionId,assetId:display.artwork.primaryAssetId,transform:{position:[1,1,0],rotation:[0,0,0,1],scale:[1,1,1]}});
  draft.candidate.accessibility.artworkDescriptions.push({placementId,text:'An uncalibrated model with a provisional display size'});
  expect(validateLifecycle(draft,undefined,{archiveProfile:'bounded-file-v1'}).errors).toEqual([]);
  // Seed only the selected-import authority for this known synthetic draft.
  // No real archive parsing or installed-host admission is claimed by this test.
  const selectedJobId=randomUUID(),selectedRequestId=randomUUID(),selectedAttemptId=randomUUID(),selectedSource=Buffer.from(JSON.stringify(draft)),selectedHash=sha256(selectedSource);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspace.workspaceId,tenantId,userId,Math.max(1,process.getuid?.()??1)]);
  await pool.query("INSERT INTO oex_import_jobs(tenant_id,id,user_id,request_id,payload_sha256,expected_bytes,state,staging_keys,archive_profile,oex_format) VALUES($1,$2,$3,$4,$5,$6,'processing','[]','bounded-file-v1','1.0.0-draft.9')",[tenantId,selectedJobId,userId,selectedRequestId,selectedHash,selectedSource.length]);
  const saved=await run(async c=>{
   const assertSelected=async()=>{if((await c.query("SELECT 1 FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND state='processing' AND payload_sha256=$4 FOR UPDATE",[tenantId,selectedJobId,userId,selectedHash])).rowCount!==1)throw Error('synthetic selected source lost');};
   const grant=await issueNativeSelectedDraftGrant(c,session,draft,{workspaceId:workspace.workspaceId,tenantId,principalId:userId,jobId:selectedJobId,attemptId:selectedAttemptId,sourceSha256:selectedHash,claimSha256:sha256(Buffer.from('synthetic selected owner')),payloadManifestSha256:sha256(Buffer.from('synthetic payload manifest')),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:draft.exhibitionId},assertSelected);
   const response=await studio.create(c,session,{draft,requestId:randomUUID()},grant);
   await recordNativeSelectedProvenance(grant,c,session,draft.exhibitionId);
   await c.query("UPDATE oex_import_jobs SET state='complete',result=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,selectedJobId,{exhibitionId:draft.exhibitionId}]);
   return response;
  });
  const approval:RequiredModelOriginalApproval={kind:'required-model-custody-v1',artworkId,artworkRevision:2,importJobId:jobId,serverReceiptSha256:receipt.sha256};
  const readApproval=()=>run(c=>readRequiredModelOriginalApproval(c,session,draft.exhibitionId,approval,studio,reopened,nativeImports,blobs));
  const approve=(input=approval,match=saved.etag)=>run(c=>approveRequiredModelOriginal(c,session,draft.exhibitionId,input,match,studio,reopened,nativeImports,blobs));
  expect(await readApproval()).toMatchObject({approved:false,exhibitionId:draft.exhibitionId,revision:saved.revision,etag:saved.etag,approvalSha256:null,custody:discovered.requiredModelCustody});
  await expect(approve(approval,'"studio-r0-stale"')).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
  await expect(approve({...approval,serverReceiptSha256:'0'.repeat(64)})).rejects.toMatchObject({code:'REQUIRED_MODEL_ORIGINAL_UNAVAILABLE'});
  await pool.query('UPDATE import_jobs SET png_worker_tokens=ARRAY[$3::uuid] WHERE tenant_id=$1 AND id=$2',[tenantId,jobId,randomUUID()]);
  await expect(approve()).rejects.toMatchObject({code:'REQUIRED_MODEL_ORIGINAL_UNAVAILABLE'});
  await pool.query("UPDATE import_jobs SET png_worker_tokens='{}' WHERE tenant_id=$1 AND id=$2",[tenantId,jobId]);
  await run(async c=>{
   await c.query('SAVEPOINT invalid_original_lineage');
   await c.query("UPDATE asset_derivatives SET metadata=jsonb_set(metadata,'{serverReceipt,producer,output,bytes}','1') WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='required-model-preparation'",[tenantId,receipt.original.assetId]);
   await expect(approveRequiredModelOriginal(c,session,draft.exhibitionId,approval,saved.etag,studio,reopened,nativeImports,blobs)).rejects.toMatchObject({code:'MODEL_PREPARATION_RECEIPT_INVALID'});
   await c.query('ROLLBACK TO SAVEPOINT invalid_original_lineage');
  });
  const approved=await approve();expect(approved).toMatchObject({approved:true,exhibitionId:draft.exhibitionId,revision:saved.revision,etag:saved.etag,custody:discovered.requiredModelCustody});
  expect(await approve()).toEqual(approved);expect(await readApproval()).toEqual(approved);
  expect(await run(c=>studio.get(c,session,draft.exhibitionId))).toEqual(saved);
  expect((await pool.query("SELECT count(*)::int AS n FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='required-model-original-static-grant'",[tenantId,receipt.original.assetId])).rows[0].n).toBe(1);
  const signal=new AbortController().signal,deps={studio,cms:reopened,imports:nativeImports,blobs};
  const direct=await run(c=>readApprovedRequiredModelOriginal(c,session,draft.exhibitionId,approval,studio,reopened,nativeImports,blobs,signal));
  expect(direct.bytes.equals(source)).toBe(true);direct.bytes.fill(0);
  const publicationId=randomUUID(),scope={workspaceId:workspace.workspaceId,exhibitionId:draft.exhibitionId,publicationId};
  const projected=projectPublication(saved.draft.candidate,[{artwork:display.artwork,sourceAssetId:receipt.display.assetId,sourceSha256:receipt.display.sha256,bytes:Buffer.from(await blobs.get((await pool.query('SELECT approved_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,jobId])).rows[0].approved_key)),mime:'model/gltf-binary'}],new Date().toISOString());
  const published=projected.snapshot,publicArtwork=published.artworks[0]!;
  expect(publicArtwork.id).not.toBe(artworkId);expect(publicArtwork.primaryAssetId).not.toBe(receipt.display.assetId);
  const identities=[{artworkId,artworkRevision:2,artworkRevisionId:display.artwork.revisionId,publicArtworkId:publicArtwork.id,publicArtworkRevisionId:publicArtwork.revisionId}];
  const prepared=await run(c=>prepareRequiredModelOriginals(c,session,scope,published.artworks,identities,new Set(published.artworks.flatMap(a=>a.assets.map(asset=>asset.id))),deps,signal));
  expect(prepared).toHaveLength(1);const item=prepared[0]!;
  expect(item.candidate).toMatchObject({tier:'acquired-original',sha256:receipt.original.sha256,bytes:receipt.original.bytes,mime:'model/gltf-binary'});
  const publicationHash=revisionHash(published);
  await run(async c=>{
   await c.query('INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,publicationId,draft.exhibitionId,saved.revision,userId,published,publicationHash]);
   await c.query("INSERT INTO publication_states(publication_id,status) VALUES($1,'published')",[publicationId]);
   await persistRequiredModelOriginal(c,session,scope,publicationHash,item,deps,signal);
  });
  const bound=await run(c=>readBoundModelOriginal(c,session,scope,publicationHash,item.publicArtworkId,item.publicArtworkRevisionId,item.candidate,deps,signal));
  expect(bound.equals(source)).toBe(true);bound.fill(0);
  await run(async c=>{
   await c.query('SAVEPOINT ambiguous_model_binding');
   await c.query("INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) SELECT tenant_id,$3,asset_id,jsonb_set(metadata,'{kind}','\"native-adopted-model-detail-binding\"') FROM asset_derivatives WHERE tenant_id=$1 AND metadata->>'kind'='native-required-model-detail-binding' AND metadata->>'publicationId'=$2",[tenantId,publicationId,randomUUID()]);
   await expect(readBoundModelOriginal(c,session,scope,publicationHash,item.publicArtworkId,item.publicArtworkRevisionId,item.candidate,deps,signal)).rejects.toMatchObject({code:'NATIVE_DETAIL_UNAVAILABLE'});
   await c.query('ROLLBACK TO SAVEPOINT ambiguous_model_binding');
  });
  expect((await pool.query('SELECT state,sha256,object_key FROM assets WHERE tenant_id=$1 AND id=$2',[tenantId,receipt.original.assetId])).rows[0]).toEqual({state:'quarantine',sha256:original.sha256,object_key:original.object_key});
  expect(await run(c=>studio.get(c,session,draft.exhibitionId))).toEqual(saved);
  const badMeta=structuredClone(again.metadata!);badMeta.displayReference!.referenceHeightMeters=2;await expect(run(c=>reopened.revise(c,session,artworkId,{...badMeta,revision:2}))).rejects.toMatchObject({code:'INVALID_METADATA'});
  // A structurally plausible but false caller reference must fail before any
  // approved output is written, while the durable uploaded original survives.
  const rejectedSource=fixture(66,640),badMetadata=structuredClone(metadata);
  badMetadata.displayReference!.assetSha256=sha256(rejectedSource);badMetadata.displayReference!.rawBounds.max[0]=2;
  const rejectedArtwork=await run(c=>cms.createArtwork(c,session,{artistId,...badMetadata})),badOperation=randomUUID();
  const rejectedRequest:ImportInput={...request,artworkId:String(rejectedArtwork.id),sha256:sha256(rejectedSource),bytes:rejectedSource.length,idempotencyKey:badOperation,modelPreparation:{...request.modelPreparation!,operationID:badOperation}};
  const rejected=await run(c=>importer.create(c,session,rejectedRequest)),rejectedId=String(rejected.id);
  await run(c=>importer.upload(c,session,rejectedId,rejectedSource));await run(c=>importer.complete(c,session,rejectedId));
  const writes=vi.spyOn(blobs,'put');expect(await importer.work()).toBe(true);
  const approvedWrites=writes.mock.calls.filter(([key])=>key.includes('/approved/')).map(([key])=>key);expect(approvedWrites).toEqual([]);writes.mockRestore();
  const failed=await run(async c=>importer.view(await importer.access(c,session,rejectedId)));
  expect(failed).toMatchObject({state:'failed',modelPreparation:{status:'failed',workerDrained:true}});expect(failed.assetId).toBeUndefined();
  const rejectedRow=(await pool.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,rejectedId])).rows[0];
  expect(rejectedRow.error_code).toBe('MODEL_PREPARATION_DISPLAY_REFERENCE_INVALID');expect(sha256(Buffer.from(await blobs.get(rejectedRow.object_key)))).toBe(sha256(rejectedSource));
  expect((await pool.query('SELECT count(*)::int AS n FROM assets WHERE tenant_id=$1 AND artwork_id=$2',[tenantId,rejectedArtwork.id])).rows[0].n).toBe(0);
  if(process.env.EXHIBITOS_MODEL_TEST_EVIDENCE)await writeFile(join(process.env.EXHIBITOS_MODEL_TEST_EVIDENCE,'review-fix-proof.json'),JSON.stringify({rightsBefore,rightsAfter:await allRights(),approvalRevision:again.revision,originalRevision,preparedReceipt:receipt,rejected:{jobId:rejectedId,state:rejectedRow.state,errorCode:rejectedRow.error_code,workerTokens:rejectedRow.png_worker_tokens,approvedWrites,sourceSHA256:sha256(Buffer.from(await blobs.get(rejectedRow.object_key))),expectedSourceSHA256:sha256(rejectedSource),assetCount:0},syntheticOnly:true},null,2)+'\n');
 }finally{await pool.end();vi.restoreAllMocks();}
},45000);
