// SPDX-License-Identifier: AGPL-3.0-or-later
import {request} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {expect,it} from 'vitest';
import {collectServiceInventory,createServiceBackup,FileBlobStore,migrate,restoreServiceBackup,sha256,transaction} from '@exhibitos/storage';
// @ts-expect-error The test exercises the private JavaScript lease exchange.
import {acceptFurnishingOrdinaryAdmission,acceptFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
// @ts-expect-error The private lease encoder has no TypeScript declarations.
import {encodeFurnishingLeaseFrame} from '../../../scripts/native-workspace-furnishing-lease.mjs';
// @ts-expect-error Private native admission protocol helpers are implemented in JavaScript.
import {encodeFurnishingOrdinaryAssertion} from '../../../scripts/native-workspace-furnishing-ordinary-assertion.mjs';
// @ts-expect-error Native startup recovery is implemented in JavaScript.
import {recoverLargeModelClaims} from '../../../scripts/native-workspace-furnishing-recovery.mjs';
import {buildApp} from './app.ts';
import {Imports} from './imports.ts';
import {COMPACT_MODEL_RECIPE,LARGE_MODEL_RECIPE} from './oam-original-preparation.ts';
import {createNativeModelPreparationExecution} from './model-preparation-import.ts';
import {bindNativeOexWorkspace} from './native-oex-provenance.ts';
// @ts-expect-error Backup catalog routing is an existing JavaScript runtime entry.
import {inventorySnapshotOptionsForDatabase} from '../../../scripts/service-backup.mjs';
const run=promisify(execFile);


it.skipIf(!process.env.EXHIBITOS_LARGE_MODEL_TEST_PG||!process.env.EXHIBITOS_LARGE_MODEL_TEST_SOURCE||!process.env.EXHIBITOS_LARGE_MODEL_TEST_PG_BIN)(
 'routes a real >32 MiB embedded GLB through native 046 custody, drain and explicit approval',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_LARGE_MODEL_TEST_PG});
 const root=await realpath(await mkdtemp(join(tmpdir(),'large-glb-')));
 const blobs=new FileBlobStore(join(root,'blobs')),configRoot=join(root,'config');
 const descriptors:number[]=[];
 let app:ReturnType<typeof buildApp>|undefined;
 try{
  await mkdir(blobs.root,{mode:0o700});
  await mkdir(configRoot,{mode:0o700});
  const webRoot=join(root,'web');
  await mkdir(webRoot,{mode:0o700});
  await writeFile(join(webRoot,'index.html'),'<!doctype html><title>Native large GLB readiness</title>');
  const lock=join(root,'native-workspace-furnishing-writers.lock');
  let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);
  descriptors.push(fd);
  while(fd<10){fd=openSync(lock,constants.O_RDWR);descriptors.push(fd);}
  const rootStat=lstatSync(root,{bigint:true}),lockStat=fstatSync(fd,{bigint:true});
  const tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID();
  const issueWriter=async(previousRuntimeGeneration?:string)=>{
   const scope={workspaceId,tenantId,principalId:userId,runtimeGeneration:randomUUID(),mode:'workspace-furnishing-036-reopen-v1'};
   const secret=randomBytes(32),fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),lockDevice:String(lockStat.dev),lockInode:String(lockStat.ino)};
   let open=true;
   const channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{open=false;}};
   const writer=await acceptFurnishingWriterLease({channel,secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:blobs.root,configRoot});
   channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',
    {runtimeGeneration:scope.runtimeGeneration,leaseTranscriptSHA256:writer.leaseTranscriptSHA256,
     admissionKind:previousRuntimeGeneration?'interrupted-reopen':'clean-reopen',activeBindingSHA256:'b'.repeat(64),
     ...(previousRuntimeGeneration?{previousRuntimeGeneration}:{})},secret);
   const admission=await acceptFurnishingOrdinaryAdmission({writer,channel,secret});
   return {writer,admission,channel};
  };
  let owner=await issueWriter();
  const origin='http://127.0.0.1:13200',token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const auth={mode:'local' as const,origin,bindHost:'127.0.0.1'};
  const headers={host:'127.0.0.1:13200',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
  const octets={...headers,'content-type':'application/octet-stream'};
  const api=`/api/v1/tenants/${tenantId}`,artistId=randomUUID(),ownerUid=process.getuid!();
  const migrationPath=(name:string)=>new URL(`../../../database/${name}/`,import.meta.url).pathname;
  const migrations=['migrations','native-oex-normal','native-oex-workspace-import','native-oex-workspace-import-wall',
   'native-workspace-furnishing','native-workspace-furnishing-writer','native-workspace-furnishing-publication',
   'native-workspace-material-publication','native-workspace-material-multimap','native-workspace-frame-preparation',
   'native-hayes-original','native-hayes-disposition','native-hayes-release','native-model-preparation'];
  for(const name of migrations)await migrate(pool,migrationPath(name));
  const [migrationDirectory,supplementalMigrationDirectory]=migrations.slice(0,2).map(migrationPath) as [string,string];
  const largeModelMigrationDirectory=migrationPath('native-large-model-preparation');
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Isolated large GLB']);
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),sha256(Buffer.from(token)),sha256(Buffer.from(csrf)),csrf,tenantId,userId]);
  await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic owner'}]);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,ownerUid]);
  const workspace=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid,blobRoot:blobs.root}));
  let execution=createNativeModelPreparationExecution(blobs,workspace,owner.writer,()=>true);
  let selected=false;
  const start=()=>buildApp({pool,auth,blobs,nativeOexWorkspace:workspace,nativeBoundedEditing:true,modelPreparationExecution:execution,
   lifecycle:{migrationDirectory,supplementalMigrationDirectory,webRoot,blobRoot:blobs.root,
    workspaceImportMigrationDirectory:migrationPath('native-oex-workspace-import'),
    workspaceWallImportMigrationDirectory:migrationPath('native-oex-workspace-import-wall'),
    workspaceFurnishingMigrationDirectory:migrationPath('native-workspace-furnishing'),
    workspaceFurnishingWriterMigrationDirectory:migrationPath('native-workspace-furnishing-writer'),
    workspaceFurnishingPublicationMigrationDirectory:migrationPath('native-workspace-furnishing-publication'),
    workspaceMaterialPublicationMigrationDirectory:migrationPath('native-workspace-material-publication'),
    workspaceMaterialMultimapMigrationDirectory:migrationPath('native-workspace-material-multimap'),
    workspaceFramePreparationMigrationDirectory:migrationPath('native-workspace-frame-preparation'),
    hayesOriginalMigrationDirectory:migrationPath('native-hayes-original'),
    hayesDispositionMigrationDirectory:migrationPath('native-hayes-disposition'),
    hayesReleaseMigrationDirectory:migrationPath('native-hayes-release'),
    modelPreparationMigrationDirectory:migrationPath('native-model-preparation'),
    ...(selected?{largeModelMigrationDirectory}:{})}});
  app=start();
  const session=()=>app!.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect((await session()).json().nativeLargeModelPreparationProfile).toBeUndefined();
  const readiness=()=>app!.inject({method:'GET',url:'/api/v1/readiness',headers});
  expect((await readiness()).statusCode).toBe(200);
  await migrate(pool,largeModelMigrationDirectory);
  expect((await readiness()).statusCode).toBe(503);
  await app.close();
  selected=true;
  app=start();
  expect((await readiness()).statusCode).toBe(200);
  expect((await session()).json()).toMatchObject({nativeLargeModelPreparationProfile:LARGE_MODEL_RECIPE.id,modelPreparationProfile:COMPACT_MODEL_RECIPE.id});
  expect((await session()).json().nativeFreshImagePreparationProfile).toBeUndefined();

  const source=await readFile(process.env.EXHIBITOS_LARGE_MODEL_TEST_SOURCE!);
  const identity={bytes:source.length,sha256:sha256(source)};
  expect(identity).toEqual({bytes:58293704,sha256:'75aef54fa379a4981e8b286886836ef1bd4627158dbc0b0387dad9b5ecc9f9a4'});
  const inspection=await app.inject({method:'POST',url:`${api}/imports/large-model-inspection`,headers:octets,payload:source});
  expect(inspection.statusCode,inspection.body).toBe(200);
  expect(inspection.json()).toMatchObject({profileId:LARGE_MODEL_RECIPE.id,original:{...identity,mime:'model/gltf-binary'},triangles:293378,vertices:147456,qualification:'structure-only'});

  const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic owner'};
  const metadata={title:'Synthetic curved surface',description:'',dimensions:{width:2,height:1.5,depth:.16,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:true,notes:''}};
  const draft=await app.inject({method:'POST',url:`${api}/cms/artworks`,headers,payload:{artistId,...metadata}});
  expect(draft.statusCode,draft.body).toBe(201);
  const artworkId=draft.json().id as string,idempotencyKey=randomUUID(),generation=randomUUID();
  const create=(profileId:string)=>app!.inject({method:'POST',url:`${api}/imports`,headers,payload:{artworkId,idempotencyKey,mime:'model/gltf-binary',...identity,scaleMeters:1,rights,
   modelPreparation:{version:1,profileId,operationID:idempotencyKey,generation,artworkRevision:1}}});
  expect((await create(COMPACT_MODEL_RECIPE.id)).statusCode).toBe(400);
  const created=await create(LARGE_MODEL_RECIPE.id);
  expect(created.statusCode,created.body).toBe(201);
  const id=created.json().id as string,jobUrl=`${api}/imports/${id}`;
  expect((await create(LARGE_MODEL_RECIPE.id)).json().id).toBe(id);
  const nativeAddress=await app.listen({host:'127.0.0.1',port:0});
  const preBody=async(method:string,path:string,cookie?:string)=>new Promise<number|undefined>((resolve,reject)=>{
   const req=request(nativeAddress+path,{method,headers:{host:headers.host,origin,'content-type':'application/octet-stream',
    'content-length':String(source.length),...(cookie?{cookie}:{})}},response=>{
    response.resume();resolve(response.statusCode);req.destroy();
   });
   req.setTimeout(3000,()=>req.destroy(Error('large request was not rejected before body parsing')));
   req.once('error',reject);
   req.flushHeaders(); // Deliberately send no bytes.
  });
  expect(await preBody('POST',`${api}/imports/large-model-inspection`)).toBe(401);
  expect(await preBody('PUT',`${jobUrl}/large-model-bytes`,headers.cookie)).toBe(403);

  expect((await app.inject({method:'PUT',url:`${jobUrl}/bytes`,headers:octets,payload:source})).statusCode).toBe(413);
  const upload=await app.inject({method:'PUT',url:`${jobUrl}/large-model-bytes`,headers:octets,payload:source});
  expect(upload.statusCode,upload.body).toBe(200);
  expect(upload.json().received).toBe(source.length);
  const queued=await app.inject({method:'POST',url:`${jobUrl}/complete`,headers});
  expect(queued.statusCode,queued.body).toBe(200);
  await app.close();
  app=start();
  let claim:Record<string,unknown>|undefined;
  const failedWorker=new Imports(pool,blobs,workspace,execution);
  expect(await failedWorker.work({afterCopy:async()=>{
   claim=(await pool.query("SELECT model_preparation->'claim' AS claim FROM import_jobs WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rows[0]?.claim;
   throw Error('fixture rolls back the real prepared attempt');
  }})).toBe(true);
  expect(claim).toMatchObject({runtimeGeneration:owner.writer.identity.runtimeGeneration,workspaceId,tenantId,principalId:userId});
  const failed=(await app.inject({method:'GET',url:jobUrl,headers})).json();
  expect(failed).toMatchObject({id,state:'failed',errorCode:'WORKER_FAILED',modelPreparation:{workerDrained:true}});
  // Restore the precise pre-commit row captured above. Physical process drain
  // and re-entry are independently owned by the Manager validation.
  await pool.query(`UPDATE import_jobs SET state='processing',lease_id=$3::uuid,
   lease_until=now()+interval '30 seconds',png_worker_tokens=ARRAY[$3::uuid],
   model_preparation=jsonb_set(model_preparation,'{claim}',$4)
   WHERE tenant_id=$1 AND id=$2`,[tenantId,id,claim!.token,claim]);
  await expect(recoverLargeModelClaims(pool,blobs,workspace,owner.writer,owner.admission)).rejects.toThrow('LARGE_MODEL_RECOVERY_UNAVAILABLE');
  await app.close();
  await owner.channel.close();
  owner=await issueWriter(randomUUID());
  await expect(recoverLargeModelClaims(pool,blobs,workspace,owner.writer,owner.admission)).rejects.toThrow('LARGE_MODEL_RECOVERY_UNAVAILABLE');
  await owner.channel.close();
  owner=await issueWriter(String(claim!.runtimeGeneration));
  execution=createNativeModelPreparationExecution(blobs,workspace,owner.writer,()=>true);
  app=start();
  expect(await recoverLargeModelClaims(pool,blobs,workspace,owner.writer,owner.admission)).toBe(1);
  expect(await recoverLargeModelClaims(pool,blobs,workspace,owner.writer,owner.admission)).toBe(0);
  const recovered=(await app.inject({method:'GET',url:jobUrl,headers})).json();
  expect(recovered).toMatchObject({id,state:'failed',attempts:1,errorCode:'MODEL_PREPARATION_INTERRUPTED',modelPreparation:{workerDrained:true}});
  const retry=await app.inject({method:'POST',url:`${jobUrl}/retry`,headers});
  expect(retry.statusCode,retry.body).toBe(200);
  expect(retry.json().id).toBe(id);
  const claims=await Promise.all([new Imports(pool,blobs,workspace,execution).work(),new Imports(pool,blobs,workspace,execution).work()]);
  expect(claims.sort()).toEqual([false,true]);
  const observed=await app.inject({method:'GET',url:jobUrl,headers});
  expect(observed.statusCode,observed.body).toBe(200);
  const ready=observed.json().modelPreparation;
  expect(ready,observed.body).toMatchObject({profileId:LARGE_MODEL_RECIPE.id,status:'ready',workerDrained:true,original:{...identity,mime:'model/gltf-binary'},
   display:{bytes:2230908,sha256:'68b8c46b03d225002e793ea64277fac44cc11d78a602cf9029ff94cb66dde2b6',reusedOriginal:false},
   serverReceipt:{producer:{output:{triangles:20000,textureEdge:512}}}});
  const before=await app.inject({method:'GET',url:`${api}/studio/artworks/${artworkId}`,headers});
  expect(before.statusCode).not.toBe(200);
  const approve=()=>app!.inject({method:'POST',url:`${api}/cms/artworks/${artworkId}/approve`,headers,payload:{revision:1,assetId:ready.display.assetId}});
  const approved=await approve();
  expect(approved.statusCode,approved.body).toBe(200);
  expect((await approve()).json()).toEqual(approved.json());
  const studio=await app.inject({method:'GET',url:`${api}/studio/artworks/${artworkId}`,headers});
  expect(studio.statusCode,studio.body).toBe(200);
  expect(studio.json().artwork.primaryAssetId).toBe(ready.display.assetId);
  const row=(await pool.query('SELECT object_key,approved_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];
  expect(sha256(await blobs.getLargeModelSource(row.object_key,source.length))).toBe(identity.sha256);
  expect(sha256(await blobs.getBounded(row.approved_key,ready.display.bytes))).toBe(ready.display.sha256);
  await expect(blobs.get(row.object_key)).rejects.toThrow('object size limit');
  const snapshot=async(c:Parameters<typeof collectServiceInventory>[0],authenticated?:Parameters<typeof inventorySnapshotOptionsForDatabase>[3])=>
   collectServiceInventory(c,blobs,await inventorySnapshotOptionsForDatabase(c,migrationDirectory,supplementalMigrationDirectory,authenticated));
  const inventory=await transaction(pool,c=>snapshot(c));
  expect(inventory.issues).toEqual([]);
  expect(inventory.references).toContainEqual(expect.objectContaining({key:row.object_key,largeModelSource:true,expectedBytes:source.length}));
  const bin=process.env.EXHIBITOS_LARGE_MODEL_TEST_PG_BIN!,sourceURL=process.env.EXHIBITOS_LARGE_MODEL_TEST_PG!;
  const targetURL=new URL(sourceURL),targetName='restored_large_'+randomUUID().replaceAll('-','');
  targetURL.pathname='/'+targetName;
  await pool.query(`CREATE DATABASE ${targetName}`);
  const target=new Pool({connectionString:targetURL.href}),targetBlobs=new FileBlobStore(join(root,'restored-blobs'));
  try{
   await mkdir(targetBlobs.root,{mode:0o700});
   const encryptionKey=randomBytes(32),destination=join(root,'archive');
   await createServiceBackup({pool,store:blobs,destination,encryptionKey,snapshot,
    dump:async(path,id)=>{await run(join(bin,'pg_dump'),['--format=custom','--snapshot='+id,'--file='+path,sourceURL]);}});
   const restored=await restoreServiceBackup({pool:target,store:targetBlobs,source:destination,encryptionKey,destination:join(root,'restored'),
    snapshot:async(c,authenticated)=>collectServiceInventory(c,targetBlobs,await inventorySnapshotOptionsForDatabase(c,migrationDirectory,supplementalMigrationDirectory,authenticated)),
    restore:async(path)=>{await run(join(bin,'pg_restore'),['--exit-on-error','--dbname='+targetURL.href,path]);}});
   expect(restored.inventory.objects).toContainEqual(expect.objectContaining({key:row.object_key,bytes:source.length,sha256:identity.sha256}));
   expect(sha256(await targetBlobs.getLargeModelSource(row.object_key,source.length))).toBe(identity.sha256);
  }finally{await target.end();}

 }finally{
  await app?.close();
  for(const fd of descriptors)closeSync(fd);
  await pool.end();
  await rm(root,{recursive:true,force:true});
 }
},90000);
