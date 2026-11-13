// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,expect,it,vi} from 'vitest';
import {constants,openSync,closeSync,fstatSync} from 'node:fs';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {WorkspaceFurnishingThumbnails} from './workspace-furnishing-thumbnails.ts';
import {validateFurnishingThumbnailPng} from './workspace-furnishing-thumbnail-validation.ts';
import {ApiError,type Session} from './auth.ts';
import {pngCrc} from './png-pixels.ts';
import {buildApp} from './app.ts';
import {installedFrameThumbnail} from './installed-artwork-frame.ts';
vi.mock('./workspace-furnishing-thumbnail-validation.ts',()=>({validateFurnishingThumbnailPng:vi.fn(async()=>{})}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.mocked(validateFurnishingThumbnailPng).mockReset().mockResolvedValue(undefined);for(const work of cleanup.splice(0))await work();});
function png(value=100){
 const chunk=(name:string,data:Buffer)=>{const payload=Buffer.concat([Buffer.from(name),data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);payload.copy(out,4);out.writeUInt32BE(pngCrc(payload),out.length-4);return out;};
 const h=Buffer.alloc(13);h.writeUInt32BE(256);h.writeUInt32BE(256,4);h[8]=8;h[9]=2;const pixels=Buffer.alloc(256*(256*3+1),value);for(let y=0;y<256;y++)pixels[y*(256*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
type SqlRow=Record<string,unknown>;
/** A narrow durable-table emulator, not database/migration qualification. */
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'furnishing-thumbnail-test-'))),fds:number[]=[];let channelOpen=true;
 cleanup.push(async()=>{channelOpen=false;for(const fd of fds)closeSync(fd);await rm(root,{recursive:true,force:true});});
 const lock=join(root,'native-workspace-furnishing-writers.lock');let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);fds.push(fd);
 while(fd<10){fd=openSync(lock,constants.O_RDWR);fds.push(fd);}
 const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),rootStat=fstatSync(rootFd,{bigint:true}),lockStat=fstatSync(fd,{bigint:true});closeSync(rootFd);
 const owner={workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:vi.fn(async()=>{})};
 const scope={workspaceId:owner.workspaceId,tenantId:owner.tenantId,principalId:owner.principalId,runtimeGeneration:id(8),mode:'workspace-furnishing-036-reopen-v1'};
 const fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),lockDevice:String(lockStat.dev),lockInode:String(lockStat.ino)},secret=Buffer.alloc(32,7);
 // Match the existing issued-writer fixture: these private runtime issuance
 // exports are dynamically loaded; the resulting guard retains its public type.
 const {acceptFurnishingWriterLease}=await import('../../../scripts/'+'native-workspace-furnishing-admission.mjs');
 const {encodeFurnishingLeaseFrame}=await import('../../../scripts/'+'native-workspace-furnishing-lease.mjs');
 const writer:ConstructorParameters<typeof WorkspaceFurnishingThumbnails>[2]=await acceptFurnishingWriterLease({channel:{isOpen:()=>channelOpen,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{channelOpen=false;}},secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')});
 const blobs=new FileBlobStore(join(root,'blobs')),source=Buffer.from('Synthetic previously registered furnishing GLB');
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}};
 const descriptor={id:id(4),version:1 as const,kind:'info-stand' as const,name:'Synthetic stand',rights,provenance:'Synthetic registered fixture',model:{mime:'model/gltf-binary' as const,bytes:source.length,sha256:sha256(source)}};
 const modelKey=`${owner.tenantId}/workspace-furnishing-intake/${owner.workspaceId}/${id(5)}/${descriptor.model.sha256}`;await blobs.putDurable(modelKey,source);
 const tables=new Map<string,SqlRow[]>(),schemaName='050_workspace_furnishing_thumbnail.sql';
 const schemaSHA=sha256(await readFile(new URL('../../../database/native-workspace-furnishing-thumbnail/'+schemaName,import.meta.url)));
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(/\b(?:artworks|artwork_approvals|artwork_thumbnail_bindings|artwork_thumbnail_selections|assets|rights)\b/i.test(sql))throw Error('Unexpected artwork/asset authority SQL');
  if(sql.includes('schema_migrations'))return {rows:[{name:schemaName,sha256:schemaSHA}],rowCount:1};
  if(sql.includes('FROM workspace_furnishing_versions')){
   const matches=args[0]===owner.workspaceId&&args[1]===owner.tenantId&&args[2]===owner.principalId&&args[3]===descriptor.id&&args[4]===1;
   return {rows:matches?[{descriptor,object_key:modelKey}]:[],rowCount:matches?1:0};
  }
  if(sql.startsWith('SELECT count(*)::integer AS count FROM workspace_furnishing_thumbnail_candidates'))return {rows:[{count:(tables.get('workspace_furnishing_thumbnail_candidates')??[]).filter(row=>row.workspace_id===args[0]&&row.furnishing_id===args[1]&&row.furnishing_version===args[2]).length}],rowCount:1};
  const insertion=/^INSERT INTO (workspace_furnishing_thumbnail_\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
  if(insertion){
   const table=insertion[1]!,columns=insertion[2]!.split(',').map(s=>s.trim()),values=insertion[3]!.split(',').map(s=>s.trim());
   const row:SqlRow={created_at:new Date('2026-11-11T15:00:00.000Z')};columns.forEach((column,i)=>{const v=values[i]!,parameter=/^\$(\d+)/.exec(v);row[column]=parameter?args[Number(parameter[1])-1]:v==='NULL'?null:v.replace(/^'|'$/g,'');});
   const rows=tables.get(table)??[];rows.push(row);tables.set(table,rows);return {rows:[row],rowCount:1};
  }
  const selection=/FROM (workspace_furnishing_thumbnail_\w+)/.exec(sql);
  if(selection){
   let rows=[...(tables.get(selection[1]!)??[])];
   for(const match of sql.matchAll(/\b([a-z_]+)\s*=\s*\$(\d+)/g))rows=rows.filter(row=>row[match[1]!]===args[Number(match[2])-1]);
   if(/ORDER BY.*(?:version|selection_version).*DESC/.test(sql))rows.sort((a,b)=>Number(b.selection_version??b.version)-Number(a.selection_version??a.version));
   if(/LIMIT 1\b/.test(sql))rows=rows.slice(0,1);return {rows,rowCount:rows.length};
  }
  if(sql==='SELECT 1 FROM workspace_furnishing_intakes LIMIT 0')return {rows:[],rowCount:0};
  if(/^(?:SELECT pg_advisory|BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)/.test(sql))return {rows:[],rowCount:1};
  throw Error('Unexpected SQL in furnishing thumbnail fixture: '+sql);
 });
 const c={query} as unknown as PoolClient,s={id:id(9),tenantId:owner.tenantId,userId:owner.principalId,role:'artist'} as Session;
 const registry=new WorkspaceFurnishingIntakes(blobs,owner,writer),service=new WorkspaceFurnishingThumbnails(blobs,owner,writer,registry),image=png();
 const input={kind:'workspace-furnishing-thumbnail-v1',requestId:id(10),renderRequest:{version:1,epoch:id(11),sequence:1,tenantId:owner.tenantId,principalId:owner.principalId,requestId:id(10),furnishingId:descriptor.id,furnishingVersion:1,modelBytes:source.length,modelSha256:descriptor.model.sha256,recipeId:'furnishing-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1'},pngSha256:sha256(image),pngBytes:image.length,pngBase64:image.toString('base64')};
 return {root,owner,writer,blobs,source,descriptor,modelKey,rights,tables,query,c,s,registry,service,image,input,reopen:()=>new WorkspaceFurnishingThumbnails(blobs,owner,writer,registry),revokeWriter:()=>{channelOpen=false;}};
}
const rows=(f:Awaited<ReturnType<typeof fixture>>,table:'candidates'|'selections')=>f.tables.get('workspace_furnishing_thumbnail_'+table)??[];
const selectedInput=(candidate:{candidateId:string;receiptSha256:string},requestId=id(20),expectedSelectionVersion=0)=>({requestId,candidateId:candidate.candidateId,receiptSha256:candidate.receiptSha256,expectedSelectionVersion});
describe('workspace furnishing thumbnail persistence authority',()=>{
 it('serves the explicit immutable installed-card routes only after owner authorization and exposes no mutation route',async()=>{
  const f=await fixture(),token='a'.repeat(43),authRow={id:id(60),user_id:f.s.userId,tenant_id:f.s.tenantId,role:'artist',csrf_hash:'a'.repeat(64),csrf_token:'synthetic',expires_at:new Date('2099-01-01T00:00:00Z')};
  const query=async(sql:string,args:unknown[]=[])=>sql.includes('SELECT s.*,m.role')?{rows:[authRow],rowCount:1}:f.query(sql,args),client={query,release:()=>{}},pool={query,connect:async()=>client} as unknown as Pool;
  const thumbnail=installedFrameThumbnail('af88109b-27e2-4d10-a08c-3ddc0224451a')!,bytes=await readFile(new URL('../test-fixtures/thin-brass-frame/thumbnail.png',import.meta.url));
  vi.spyOn(f.registry,'work').mockResolvedValue(false);const read=vi.spyOn(f.registry,'installedThumbnail').mockResolvedValue({thumbnail,bytes}),app=buildApp({pool,blobs:f.blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:f.owner,workspaceFurnishing:f.registry});
  const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`},path=`/api/v1/tenants/${f.s.tenantId}/workspace/furnishings/${thumbnail.source.furnishingId}/versions/1/installed-thumbnail`;
  try{
   const metadata=await app.inject({method:'GET',url:path,headers});expect(metadata.statusCode,metadata.body).toBe(200);expect(metadata.json()).toEqual(thumbnail);
   const image=await app.inject({method:'GET',url:path+'/image',headers});expect(image.statusCode,image.body).toBe(200);expect(image.rawPayload).toEqual(bytes);expect(image.headers['x-exhibitos-sha256']).toBe(thumbnail.png.sha256);expect(image.headers['cache-control']).toBe('no-store');
   read.mockImplementationOnce(async()=>{f.owner.assertDatabase.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));return {thumbnail,bytes};});const denied=await app.inject({method:'GET',url:path+'/image',headers});expect(denied.statusCode).toBe(403);expect(denied.rawPayload).not.toEqual(bytes);
   const noSession=await app.inject({method:'GET',url:path,headers:{host:headers.host,origin:headers.origin}});expect(noSession.statusCode).toBe(401);
   const mutation=await app.inject({method:'POST',url:path,headers,payload:{}});expect(mutation.statusCode).toBe(404);expect(rows(f,'candidates')).toEqual([]);expect(rows(f,'selections')).toEqual([]);
  }finally{await app.close();}
 });
 it('requires actual issued writer and exact registry owner/store binding',async()=>{
  const f=await fixture();expect(()=>new WorkspaceFurnishingThumbnails(f.blobs,f.owner,{...f.writer},f.registry)).toThrow('FURNISHING_LEASE_INVALID');
  expect(()=>new WorkspaceFurnishingThumbnails(f.blobs,{...f.owner},f.writer,f.registry)).toThrow('FURNISHING_LEASE_INVALID');await expect(f.service.ready(f.c,f.s)).resolves.toBeUndefined();
 });
 it('persists ready candidate exactly once without selecting, touching original model or writing artwork authority',async()=>{
  const f=await fixture(),before=structuredClone(f.descriptor),put=vi.spyOn(f.blobs,'putDurable');
  const first=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input),again=await f.service.create(f.c,f.s,f.descriptor.id,1,structuredClone(f.input));
  expect(again).toEqual(first);expect(first).toMatchObject({state:'ready',source:{furnishingId:f.descriptor.id,furnishingVersion:1,modelSha256:f.descriptor.model.sha256,modelBytes:f.source.length},thumbnail:{mime:'image/png',width:256,height:256,bytes:f.image.length,sha256:sha256(f.image)}});
  expect(rows(f,'candidates')).toHaveLength(1);expect(rows(f,'selections')).toHaveLength(0);expect(put).toHaveBeenCalledTimes(1);expect(validateFurnishingThumbnailPng).toHaveBeenCalledWith(f.image,{writerFd:f.writer.writerFd});
  expect(await f.service.current(f.c,f.s,f.descriptor.id,1)).toMatchObject({selectionVersion:0,selected:null});expect(f.descriptor).toEqual(before);expect(await f.blobs.get(f.modelKey)).toEqual(f.source);
  expect(f.query.mock.calls.every(([sql])=>!/^\s*(?:INSERT|UPDATE|DELETE).*\b(?:workspace_furnishing_versions|artworks|assets|artwork_thumbnail_bindings)\b/.test(sql))).toBe(true);
 });
 it('conflicts for same POST request identity with different reviewed PNG or render metadata',async()=>{
  const f=await fixture();await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);const other=png(120);
  for(const change of [{...f.input,pngBase64:other.toString('base64'),pngSha256:sha256(other),pngBytes:other.length},{...f.input,renderRequest:{...f.input.renderRequest,sequence:2}}])await expect(f.service.create(f.c,f.s,f.descriptor.id,1,change)).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_CONFLICT'});
  expect(rows(f,'candidates')).toHaveLength(1);expect(rows(f,'selections')).toHaveLength(0);
 });
 it('selects explicitly with CAS, replays without another event and reopens authoritative current/candidate/image',async()=>{
  const f=await fixture(),first=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input),request=selectedInput(first);
  const chosen=await f.service.select(f.c,f.s,f.descriptor.id,1,request);expect(chosen).toMatchObject({selectionVersion:1,selected:{candidateId:first.candidateId,receiptSha256:first.receiptSha256}});
  expect(await f.service.select(f.c,f.s,f.descriptor.id,1,request)).toEqual(chosen);expect(rows(f,'selections')).toHaveLength(1);
  await expect(f.service.select(f.c,f.s,f.descriptor.id,1,{...request,requestId:id(21)})).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_CONFLICT'});
  await expect(f.service.select(f.c,f.s,f.descriptor.id,1,{...request,expectedSelectionVersion:1})).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_CONFLICT'});
  const reopened=f.reopen();expect(await reopened.current(f.c,f.s,f.descriptor.id,1)).toEqual(chosen);expect(await reopened.read(f.c,f.s,f.descriptor.id,1,first.candidateId)).toEqual(first);expect(await reopened.image(f.c,f.s,f.descriptor.id,1,first.candidateId)).toEqual({bytes:f.image,mime:'image/png',sha256:sha256(f.image)});
  expect(await reopened.list(f.c,f.s,f.descriptor.id,1)).toMatchObject({items:[first],nextCursor:null});
 });
 it('later selection stays authoritative after replaying the earlier selection request',async()=>{
  const f=await fixture(),a=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input),input={...f.input,requestId:id(12),renderRequest:{...f.input.renderRequest,requestId:id(12)}},b=await f.service.create(f.c,f.s,f.descriptor.id,1,input);
  const request=selectedInput(a);await f.service.select(f.c,f.s,f.descriptor.id,1,request);await f.service.select(f.c,f.s,f.descriptor.id,1,selectedInput(b,id(21),1));
  await f.reopen().select(f.c,f.s,f.descriptor.id,1,request);expect(rows(f,'selections')).toHaveLength(2);expect(await f.reopen().current(f.c,f.s,f.descriptor.id,1)).toMatchObject({selectionVersion:2,selected:{candidateId:b.candidateId}});
 });
 it('rechecks current source bytes and rights on candidate/current/image serving and selection',async()=>{
  const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);await f.service.select(f.c,f.s,f.descriptor.id,1,selectedInput(candidate));
  f.rights.permissions.display=false;
  for(const call of [()=>f.service.read(f.c,f.s,f.descriptor.id,1,candidate.candidateId),()=>f.service.image(f.c,f.s,f.descriptor.id,1,candidate.candidateId),()=>f.service.current(f.c,f.s,f.descriptor.id,1),()=>f.service.select(f.c,f.s,f.descriptor.id,1,selectedInput(candidate,id(21),1)),()=>f.service.list(f.c,f.s,f.descriptor.id,1)])await expect(call()).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
  f.rights.permissions.display=true;vi.spyOn(f.blobs,'get').mockResolvedValueOnce(Buffer.alloc(f.source.length));await expect(f.service.read(f.c,f.s,f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 });
 it('rechecks after thumbnail I/O before persisting a ready candidate',async()=>{
  const f=await fixture(),put=f.blobs.putDurable.bind(f.blobs);vi.spyOn(f.blobs,'putDurable').mockImplementationOnce(async(key,bytes)=>{await put(key,bytes);f.rights.permissions.display=false;});
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,f.input)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});expect(rows(f,'candidates')).toHaveLength(0);expect(rows(f,'selections')).toHaveLength(0);
 });
 it('denies foreign owners, paths, versions, model/render substitutions and unregistered pseudo descriptors',async()=>{
  const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);
  await expect(f.service.read(f.c,{...f.s,userId:id(99)},f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.service.read(f.c,{...f.s,tenantId:id(99)},f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.service.read(f.c,f.s,id(99),1,candidate.candidateId)).rejects.toMatchObject({code:'FURNISHING_NOT_FOUND'});
  await expect(f.service.read(f.c,f.s,f.descriptor.id,2,candidate.candidateId)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(f.service.read(f.c,f.s,f.descriptor.id,1,id(99))).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_NOT_FOUND'});
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,{...f.input,renderRequest:{...f.input.renderRequest,principalId:id(99)}})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,{...f.input,renderRequest:{...f.input.renderRequest,modelSha256:'f'.repeat(64)}})).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_CONFLICT'});
 });
 it('unknown validator outcome never stores ready bytes or selects a thumbnail',async()=>{
  const f=await fixture(),put=vi.spyOn(f.blobs,'putDurable');vi.mocked(validateFurnishingThumbnailPng).mockRejectedValueOnce(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,f.input)).rejects.toMatchObject({code:'FURNISHING_VALIDATION_UNAVAILABLE'});expect(put).not.toHaveBeenCalled();expect(rows(f,'candidates')).toHaveLength(0);expect(rows(f,'selections')).toHaveLength(0);
 });
 it('rejects durable PNG corruption and tampered receipt/source bindings on reopen',async()=>{
  for(const field of ['receipt_sha256','png_sha256','source','object_key'] as const){const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input),row=rows(f,'candidates')[0]!;row[field]=field==='source'?{...row.source as object,modelSha256:'f'.repeat(64)}:'f'.repeat(64);await expect(f.reopen().read(f.c,f.s,f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});}
  const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);vi.spyOn(f.blobs,'getBounded').mockResolvedValueOnce(Buffer.alloc(f.image.length));await expect(f.service.image(f.c,f.s,f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 });
 it('rechecks display authority after reading persisted PNG bytes',async()=>{
  const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input),get=f.blobs.getBounded.bind(f.blobs);
  vi.spyOn(f.blobs,'getBounded').mockImplementationOnce(async(key,bytes,signal)=>{const value=await get(key,bytes,signal);f.rights.permissions.display=false;return value;});
  await expect(f.service.image(f.c,f.s,f.descriptor.id,1,candidate.candidateId)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
 });
 it('reuses deterministic orphan blob keys after a failed candidate transaction',async()=>{
  const f=await fixture(),base=f.query.getMockImplementation()!,put=vi.spyOn(f.blobs,'putDurable');let failed=false;
  f.query.mockImplementation(async(sql,args)=>{if(!failed&&sql.startsWith('INSERT INTO workspace_furnishing_thumbnail_candidates')){failed=true;throw Error('synthetic transaction failure');}return base(sql,args);});
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,f.input)).rejects.toThrow('synthetic transaction failure');expect(rows(f,'candidates')).toHaveLength(0);
  await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);expect(rows(f,'candidates')).toHaveLength(1);expect(put.mock.calls[0]![0]).toBe(put.mock.calls[1]![0]);
 });
 it('bounds ready candidates at sixteen without implicitly selecting or writing a seventeenth',async()=>{
  const f=await fixture();for(let n=30;n<46;n++)await f.service.create(f.c,f.s,f.descriptor.id,1,{...f.input,requestId:id(n),renderRequest:{...f.input.renderRequest,requestId:id(n)}});
  await expect(f.service.create(f.c,f.s,f.descriptor.id,1,f.input)).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_LIMIT'});expect(rows(f,'candidates')).toHaveLength(16);expect(rows(f,'selections')).toHaveLength(0);
 });
 it('recomputes stored selection intent rather than trusting a matching candidate receipt',async()=>{
  const f=await fixture(),candidate=await f.service.create(f.c,f.s,f.descriptor.id,1,f.input);await f.service.select(f.c,f.s,f.descriptor.id,1,selectedInput(candidate));
  rows(f,'selections')[0]!.request_sha256='f'.repeat(64);await expect(f.reopen().current(f.c,f.s,f.descriptor.id,1)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 });
 it('produces an exact synthetic HTTP wire example using durable candidate/current/image readback',async()=>{
  const f=await fixture(),csrf='synthetic-wire-csrf',token='a'.repeat(43),authRow={id:id(60),user_id:f.s.userId,tenant_id:f.s.tenantId,role:'artist',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
  const query=async(sql:string,args:unknown[]=[])=>sql.includes('SELECT s.*,m.role')?{rows:[authRow],rowCount:1}:f.query(sql,args),client={query,release:()=>{}},pool={query,connect:async()=>client} as unknown as Pool;
  vi.spyOn(f.registry,'work').mockResolvedValue(false);const app=buildApp({pool,blobs:f.blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:f.owner,workspaceFurnishing:f.registry});
  const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},base=`/api/v1/tenants/${f.s.tenantId}/workspace/furnishings/${f.descriptor.id}/versions/1`;
  try{
   const created=await app.inject({method:'POST',url:base+'/thumbnail-candidates',headers,payload:f.input});expect(created.statusCode,created.body).toBe(201);const create=created.json();
   const before=await app.inject({method:'GET',url:base+'/thumbnail-selection',headers});expect(before.statusCode,before.body).toBe(200);expect(before.json()).toMatchObject({selectionVersion:0,selected:null});
   const selectRequest=selectedInput(create),selected=await app.inject({method:'POST',url:base+'/thumbnail-selection',headers,payload:selectRequest});expect(selected.statusCode,selected.body).toBe(200);
   const after=await app.inject({method:'GET',url:base+'/thumbnail-selection',headers}),read=await app.inject({method:'GET',url:base+'/thumbnail-candidates/'+create.candidateId,headers}),imagePath=base+'/thumbnail-candidates/'+create.candidateId+'/image',image=await app.inject({method:'GET',url:imagePath,headers});
   expect(after.statusCode,after.body).toBe(200);expect(read.statusCode,read.body).toBe(200);expect(image.statusCode,image.body).toBe(200);expect(image.rawPayload).toEqual(f.image);expect(image.headers['x-exhibitos-sha256']).toBe(sha256(image.rawPayload));
   const example={synthetic:true,evidenceKind:'issued-writer-real-temporary-file-store-mocked-SQL-and-PNG-validator-no-official-registration',submitRequest:f.input,create,currentBefore:before.json(),selectRequest,select:selected.json(),currentAfter:after.json(),read:read.json(),imageGET:{path:imagePath,mime:image.headers['content-type'],bytes:image.rawPayload.length,sha256:sha256(image.rawPayload),'cache-control':image.headers['cache-control']}};
   if(process.env.EXHIBITOS_FURNISHING_THUMBNAIL_WIRE_EXAMPLE)await writeFile(process.env.EXHIBITOS_FURNISHING_THUMBNAIL_WIRE_EXAMPLE,JSON.stringify(example,null,2)+'\n',{flag:'wx'});
  }finally{await app.close();}
 });
 it('requires exact schema capability and a live owner writer',async()=>{
  const f=await fixture(),base=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args)=>sql.includes('schema_migrations')?{rows:[{name:'050_workspace_furnishing_thumbnail.sql',sha256:'f'.repeat(64)}],rowCount:1}:base(sql,args));await expect(f.service.ready(f.c,f.s)).rejects.toMatchObject({code:'FURNISHING_THUMBNAIL_UNAVAILABLE'});
  f.query.mockImplementation(base);f.revokeWriter();await expect(f.service.create(f.c,f.s,f.descriptor.id,1,f.input)).rejects.toThrow('FURNISHING_LEASE_INVALID');expect(rows(f,'candidates')).toHaveLength(0);
 });
});
