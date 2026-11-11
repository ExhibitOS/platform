// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import type {Pool,PoolClient} from 'pg';
import {buildApp} from './app.ts';
import {ApiError,uuid,type Session} from './auth.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import type {WorkspaceFurnishingThumbnails} from './workspace-furnishing-thumbnails.ts';
import {parseFurnishingThumbnailSubmit,parseFurnishingThumbnailSelection} from './workspace-furnishing-thumbnail-contract.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pending:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of pending.splice(0))await close();});
function fixture(){
 const csrf='synthetic-csrf',token='a'.repeat(43),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const authRow={id:id(1),user_id:id(2),tenant_id:id(3),role:'artist',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const query=vi.fn(async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[authRow],rowCount:1}:{rows:[],rowCount:0}),pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
 const blobs=new FileBlobStore('/synthetic-route-unused'),owner={workspaceId:id(4),tenantId:id(3),principalId:id(2),assertDatabase:vi.fn(async()=>{})},registry=new WorkspaceFurnishingIntakes(blobs,owner);
 // Stub only the route's private service boundary. The companion service suite
 // uses actual signed writer issuance/FD checks and real disposable blob custody.
 vi.spyOn(registry,'hasWriterLease').mockReturnValue(true);vi.spyOn(registry,'work').mockResolvedValue(false);
 const png=Buffer.alloc(33);png.set([137,80,78,71,13,10,26,10]);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(256,16);png.writeUInt32BE(256,20);png[24]=8;png[25]=2;
 const input={kind:'workspace-furnishing-thumbnail-v1',requestId:id(7),renderRequest:{version:1,epoch:id(8),sequence:1,tenantId:id(3),principalId:id(2),requestId:id(7),furnishingId:id(5),furnishingVersion:1,modelBytes:100,modelSha256:'b'.repeat(64),recipeId:'furnishing-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1'},pngSha256:sha256(png),pngBytes:png.length,pngBase64:png.toString('base64')};
 const candidate={candidateId:id(6),state:'ready',receiptSha256:'c'.repeat(64)},selection={requestId:id(9),candidateId:id(6),receiptSha256:'c'.repeat(64),expectedSelectionVersion:0};
 const ready=vi.fn(async(c:PoolClient,s:Session)=>{await registry.authorize(c,s);});
 const service={ready,create:vi.fn(async(_c:PoolClient,_s:Session,_id:string,_version:number,value:unknown)=>{await registry.authorize(_c,_s);parseFurnishingThumbnailSubmit(value);return candidate;}),read:vi.fn(async(_c:PoolClient,_s:Session,_id:string,_version:number,candidateId:string)=>{uuid(candidateId);return candidate;}),image:vi.fn(async(_c:PoolClient,_s:Session,_id:string,_version:number,candidateId:string)=>{uuid(candidateId);return {bytes:png,mime:'image/png' as const,sha256:sha256(png)};}),current:vi.fn(async()=>({selectionVersion:0,selected:null})),select:vi.fn(async(_c:PoolClient,_s:Session,_id:string,_version:number,value:unknown)=>{parseFurnishingThumbnailSelection(value);return {selectionVersion:1,selected:{candidateId:id(6)}};}),list:vi.fn(async()=>({items:[candidate],nextCursor:null}))};
 const factory=vi.spyOn(registry,'thumbnailReceipts').mockReturnValue(service as unknown as WorkspaceFurnishingThumbnails);
 const options={pool,blobs,auth,nativeExportWorkspace:owner,workspaceFurnishing:registry},app=buildApp(options);pending.push(()=>app.close());
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},base=`/api/v1/tenants/${id(3)}/workspace/furnishings/${id(5)}/versions/1`;
 return {app,options,headers,base,input,selection,service,owner,factory,query,png,authRow};
}
describe('workspace furnishing thumbnail protected routes',()=>{
 it('advertises exact capability only with a ready private owner service; absent family stays unavailable',async()=>{
  const f=fixture(),session=()=>f.app.inject({method:'GET',url:'/api/v1/auth/session',headers:f.headers});
  expect((await session()).json().workspaceFurnishingThumbnailProfile).toBe('workspace-furnishing-thumbnail-v1');
  f.service.ready.mockRejectedValueOnce(new ApiError(503,'FURNISHING_THUMBNAIL_UNAVAILABLE'));expect((await session()).json()).not.toHaveProperty('workspaceFurnishingThumbnailProfile');
  const ordinary=buildApp({pool:f.options.pool,blobs:f.options.blobs,auth:f.options.auth});pending.push(()=>ordinary.close());expect((await ordinary.inject({method:'GET',url:'/api/v1/auth/session',headers:f.headers})).json()).not.toHaveProperty('workspaceFurnishingThumbnailProfile');
  expect((await ordinary.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload:f.input})).statusCode).toBe(404);
 });
 it('requires authenticated current tenant owner, same origin and CSRF before mutation',async()=>{
  const f=fixture(),post=(headers:Record<string,string>,url=f.base+'/thumbnail-candidates')=>f.app.inject({method:'POST',url,headers,payload:f.input});
  expect((await post({...f.headers,cookie:''})).statusCode).toBe(401);expect((await post({...f.headers,origin:'http://invalid.example'})).statusCode).toBe(403);expect((await post({...f.headers,'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post(f.headers,f.base.replace(id(3),id(99))+'/thumbnail-candidates')).statusCode).toBe(403);expect(f.service.create).not.toHaveBeenCalled();
  f.authRow.user_id=id(99);expect((await post(f.headers)).statusCode).toBe(403);expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
 });
 it('returns ready candidates as 201 without selecting and serves authoritative GETs with bounded headers',async()=>{
  const f=fixture(),created=await f.app.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload:f.input});expect(created.statusCode,created.body).toBe(201);expect(created.json()).toMatchObject({state:'ready',candidateId:id(6)});expect(created.headers['cache-control']).toBe('no-store');expect(f.service.select).not.toHaveBeenCalled();
  for(const suffix of ['/thumbnail-candidates','/thumbnail-candidates/'+id(6),'/thumbnail-selection']){const response=await f.app.inject({method:'GET',url:f.base+suffix,headers:f.headers});expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('no-store');}
  const image=await f.app.inject({method:'GET',url:f.base+'/thumbnail-candidates/'+id(6)+'/image',headers:f.headers});expect(image.statusCode,image.body).toBe(200);expect(image.rawPayload).toEqual(f.png);expect(image.headers).toMatchObject({'content-type':'image/png','content-length':String(f.png.length),'x-content-type-options':'nosniff','content-disposition':'inline','x-exhibitos-sha256':sha256(f.png),'cache-control':'no-store'});
  const selected=await f.app.inject({method:'POST',url:f.base+'/thumbnail-selection',headers:f.headers,payload:f.selection});expect(selected.statusCode,selected.body).toBe(200);expect(f.service.select).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({userId:id(2),tenantId:id(3)}),id(5),1,f.selection);
 });
 it('denies extra submit/selection aliases, unsupported versions, candidate IDs and bounded bodies',async()=>{
  const f=fixture();
  for(const payload of [{...f.input,sourceAssetId:id(99)},{...f.input,model: {}},{...f.input,renderRequest:{...f.input.renderRequest,epochUUID:id(99)}}])expect((await f.app.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload})).statusCode).toBe(400);
  expect((await f.app.inject({method:'POST',url:f.base+'/thumbnail-selection',headers:f.headers,payload:{...f.selection,selected:true}})).statusCode).toBe(400);
  expect((await f.app.inject({method:'GET',url:f.base.replace('/versions/1','/versions/2')+'/thumbnail-candidates',headers:f.headers})).statusCode).toBe(400);
  expect((await f.app.inject({method:'GET',url:f.base+'/thumbnail-candidates/not-a-uuid',headers:f.headers})).statusCode).toBe(400);
  expect((await f.app.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload:{...f.input,pngBase64:'a'.repeat(720897)}})).statusCode).toBe(413);
  expect((await f.app.inject({method:'POST',url:f.base+'/thumbnail-selection',headers:f.headers,payload:{...f.selection,extra:'a'.repeat(4096)}})).statusCode).toBe(413);
 });
 it('rolls back if owner authority is lost after a service operation instead of serving a stale successful result',async()=>{
  const f=fixture();f.service.create.mockImplementationOnce(async()=>{f.owner.assertDatabase.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));return {candidateId:id(6),state:'ready',receiptSha256:'c'.repeat(64)};});
  const response=await f.app.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload:f.input});expect(response.statusCode).toBe(403);expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
 });
 it('uses fresh READ COMMITTED authority and Origin/CSRF protection on every read and mutation',async()=>{
  const f=fixture(),requests=[
   {method:'POST' as const,url:f.base+'/thumbnail-candidates',payload:f.input},
   {method:'POST' as const,url:f.base+'/thumbnail-selection',payload:f.selection},
   ...['/thumbnail-candidates','/thumbnail-candidates/'+id(6),'/thumbnail-candidates/'+id(6)+'/image','/thumbnail-selection'].map(suffix=>({method:'GET' as const,url:f.base+suffix})),
  ];
  for(const request of requests){f.query.mockClear();const response=await f.app.inject({...request,headers:f.headers});expect(response.statusCode,response.body).toBe(request.method==='POST'&&request.url.endsWith('thumbnail-candidates')?201:200);expect(f.query.mock.calls.map(([sql])=>sql)).toContain('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');}
  for(const suffix of ['/thumbnail-candidates','/thumbnail-candidates/'+id(6),'/thumbnail-candidates/'+id(6)+'/image','/thumbnail-selection']){
   expect((await f.app.inject({method:'GET',url:f.base+suffix,headers:{...f.headers,'x-csrf-token':''}})).statusCode).toBe(403);
   expect((await f.app.inject({method:'GET',url:f.base+suffix,headers:{...f.headers,origin:'http://invalid.example'}})).statusCode).toBe(403);
  }
 });
 it('preserves explicit service failures and never emits PNG bytes on revoked authority',async()=>{
  const f=fixture();f.service.create.mockRejectedValueOnce(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'));expect((await f.app.inject({method:'POST',url:f.base+'/thumbnail-candidates',headers:f.headers,payload:f.input})).statusCode).toBe(503);
  f.service.image.mockImplementationOnce(async()=>{f.owner.assertDatabase.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));return {bytes:f.png,mime:'image/png',sha256:sha256(f.png)};});
  const response=await f.app.inject({method:'GET',url:f.base+'/thumbnail-candidates/'+id(6)+'/image',headers:f.headers});expect(response.statusCode).toBe(403);expect(response.headers['content-type']).not.toBe('image/png');
 });
});
