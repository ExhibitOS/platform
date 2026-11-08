// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable PostgreSQL and synthetic owner only; not a Manager/profile receipt.
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool,type PoolClient} from 'pg';
import {FileBlobStore,sha256,transaction,collectServiceInventory,type BlobStore} from '@exhibitos/storage';
import {WorkspaceFrameLineage} from './workspace-frame-lineage.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {framePreparationPair,FRAME_PREPARATION_POLICY} from './frame-preparation.ts';
import type {Session} from './auth.ts';
import {buildApp} from './app.ts';

const url=process.env.EXHIBITOS_TEST_DATABASE_URL,input=process.env.EXHIBITOS_FRAME_PREPARATION_INPUT_DIR;
type Writer=ConstructorParameters<typeof WorkspaceFrameLineage>[2];
const canonical=(v:unknown)=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
it('requires an actually issued owner writer rather than a copied lease shape',()=>{
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),assertDatabase:async()=>{}};
 expect(()=>new WorkspaceFrameLineage({} as BlobStore,owner,{identity:owner} as unknown as Writer)).toThrow('FURNISHING_LEASE_INVALID');
});

it('uses the ordinary authenticated owner and CSRF contract on every lineage entry',async()=>{
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),assertDatabase:async()=>{}};
 const csrf='synthetic-csrf',token='a'.repeat(43),row={id:randomUUID(),user_id:owner.principalId,tenant_id:owner.tenantId,role:'artist',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const query=vi.fn(async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[row],rowCount:1}:{rows:[],rowCount:0});
 const pool={query,connect:async()=>({query,release:()=>{}})} as never,blobs=new FileBlobStore('/synthetic-unused'),service=new WorkspaceFurnishingIntakes(blobs,owner);
 // Route tests stub only the private service boundary; actual issuance, DB,
 // blob custody and worker tests below do not use these stubs.
 const lineage={begin:vi.fn(async()=>({phase:'awaiting-original'})),read:vi.fn(async()=>({phase:'ready-to-prepare'})),upload:vi.fn(async()=>({phase:'ready-to-prepare'})),complete:vi.fn(async()=>({phase:'registered'})),cancel:vi.fn(async()=>({phase:'not-started'}))};
 vi.spyOn(service,'hasWriterLease').mockReturnValue(true);vi.spyOn(service,'supportsFramePreparation').mockReturnValue(true);vi.spyOn(service,'work').mockResolvedValue(false);vi.spyOn(service,'frameLineage').mockReturnValue(lineage as unknown as WorkspaceFrameLineage);
 const app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:owner,workspaceFurnishing:service});
 const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 const path=`/api/v1/tenants/${owner.tenantId}/workspace/furnishing-intakes/${randomUUID()}/original-lineage`;
 try{
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json().workspaceRegisteredFrameLineageProfile).toBe('registered-frame-original-lineage-v1');
  expect((await app.inject({method:'GET',url:path,headers})).statusCode).toBe(200);expect(lineage.read).toHaveBeenCalledOnce();
  expect((await app.inject({method:'POST',url:path,headers:{...headers,'x-csrf-token':'wrong'},payload:{}})).statusCode).toBe(403);expect(lineage.begin).not.toHaveBeenCalled();
  expect((await app.inject({method:'POST',url:path,headers,payload:{requestId:randomUUID()}})).statusCode).toBe(200);expect(lineage.begin).toHaveBeenCalledOnce();
  expect((await app.inject({method:'PUT',url:path+'/model',headers:{...headers,'content-type':'text/plain'},payload:'bad'})).statusCode).toBe(415);expect(lineage.upload).not.toHaveBeenCalled();
  expect((await app.inject({method:'PUT',url:path+'/model',headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.alloc(177501)})).statusCode).toBe(413);expect(lineage.upload).not.toHaveBeenCalled();
  expect((await app.inject({method:'PUT',url:path+'/model',headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.from('route-only')})).statusCode).toBe(200);expect(lineage.upload).toHaveBeenCalledOnce();
  for(const action of ['complete','cancel'] as const){expect((await app.inject({method:'POST',url:path+'/'+action,headers,payload:{unexpected:true}})).statusCode).toBe(400);expect(lineage[action]).not.toHaveBeenCalled();expect((await app.inject({method:'POST',url:path+'/'+action,headers,payload:{}})).statusCode).toBe(200);expect(lineage[action]).toHaveBeenCalledOnce();}
 }finally{await app.close();}
});

