// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomBytes,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync} from 'node:fs';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import sharp from 'sharp';
import {expect,it} from 'vitest';
import {FileBlobStore,migrate,sha256,transaction} from '@exhibitos/storage';
// @ts-expect-error The test exercises the private JavaScript lease exchange.
import {acceptFurnishingOrdinaryAdmission,acceptFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
// @ts-expect-error The private lease encoder has no TypeScript declarations.
import {encodeFurnishingLeaseFrame} from '../../../scripts/native-workspace-furnishing-lease.mjs';
// @ts-expect-error Private native admission protocol helpers are implemented in JavaScript.
import {encodeFurnishingOrdinaryAssertion} from '../../../scripts/native-workspace-furnishing-ordinary-assertion.mjs';
// @ts-expect-error The native startup recovery is implemented in JavaScript.
import {recoverFreshImageClaims} from '../../../scripts/native-workspace-furnishing-recovery.mjs';
import {buildApp} from './app.ts';
import {Imports} from './imports.ts';
import {createNativeModelPreparationExecution} from './model-preparation-import.ts';
import {bindNativeOexWorkspace} from './native-oex-provenance.ts';

it.skipIf(!process.env.EXHIBITOS_FRESH_IMAGE_TEST_PG)('prepares fresh PNG and JPEG through the native HTTP routes and approves them separately',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_FRESH_IMAGE_TEST_PG});
 const root=await realpath(await mkdtemp(join(tmpdir(),'fresh-image-')));
 const blobs=new FileBlobStore(join(root,'blobs')),configRoot=join(root,'config');
 const descriptors:number[]=[];
 let app:ReturnType<typeof buildApp>|undefined;
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
  const issueWriter=async(previousRuntimeGeneration?:string)=>{
   const scope={workspaceId,tenantId,principalId:userId,runtimeGeneration:randomUUID(),mode:'workspace-furnishing-036-reopen-v1'};
   const secret=randomBytes(32),fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),lockDevice:String(lockStat.dev),lockInode:String(lockStat.ino)};
   let open=true;
   const channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{open=false;}};
   const writer=await acceptFurnishingWriterLease({channel,secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:blobs.root,configRoot});
   channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',{runtimeGeneration:scope.runtimeGeneration,leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:previousRuntimeGeneration?'interrupted-reopen':'clean-reopen',activeBindingSHA256:'b'.repeat(64),...(previousRuntimeGeneration?{previousRuntimeGeneration}:{})},secret);
   const admission=await acceptFurnishingOrdinaryAdmission({writer,channel,secret});
   return {writer,admission,channel};
  };
  let owner=await issueWriter();
  const origin='http://127.0.0.1:13200',token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const auth={mode:'local' as const,origin,bindHost:'127.0.0.1'};
  const headers={host:'127.0.0.1:13200',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
  const api=`/api/v1/tenants/${tenantId}`;
  const rights={holder:'Test owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Test owner'};
  const artistId=randomUUID();
  const migrationPath=(name:string)=>new URL(`../../../database/${name}/`,import.meta.url).pathname;
  const migrationDirectory=migrationPath('migrations'),supplementalMigrationDirectory=migrationPath('native-oex-normal');
  const modelPreparationMigrationDirectory=migrationPath('native-model-preparation'),freshImageMigrationDirectory=migrationPath('native-fresh-image-preparation');
  for(const directory of [migrationDirectory,supplementalMigrationDirectory,modelPreparationMigrationDirectory])await migrate(pool,directory);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Isolated fresh images']);
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),sha256(Buffer.from(token)),sha256(Buffer.from(csrf)),csrf,tenantId,userId]);
  await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Test artist'}]);
  const ownerUid=process.getuid!();
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,ownerUid]);
  const workspace=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid,blobRoot:blobs.root}));
  let execution=createNativeModelPreparationExecution(blobs,workspace,owner.writer,()=>true);
  let selectedFreshImage=false;
  const start=()=>buildApp({pool,auth,blobs,nativeOexWorkspace:workspace,nativeBoundedEditing:true,modelPreparationExecution:execution,
   lifecycle:{migrationDirectory,supplementalMigrationDirectory,modelPreparationMigrationDirectory,webRoot,blobRoot:blobs.root,
    ...(selectedFreshImage?{freshImageMigrationDirectory}:{})}});
  app=start();
  const session=()=>app!.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect((await session()).json().nativeFreshImagePreparationProfile).toBeUndefined();
  const readiness=()=>app!.inject({method:'GET',url:'/api/v1/readiness',headers});
  expect((await readiness()).statusCode).toBe(200);
  await migrate(pool,freshImageMigrationDirectory);
  const unselected=await readiness();
  expect(unselected.statusCode).toBe(503);
  expect(unselected.json().services).toContainEqual({name:'database',status:'unavailable'});
  await app.close();
  selectedFreshImage=true;
  app=start();
  const selected=await readiness();
  expect(selected.statusCode,selected.body).toBe(200);
  expect(selected.json().services).toContainEqual({name:'database',status:'ready'});
  expect((await session()).json().nativeFreshImagePreparationProfile).toBe('ordinary-image-preparation-v1');
  for(const mime of ['image/png','image/jpeg'] as const){
   const metadata={title:`Fresh ${mime}`,description:'',dimensions:{width:1.5,height:1,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:true,notes:''}};
   const draft=await app.inject({method:'POST',url:`${api}/cms/artworks`,headers,payload:{artistId,...metadata}});
   expect(draft.statusCode,draft.body).toBe(201);
   const artworkId=draft.json().id as string;
   const width=3072,height=2048,rgb=Buffer.alloc(width*height*3);
   for(let i=0;i<rgb.length;i++)rgb[i]=(i+Math.floor(i/(width*3)))%256;
   const image=sharp(rgb,{raw:{width,height,channels:3}});
   const source=mime==='image/png'?await image.png().toBuffer():await image.jpeg().toBuffer();
   const input={artworkId,idempotencyKey:randomUUID(),mime,sha256:sha256(source),bytes:source.length,scaleMeters:1,rights,imagePreparation:{version:1,profile:'ordinary-image-preparation-v1',artworkRevision:1}};
   const create=()=>app!.inject({method:'POST',url:`${api}/imports`,headers,payload:input});
   const created=await create();
   expect(created.statusCode,created.body).toBe(201);
   const id=created.json().id as string,jobUrl=`${api}/imports/${id}`;
   const approvalUrl=`${api}/cms/artworks/${artworkId}/fresh-image-preparations/approve`;
   const approve=()=>app!.inject({method:'POST',url:approvalUrl,headers,payload:{revision:1,jobId:id}});
   expect((await approve()).statusCode).toBe(409);
   const upload=await app.inject({method:'PUT',url:`${jobUrl}/bytes`,headers:{...headers,'content-type':'application/octet-stream'},payload:source});
   expect(upload.statusCode,upload.body).toBe(200);
   const queued=await app.inject({method:'POST',url:`${jobUrl}/complete`,headers});
   expect(queued.statusCode,queued.body).toBe(200);
   await app.close();
   app=start();
   let worker=new Imports(pool,blobs,workspace,execution);
   if(mime==='image/jpeg'){
    // Capture the actual committed claim before rolling back a worker attempt.
    let claim:Record<string,unknown>|undefined;
    expect(await worker.work({afterCopy:async()=>{
     claim=(await pool.query("SELECT derived->'claim' AS claim FROM import_jobs WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rows[0]?.claim;
     throw Error('test transaction rollback');
    }})).toBe(true);
    expect(claim).toMatchObject({runtimeGeneration:owner.writer.identity.runtimeGeneration,workspaceId,tenantId,principalId:userId});
    const failed=(await app.inject({method:'GET',url:jobUrl,headers})).json();
    expect(failed).toMatchObject({id,state:'failed',attempts:1,errorCode:'WORKER_FAILED',imagePreparation:{status:'failed',workerDrained:true}});
    // Reconstitute the retained PostgreSQL row from the captured crash boundary.
    // The fixture does not claim to exercise Manager's real process/lock recovery.
    const token=claim!.token;
    await pool.query(`UPDATE import_jobs SET state='processing',lease_id=$3,
     lease_until=now()+interval '30 seconds',png_worker_tokens=ARRAY[$3::uuid],
     derived=jsonb_set(derived,'{claim}',$4) WHERE tenant_id=$1 AND id=$2`,[tenantId,id,token,claim]);
    await expect(recoverFreshImageClaims(pool,workspace,owner.writer,owner.admission)).rejects.toThrow('FRESH_IMAGE_RECOVERY_UNAVAILABLE');
    expect((await approve()).statusCode).toBe(409);
    await app.close();
    await owner.channel.close();
    owner=await issueWriter(String(claim!.runtimeGeneration));
    execution=createNativeModelPreparationExecution(blobs,workspace,owner.writer,()=>true);
    app=start();
    expect(await recoverFreshImageClaims(pool,workspace,owner.writer,owner.admission)).toBe(1);
    expect(await recoverFreshImageClaims(pool,workspace,owner.writer,owner.admission)).toBe(0);
    const recovered=(await app.inject({method:'GET',url:jobUrl,headers})).json();
    expect(recovered).toMatchObject({id,state:'failed',attempts:1,errorCode:'IMAGE_PREPARATION_INTERRUPTED',imagePreparation:{status:'failed',workerDrained:true}});
    worker=new Imports(pool,blobs,workspace,execution);
    const retry=await app.inject({method:'POST',url:`${jobUrl}/retry`,headers});
    expect(retry.statusCode,retry.body).toBe(200);
    expect(retry.json()).toMatchObject({id,state:'queued',attempts:1});
   }
   expect(await worker.work()).toBe(true);
   const readyResponse=await app.inject({method:'GET',url:jobUrl,headers});
   expect(readyResponse.statusCode,readyResponse.body).toBe(200);
   const ready=readyResponse.json().imagePreparation;
   expect(ready,readyResponse.body).toMatchObject({status:'ready',workerDrained:true,original:{sha256:input.sha256,bytes:source.length,mime},full:{width:2048,height:1365},coarse:{width:512,height:341}});
   const generic=await app.inject({method:'POST',url:`${api}/cms/artworks/${artworkId}/approve`,headers,payload:{revision:1,assetId:ready.full.assetId}});
   expect(generic.statusCode,generic.body).toBe(409);
   const derivative=()=>app!.inject({method:'GET',url:`${api}/assets/${ready.coarse.assetId}/bytes`,headers});
   expect((await derivative()).statusCode).toBe(403);
   const originalPath=`${api}/assets/${ready.original.assetId}`;
   const verifyPrivateSource=async()=>{
    for(const [method,suffix] of [['GET',''],['GET','/bytes'],['POST','/export-check']] as const){
     const response=await app!.inject({method,url:originalPath+suffix,headers});
     expect(response.statusCode,response.body).toBe(403);
    }
   };
   await verifyPrivateSource();
   const approvals=await Promise.all([approve(),approve()]);
   for(const approval of approvals)expect(approval.statusCode,approval.body).toBe(200);
   expect(approvals[0]!.json()).toEqual(approvals[1]!.json());
   await verifyPrivateSource();
   expect((await create()).json().id).toBe(id);
   const approved=await app.inject({method:'GET',url:`${api}/studio/artworks/${artworkId}`,headers});
   expect(approved.statusCode,approved.body).toBe(200);
   const artwork=approved.json().artwork;
   expect(artwork.primaryAssetId).toBe(ready.full.assetId);
   expect(artwork.assets.map((asset:{sha256:string})=>asset.sha256)).toEqual([ready.full.sha256,ready.coarse.sha256]);
   const download=await app.inject({method:'GET',url:`${api}/assets/${ready.full.assetId}/bytes`,headers});
   expect(download.statusCode,download.body).toBe(200);
   expect(sha256(download.rawPayload)).toBe(ready.full.sha256);
   const coarse=await derivative();
   expect(coarse.statusCode,coarse.body).toBe(200);
   expect(sha256(coarse.rawPayload)).toBe(ready.coarse.sha256);
   const row=(await pool.query('SELECT object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];
   expect(await blobs.getBounded(row.object_key,source.length)).toEqual(source);
   const snapshots=await transaction(pool,c=>c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2',[tenantId,artworkId]));
   expect(snapshots.rows).toHaveLength(1);
   expect(snapshots.rows[0].snapshot.freshImagePreparation).toBe(ready.serverReceipt.sha256);
  }
 }finally{
  await app?.close();
  for(const fd of descriptors)closeSync(fd);
  await pool.end();
  await rm(root,{recursive:true,force:true});
 }
},90000);
