// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomBytes,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync} from 'node:fs';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {deflateSync} from 'node:zlib';
import {pngCrc,decodePngPixels} from './png-pixels.ts';
import {expect,it} from 'vitest';
import {FileBlobStore,migrate,sha256,transaction} from '@exhibitos/storage';
// @ts-expect-error Existing private native lease exchange is JavaScript.
import {acceptFurnishingOrdinaryAdmission,acceptFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
// @ts-expect-error Existing private native lease encoder is JavaScript.
import {encodeFurnishingLeaseFrame} from '../../../scripts/native-workspace-furnishing-lease.mjs';
// @ts-expect-error Existing private native admission encoder is JavaScript.
import {encodeFurnishingOrdinaryAssertion} from '../../../scripts/native-workspace-furnishing-ordinary-assertion.mjs';
// @ts-expect-error Existing private sealed catalog adapter is JavaScript.
import {upgradeCombinedThumbnailCatalog} from '../../../scripts/native-workspace-furnishing-bootstrap.mjs';
import {buildApp} from './app.ts';
import {Imports} from './imports.ts';
import {createNativeModelPreparationExecution} from './model-preparation-import.ts';
import {bindNativeOexWorkspace} from './native-oex-provenance.ts';
import type {Session} from './auth.ts';

it.skipIf(!process.env.EXHIBITOS_CURRENT_THUMBNAIL_TEST_PG)('reproduces SQL45 rejection then creates, drains, reviews and separately selects a current Full thumbnail under051',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_CURRENT_THUMBNAIL_TEST_PG});
 const root=await realpath(await mkdtemp(join(tmpdir(),'current-thumbnail-')));
 const blobs=new FileBlobStore(join(root,'blobs')),configRoot=join(root,'config');
 const descriptors:number[]=[];
 let app:ReturnType<typeof buildApp>|undefined;
 let combinedVerification:Record<string,unknown>|undefined;
 try{
  await mkdir(blobs.root,{mode:0o700});
  await mkdir(configRoot,{mode:0o700});
  const webRoot=join(root,'web');
  await mkdir(webRoot,{mode:0o700});
  await writeFile(join(webRoot,'index.html'),'<!doctype html><title>Isolated readiness</title>');
  const lock=join(root,'native-workspace-furnishing-writers.lock');
  let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);
  descriptors.push(fd);
  while(fd<10){fd=openSync(lock,constants.O_RDWR);descriptors.push(fd);}
  const rootStat=lstatSync(root,{bigint:true}),lockStat=fstatSync(fd,{bigint:true});
  const tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID();
  const issueWriter=async(previousRuntimeGeneration?:string,mode='workspace-furnishing-036-reopen-v1')=>{
   const scope={workspaceId,tenantId,principalId:userId,runtimeGeneration:randomUUID(),mode};
   const secret=randomBytes(32),fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),lockDevice:String(lockStat.dev),lockInode:String(lockStat.ino)};
   let open=true;
   const channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{open=false;}};
   const writer=await acceptFurnishingWriterLease({channel,secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:blobs.root,configRoot});
   channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',{runtimeGeneration:scope.runtimeGeneration,leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:mode==='workspace-furnishing-051-to-050-051-upgrade-v1'?'catalog-upgrade-051-to-050-051':previousRuntimeGeneration?'interrupted-reopen':'clean-reopen',activeBindingSHA256:'b'.repeat(64),...(previousRuntimeGeneration?{previousRuntimeGeneration}:{})},secret);
   const admission=await acceptFurnishingOrdinaryAdmission({writer,channel,secret});
   return {writer,admission,channel};
  };
  const owner=await issueWriter();
  const origin='http://127.0.0.1:13200',token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const auth={mode:'local' as const,origin,bindHost:'127.0.0.1'};
  const headers={host:'127.0.0.1:13200',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
  const api=`/api/v1/tenants/${tenantId}`;
  const rights={holder:'Test owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Test owner'};
  const artistId=randomUUID();
  const migrationPath=(name:string)=>new URL(`../../../database/${name}/`,import.meta.url).pathname;
  const migrationDirectory=migrationPath('migrations'),supplementalMigrationDirectory=migrationPath('native-oex-normal');
  const modelPreparationMigrationDirectory=migrationPath('native-model-preparation');
  const oldDirectories=[migrationDirectory,supplementalMigrationDirectory,...['native-oex-workspace-import','native-oex-workspace-import-wall','native-workspace-furnishing','native-workspace-furnishing-writer','native-workspace-furnishing-publication','native-workspace-material-publication','native-workspace-material-multimap','native-workspace-frame-preparation','native-hayes-original','native-hayes-disposition','native-hayes-release'].map(migrationPath),modelPreparationMigrationDirectory];
  for(const directory of oldDirectories)await migrate(pool,directory);
  expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(45);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Isolated fresh images']);
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),sha256(Buffer.from(token)),sha256(Buffer.from(csrf)),csrf,tenantId,userId]);
  await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Test artist'}]);
  const ownerUid=process.getuid!();
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,ownerUid]);
  const workspace=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid,blobRoot:blobs.root}));
  const execution=createNativeModelPreparationExecution(blobs,workspace,owner.writer,()=>true);
  app=buildApp({pool,auth,blobs,nativeOexWorkspace:workspace,nativeBoundedEditing:true,modelPreparationExecution:execution});
  const metadata={title:'Synthetic current approved PNG',description:'',dimensions:{width:1.5,height:1,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:true,notes:''}};
  const created=await app.inject({method:'POST',url:`${api}/cms/artworks`,headers,payload:{artistId,...metadata}});
  expect(created.statusCode,created.body).toBe(201);const artworkId=created.json().id as string;
  const width=640,height=480,raw=Buffer.alloc((width*3+1)*height,93);for(let y=0;y<height;y++)raw[y*(width*3+1)]=0;
  const chunk=(kind:string,body:Buffer)=>{const type=Buffer.from(kind),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(body.length);crc.writeUInt32BE(pngCrc(Buffer.concat([type,body])));return Buffer.concat([size,type,body,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  const source=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  expect(decodePngPixels(source).width).toBe(width);
  const fullId=randomUUID(),rightsId=randomUUID(),fullKey=`${tenantId}/approved/${sha256(source)}`;
  await blobs.put(fullKey,source);
  await pool.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,rights]);
  await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'image/png',1,'approved')",[tenantId,fullId,artworkId,rightsId,fullKey,sha256(source),source.length]);
  const approval=await app.inject({method:'POST',url:`${api}/cms/artworks/${artworkId}/approve`,headers,payload:{revision:1,assetId:fullId}});
  expect(approval.statusCode,approval.body).toBe(200);
  const before=(await pool.query('SELECT * FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId])).rows[0];
  const importer=new Imports(pool,blobs,workspace,execution),session={tenantId,userId,role:'admin'} as Session;
  const input={requestId:randomUUID(),expectedRevision:1},url=`${api}/cms/artworks/${artworkId}/image-thumbnail-preparations`;
  const oldRuntime=process.env.EXHIBITOS_PRIOR_THUMBNAIL_RUNTIME;if(!oldRuntime)throw Error('explicit qualified prior runtime required');
  const prior=await import(pathToFileURL(join(oldRuntime,'platform/apps/api/dist/current-image-thumbnail.js')).href);
  await expect(transaction(pool,c=>prior.createCurrentImageThumbnail(importer,c,session,artworkId,input))).rejects.toMatchObject({code:'23514',constraint:'import_prepared_shape'});
  expect((await pool.query('SELECT count(*)::int AS n FROM import_jobs')).rows[0].n).toBe(0);
  // Corrected API refuses the old schema before an INSERT, rather than500.
  const unavailable=await app.inject({method:'POST',url,headers,payload:input});expect(unavailable.statusCode,unavailable.body).toBe(503);
  const oldLedger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await migrate(pool,migrationPath('native-current-image-thumbnail'));
  expect((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,45)).toEqual(oldLedger);
  const prepare=()=>app!.inject({method:'POST',url,headers,payload:input});
  const job=await prepare();expect(job.statusCode,job.body).toBe(201);const jobId=job.json().id as string;
  expect(job.json().thumbnailPreparation.status).toBe('pending');expect(job.json().assetId).toBeUndefined();
  expect((await prepare()).json().id).toBe(jobId);
  expect((await pool.query('SELECT count(*)::int AS n FROM import_jobs')).rows[0].n).toBe(1);
  const selectionURL=`${api}/cms/artworks/${artworkId}/thumbnail-selection`;
  const current=()=>app!.inject({method:'GET',url:selectionURL+'?expectedRevision=1',headers});
  expect((await current()).json().selectionVersion).toBe(0);
  expect(await importer.work()).toBe(true);
  const read=await app.inject({method:'GET',url:`${api}/imports/${jobId}`,headers});expect(read.statusCode,read.body).toBe(200);
  const ready=read.json();expect(ready.thumbnailPreparation).toMatchObject({status:'ready',workerDrained:true});
  const receipt=ready.thumbnailPreparation.serverReceipt,candidate=ready.thumbnailPreparation.selectionCandidate;
  expect(receipt.source.assetId).toBe(fullId);expect(receipt.thumbnail.assetId).not.toBe(fullId);
  expect(ready.assetId).toBe(receipt.thumbnail.assetId);expect((await current()).json().selectionVersion).toBe(0);
  expect((await pool.query('SELECT * FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId])).rows[0]).toEqual(before);
  expect(Buffer.from(await blobs.get(fullKey))).toEqual(source);
  expect((await prepare()).json().id).toBe(jobId);expect(await importer.work()).toBe(false);
  const selectInput={...candidate,requestId:randomUUID(),expectedSelectionVersion:0};
  const selected=await app.inject({method:'POST',url:selectionURL,headers,payload:selectInput});expect(selected.statusCode,selected.body).toBe(200);
  expect((await current()).json().selectionVersion).toBe(1);
  const stale=await app.inject({method:'POST',url:selectionURL,headers,payload:{...selectInput,requestId:randomUUID()}});expect(stale.statusCode).toBe(409);
  const revisionChanged=await app.inject({method:'POST',url,headers,payload:{requestId:randomUUID(),expectedRevision:2}});expect(revisionChanged.statusCode).toBe(409);
  const callerPixels=await app.inject({method:'POST',url,headers,payload:{...input,pngBase64:'AAAA'}});expect(callerPixels.statusCode).toBe(400);
  for(const mutation of ["derived=derived-'source'","mime='image/jpeg'","png_drain_version=0","derived_object_key='foreign'","derived=jsonb_set(derived,'{request,expectedRevision}','2')"]){
   await expect(transaction(pool,c=>c.query(`UPDATE import_jobs SET ${mutation} WHERE id=$1`,[jobId]))).rejects.toBeDefined();
  }
  if(process.env.EXHIBITOS_COMBINED_THUMBNAIL_TEST==='1'){
   const preserved=async()=>{
    const snapshot:Record<string,unknown>={};
    for(const table of ['artworks','assets','rights','artwork_approvals','import_jobs','artwork_thumbnail_bindings','artwork_thumbnail_selections','local_workspaces','auth_sessions'])snapshot[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    return snapshot;
   };
   const oldData=await preserved(),oldLedger=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
   expect(oldLedger).toHaveLength(46);
   const mode='workspace-furnishing-051-to-050-051-upgrade-v1',issued=await issueWriter(undefined,mode);
   const dirs={workspaceImportDirectory:'native-oex-workspace-import',workspaceWallImportDirectory:'native-oex-workspace-import-wall',workspaceFurnishingDirectory:'native-workspace-furnishing',workspaceFurnishingWriterDirectory:'native-workspace-furnishing-writer',workspaceFurnishingPublicationDirectory:'native-workspace-furnishing-publication',workspaceMaterialPublicationDirectory:'native-workspace-material-publication',workspaceMaterialMultimapDirectory:'native-workspace-material-multimap',workspaceFramePreparationDirectory:'native-workspace-frame-preparation',hayesOriginalDirectory:'native-hayes-original',hayesDispositionDirectory:'native-hayes-disposition',hayesReleaseDirectory:'native-hayes-release',modelPreparationDirectory:'native-model-preparation',currentImageThumbnailDirectory:'native-current-image-thumbnail',workspaceFurnishingThumbnailDirectory:'native-workspace-furnishing-thumbnail'};
   const catalog={base:migrationDirectory,normal:supplementalMigrationDirectory,...Object.fromEntries(Object.entries(dirs).map(([key,value])=>[key,migrationPath(value)]))};
   const apply=()=>transaction(pool,c=>upgradeCombinedThumbnailCatalog(c,{mode,ownerUid:process.getuid!(),writer:issued.writer,ordinaryAdmission:issued.admission,channel:issued.channel,isStopped:()=>false,catalog}));
   expect(await apply()).toEqual({state:'applied'});
   const ledger=(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
   expect(ledger).toHaveLength(47);expect(ledger.filter(row=>row.name!=='050_workspace_furnishing_thumbnail.sql')).toEqual(oldLedger);
   expect(ledger.find(row=>row.name==='050_workspace_furnishing_thumbnail.sql')?.sha256).toBe('8461cad231b80c109b1aaedcef6e1a4d599143313faf00f366f52e79780219fc');
   expect(await preserved()).toEqual(oldData);expect(await apply()).toEqual({state:'already-applied'});expect(await preserved()).toEqual(oldData);
   const tables=(await pool.query("SELECT to_regclass('public.workspace_furnishing_thumbnail_candidates')::text AS candidates,to_regclass('public.workspace_furnishing_thumbnail_selections')::text AS selections")).rows[0];
   expect(tables).toEqual({candidates:'workspace_furnishing_thumbnail_candidates',selections:'workspace_furnishing_thumbnail_selections'});
   expect((await current()).json().selectionVersion).toBe(1);expect((await app.inject({method:'GET',url:`${api}/imports/${jobId}`,headers})).json().thumbnailPreparation.status).toBe('ready');
   await issued.channel.close();combinedVerification={sealed050AppliedOnce:true,ledger47:true,existing46LedgerRowsUnchanged:true,allNineExistingTableSnapshotsUnchanged:true,selected051ReadyReceiptStillReadable:true,tables};
  }
  const shapeProbe=async(change:(row:Record<string,unknown>)=>void)=>{
   const id=randomUUID(),requestId=randomUUID(),state={kind:'current-approved-image-thumbnail',request:{requestId,expectedRevision:1},workspaceId,principalId:userId,source:{assetId:fullId,mime:'image/png',sha256:sha256(source),bytes:source.length}};
   const row:Record<string,unknown>={id,requestId,mime:'image/png',derived:state,key:`${tenantId}/quarantine/import-${id}/image-thumbnail.png`,drain:1};change(row);
   return transaction(pool,async c=>{await c.query('SAVEPOINT shape_probe');await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key,png_drain_version,state,asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12,$13,$14,'queued',$15)",[tenantId,id,userId,artworkId,'image-thumbnail:'+requestId,'a'.repeat(64),row.mime,sha256(source),source.length,rights,fullKey,row.derived,row.key,row.drain,fullId]);await c.query('ROLLBACK TO SAVEPOINT shape_probe');});
  };
  await shapeProbe(()=>{});
  for(const change of [
   (r:Record<string,unknown>)=>{r.mime='image/jpeg';},
   (r:Record<string,unknown>)=>{r.drain=0;},
   (r:Record<string,unknown>)=>{r.key='foreign';},
   (r:Record<string,unknown>)=>{delete (r.derived as Record<string,unknown>).source;},
   (r:Record<string,unknown>)=>{(r.derived as Record<string,unknown>).extra=true;},
   (r:Record<string,unknown>)=>{((r.derived as {source:Record<string,unknown>}).source).assetId=randomUUID();},
   (r:Record<string,unknown>)=>{(r.derived as Record<string,unknown>).result={};},
  ])await expect(shapeProbe(change)).rejects.toMatchObject({code:'23514'});
  // Each original branch remains accepted by the actual CHECK; no legacy
  // worker or unrelated preparation capability is enabled by this probe.
  await transaction(pool,async c=>{await c.query('SAVEPOINT legacy');
   for(const mime of ['image/png','model/gltf-binary','image/jpeg'])await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$6,100,$8,'quarantine','approved',1,$9,$10)",[tenantId,randomUUID(),userId,artworkId,randomUUID(),'a'.repeat(64),mime,rights,mime==='image/jpeg'?{}:null,mime==='image/jpeg'?'prepared':null]);
   await c.query('ROLLBACK TO SAVEPOINT legacy');});
  const evidence=process.env.EXHIBITOS_CURRENT_THUMBNAIL_EVIDENCE;
  if(evidence)await writeFile(join(evidence,'actual-ready-and-selection.json'),JSON.stringify({ready,selected:selected.json(),...(combinedVerification?{combinedVerification}:{}),legacyLedgerUnchanged:true,sourceAndArtworkUnchanged:true,oldSQL45Rejected:true,newAPIUnavailableOnSQL45:true,distinctSelectionRequired:true},null,2)+'\n');
 }finally{
  await app?.close();for(const fd of descriptors.reverse())closeSync(fd);await pool.end();await rm(root,{recursive:true,force:true});
 }
},120000);