describe.skipIf(!url||!input)('registered frame original lineage with exact native worker and PostgreSQL',()=>{
 let pool:Pool,root:string,blobs:FileBlobStore,writer:Writer,service:WorkspaceFrameLineage,fd:number;
 const extra:number[]=[],catalog:{name:string;sha256:string}[]=[];
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),assertDatabase:async()=>{}};
 const session={id:randomUUID(),tenantId:owner.tenantId,userId:owner.principalId,role:'admin'} as Session;
 const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}};
 let channelOpen=true;
 const call=<T>(fn:(c:PoolClient)=>Promise<T>)=>transaction(pool,fn);
 const inventory=()=>call(c=>collectServiceInventory(c,blobs,{migrationCatalog:catalog}));
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||!/^\/exhibitos_frame_test_[a-z0-9]+$/.test(parsed.pathname))throw Error('DISPOSABLE_FRAME_DATABASE_REQUIRED');
  pool=new Pool({connectionString:url,max:3,statement_timeout:15000});
  root=realpathSync(await mkdtemp(join(tmpdir(),'registered-frame-lineage-')));
  if(process.env.EXHIBITOS_FRAME_LINEAGE_EVIDENCE_DIR)await writeFile(join(process.env.EXHIBITOS_FRAME_LINEAGE_EVIDENCE_DIR,'fixture.json'),JSON.stringify({root,...owner},null,2)+'\n');
  blobs=new FileBlobStore(join(root,'blobs'));
  fd=openSync(join(root,'native-workspace-furnishing-writers.lock'),constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);
  while(fd<10){extra.push(fd);fd=openSync(join(root,'native-workspace-furnishing-writers.lock'),constants.O_RDWR);}
  const rfd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),r=fstatSync(rfd,{bigint:true}),w=fstatSync(fd,{bigint:true});closeSync(rfd);
  // The signed lease uses the actual existing issuance/FD checks. Only the
  // parent transport and payload attestation are synthetic in this fixture.
  const {acceptFurnishingWriterLease}=await import('../../../scripts/'+'native-workspace-furnishing-admission.mjs');
  const {encodeFurnishingLeaseFrame}=await import('../../../scripts/'+'native-workspace-furnishing-lease.mjs');
  const secret=Buffer.alloc(32,7),scope={workspaceId:owner.workspaceId,tenantId:owner.tenantId,principalId:owner.principalId,runtimeGeneration:randomUUID(),mode:'workspace-furnishing-036-reopen-v1'};
  const fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)};
  writer=await acceptFurnishingWriterLease({channel:{isOpen:()=>channelOpen,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{channelOpen=false;}},secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')});
  service=new WorkspaceFrameLineage(blobs,owner,writer);
  await pool.query("CREATE TABLE local_workspaces(id uuid NOT NULL,tenant_id uuid NOT NULL,user_id uuid NOT NULL,PRIMARY KEY(id,tenant_id,user_id)); CREATE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$");
  for(const name of ['036_workspace_furnishing.sql','041_workspace_frame_preparation.sql']){
   const directory=name.startsWith('036')?'native-workspace-furnishing':'native-workspace-frame-preparation';
   const bytes=await readFile(new URL(`../../../database/${directory}/${name}`,import.meta.url));await pool.query(bytes.toString());catalog.push({name,sha256:sha256(bytes)});
  }
  await pool.query('INSERT INTO local_workspaces VALUES($1,$2,$3)',[owner.workspaceId,owner.tenantId,owner.principalId]);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL)');for(const row of catalog)await pool.query('INSERT INTO schema_migrations VALUES($1,$2)',[row.name,row.sha256]);
 });
 afterAll(async()=>{if(pool)await pool.end();channelOpen=false;if(fd!==undefined)closeSync(fd);for(const n of extra)closeSync(n);if(root&&!process.env.EXHIBITOS_FRAME_LINEAGE_EVIDENCE_DIR)await rm(root,{recursive:true,force:true});});
 async function fixture(slug='black-aluminum-frame',overrideRights=rights){
  const source=await readFile(join(input!,slug,'visual.glb')),pair=framePreparationPair({bytes:source.length,sha256:sha256(source)})!;
  expect(pair).toBeDefined();const rendered=await readFile(new URL(`../test-fixtures/${slug}-tangent-r1/model.glb`,import.meta.url));expect(sha256(rendered)).toBe(pair.renderable.sha256);
  const id=randomUUID(),requestId=randomUUID(),furnishingId=randomUUID(),declaration={requestId,kind:'artwork-frame',name:slug,rights:overrideRights,provenance:'Synthetic historical direct registration',model:pair.renderable};
  const {requestId:_request,...fields}=declaration;void _request;const descriptor={id:furnishingId,version:1,...fields},key=`${owner.tenantId}/workspace-furnishing-intake/${owner.workspaceId}/${id}/${pair.renderable.sha256}`;
  await blobs.putDurable(key,rendered);
  await pool.query("INSERT INTO workspace_furnishing_intakes(workspace_id,tenant_id,user_id,id,request_id,request_sha256,declaration,phase,received,furnishing_id,furnishing_version) VALUES($1,$2,$3,$4,$5,$6,$7,'registered',$8,$9,1)",[owner.workspaceId,owner.tenantId,owner.principalId,id,requestId,sha256(Buffer.from(canonical(declaration))),declaration,{key,bytes:rendered.length,sha256:sha256(rendered)},furnishingId]);
  await pool.query('INSERT INTO workspace_furnishing_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_key) VALUES($1,$2,$3,$4,1,$5,$6)',[owner.workspaceId,owner.tenantId,owner.principalId,furnishingId,descriptor,key]);
  return {id,key,source,rendered,declaration,input:{requestId,furnishingId,furnishingVersion:1,sourceModel:pair.source,recipe:FRAME_PREPARATION_POLICY}};
 }
 const history=async(id:string)=>(await pool.query('SELECT * FROM workspace_furnishing_intakes WHERE id=$1',[id])).rows[0];
 it('reopens each staged phase, runs the original through the worker, and settles concurrent completion exactly once',async()=>{
  for(const slug of ['black-aluminum-frame','brushed-silver-frame','natural-oak-flat-frame']){
   const f=await fixture(slug),before=await history(f.id);
   expect((await call(c=>service.read(c,session,f.id))).phase).toBe('not-started');
   const staged=await call(c=>service.begin(c,session,f.id,f.input));expect(staged.phase).toBe('awaiting-original');
   expect(await call(c=>service.begin(c,session,f.id,f.input))).toEqual(staged);
   await expect(call(c=>service.begin(c,session,f.id,{...f.input,requestId:randomUUID()}))).rejects.toMatchObject({code:'FRAME_LINEAGE_CONFLICT'});
   await expect(call(c=>service.upload(c,session,f.id,Buffer.from('bad')))).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});
   await expect(call(c=>service.complete(c,session,f.id))).rejects.toMatchObject({code:'UPLOAD_INCOMPLETE'});
   expect((await inventory()).issues).toContainEqual(expect.objectContaining({code:'FRAME_PREPARATION_UNSETTLED'}));
   service=new WorkspaceFrameLineage(blobs,owner,writer);expect((await call(c=>service.read(c,session,f.id))).phase).toBe('awaiting-original');
   const uploaded=await call(c=>service.upload(c,session,f.id,f.source));expect(uploaded.phase).toBe('ready-to-prepare');expect(await call(c=>service.upload(c,session,f.id,f.source))).toEqual(uploaded);
   // New connections and service after durable upload: no in-memory job state.
   await pool.end();pool=new Pool({connectionString:url,max:3,statement_timeout:15000});service=new WorkspaceFrameLineage(blobs,owner,writer);
   expect(await call(c=>service.read(c,session,f.id))).toEqual(uploaded);
   const [a,b]=await Promise.all([call(c=>service.complete(c,session,f.id)),call(c=>service.complete(c,session,f.id))]);
   expect(a).toEqual(b);expect(a).toMatchObject({phase:'registered',workerDrained:true,receipt:{sourceSHA256:f.input.sourceModel.sha256,renderableSHA256:sha256(f.rendered)}});
   expect(await call(c=>service.complete(c,session,f.id))).toEqual(a);
   await expect(call(c=>service.cancel(c,session,f.id))).rejects.toMatchObject({code:'JOB_STATE'});
   expect(await history(f.id)).toEqual(before);expect(Buffer.from(await blobs.get(f.key))).toEqual(f.rendered);
   const records=await pool.query('SELECT * FROM workspace_frame_preparations WHERE intake_id=$1',[f.id]);expect(records.rowCount).toBe(1);
   await expect(pool.query('DELETE FROM workspace_frame_preparations WHERE intake_id=$1',[f.id])).rejects.toThrow('immutable');
   const ordinary=new WorkspaceFurnishingIntakes(blobs,{...owner,workspaceFurnishingStool:true,workspaceFurnishingRoomVisual:true,workspaceFurnishingArtworkFrame:true,workspaceFurnishingArtworkFrameModels:true});
   expect((await call(c=>ordinary.create(c,session,f.declaration))).phase).toBe('registered');expect(await history(f.id)).toEqual(before);
   expect((await inventory()).issues).toEqual([]);
  }
 },20000);
 it('recovers a lost upload response and cancellation interruption without touching the old renderable',async()=>{
  const f=await fixture(),before=await history(f.id);await call(c=>service.begin(c,session,f.id,f.input));
  const failed=Object.create(blobs) as FileBlobStore;failed.putDurable=async(key,bytes)=>{await blobs.putDurable(key,bytes);throw Error('injected response loss after durable upload');};
  await expect(call(c=>new WorkspaceFrameLineage(failed,owner,writer).upload(c,session,f.id,f.source))).rejects.toThrow('injected response loss');
  expect((await call(c=>service.read(c,session,f.id))).phase).toBe('ready-to-prepare');
  const removal=Object.create(blobs) as FileBlobStore;removal.removeDurable=async key=>{expect(key).not.toBe(f.key);await blobs.removeDurable(key);throw Error('injected directory-sync response loss');};
  await expect(call(c=>new WorkspaceFrameLineage(removal,owner,writer).cancel(c,session,f.id))).rejects.toThrow('injected directory-sync');
  expect((await call(c=>service.read(c,session,f.id))).phase).toBe('awaiting-original');
  expect((await call(c=>service.cancel(c,session,f.id))).phase).toBe('not-started');expect((await call(c=>service.cancel(c,session,f.id))).phase).toBe('not-started');
  expect(await history(f.id)).toEqual(before);expect(Buffer.from(await blobs.get(f.key))).toEqual(f.rendered);expect((await inventory()).issues).toEqual([]);
 });
 it('refuses wrong owner, changed renderable and incompatible rights before staging',async()=>{
  const f=await fixture();await expect(call(c=>service.begin(c,{...session,userId:randomUUID()},f.id,f.input))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(call(c=>service.begin(c,session,f.id,{...f.input,sourceModel:{...f.input.sourceModel,sha256:'0'.repeat(64)}}))).rejects.toMatchObject({code:'FRAME_LINEAGE_CONFLICT'});
  await writeFile(join(root,'blobs',f.key),Buffer.from('changed'));
  try{await expect(call(c=>service.begin(c,session,f.id,f.input))).rejects.toMatchObject({code:'ASSET_INTEGRITY'});}finally{await writeFile(join(root,'blobs',f.key),f.rendered);}
  const denied=await fixture('black-aluminum-frame',{...rights,holder:'Someone else'});await expect(call(c=>service.begin(c,session,denied.id,denied.input))).rejects.toMatchObject({code:'FRAME_PREPARATION_RIGHTS_DENIED'});
  expect((await pool.query('SELECT 1 FROM workspace_frame_preparations WHERE intake_id=ANY($1::uuid[])',[[f.id,denied.id]])).rowCount).toBe(0);
 });
 it('inventory detects a missing direct-binding right or changed request even when a test bypasses immutability',async()=>{
  const row=(await pool.query("SELECT intake_id FROM workspace_frame_preparations WHERE state='registered' LIMIT 1")).rows[0];expect(row).toBeDefined();
  const prior=(await history(row.intake_id)).declaration;
  await pool.query('ALTER TABLE workspace_furnishing_intakes DISABLE TRIGGER workspace_frame_preparation_intake_immutable');
  try{
   for(const declaration of [{...prior,rights:{...prior.rights,holder:null}},{...prior,requestId:randomUUID()}]){
    await pool.query('UPDATE workspace_furnishing_intakes SET declaration=$2 WHERE id=$1',[row.intake_id,declaration]);expect((await inventory()).issues).toContainEqual({code:'FRAME_PREPARATION_BINDING_INVALID'});
   }
  }finally{await pool.query('UPDATE workspace_furnishing_intakes SET declaration=$2 WHERE id=$1',[row.intake_id,prior]);await pool.query('ALTER TABLE workspace_furnishing_intakes ENABLE TRIGGER workspace_frame_preparation_intake_immutable');}
  expect((await inventory()).issues).toEqual([]);
 });
});
