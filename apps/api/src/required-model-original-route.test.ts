// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import type {ModelPreparationExecution} from './model-preparation-import.ts';

const services=vi.hoisted(()=>({resolve:vi.fn(),approve:vi.fn(),read:vi.fn()}));
vi.mock('./required-model-original.ts',async original=>({...await original<typeof import('./required-model-original.ts')>(),resolveRequiredModelCandidate:services.resolve,approveRequiredModelOriginal:services.approve,readRequiredModelOriginalApproval:services.read}));
// Route tests retain real HTTP/auth/schema behavior; no issued execution or
// profile is fabricated, and the domain service is tested separately.
vi.mock('./imports.ts',async original=>{const actual=await original<typeof import('./imports.ts')>();return {...actual,Imports:class extends actual.Imports {constructor(...args:ConstructorParameters<typeof actual.Imports>){super(args[0],args[1],args[2]);} async requiredModelReady(){}}};});

it('advertises ordinary original custody only with the live bound native producer',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='test-csrf',token='a'.repeat(43),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const blobs=new FileBlobStore('/synthetic-unused'),nativeOexWorkspace={tenantId,principalId:userId,workspaceId:randomUUID(),matchesBlobRoot:()=>true,assertDatabase:async()=>{}} as never,modelPreparationExecution={} as ModelPreparationExecution;
 let live=true;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true,modelPreparationExecution,runtimeAvailable:()=>live}),missingProducer=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true,runtimeAvailable:()=>true});
 const headers={host:'127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`};
 try{
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).toMatchObject({nativeRequiredModelOriginalProfile:'required-model-custody-v1'});
  live=false;expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeRequiredModelOriginalProfile');
  expect((await missingProducer.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeRequiredModelOriginalProfile');
 }finally{await app.close();await missingProducer.close();vi.clearAllMocks();}
});

it('uses closed native approval/readback requests with CSRF, current If-Match and server-resolved custody',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='test-csrf',token='b'.repeat(43),exhibitionId=randomUUID(),artworkId=randomUUID(),importJobId=randomUUID(),serverReceiptSha256='c'.repeat(64);
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const blobs=new FileBlobStore('/synthetic-unused'),nativeOexWorkspace={tenantId,principalId:userId,workspaceId:randomUUID(),matchesBlobRoot:()=>true,assertDatabase:async()=>{}} as never,modelPreparationExecution={} as ModelPreparationExecution;
 let live=true;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true,modelPreparationExecution,runtimeAvailable:()=>live}),ordinary=buildApp({pool,auth,blobs});
 const root=`/api/v1/tenants/${tenantId}/studio/exhibitions/${exhibitionId}`,postUrl=`${root}/native-original-static-approval`,getUrl=`${root}/native-required-model-original`;
 const payload={kind:'required-model-custody-v1',artworkId,artworkRevision:2,importJobId,serverReceiptSha256},query=new URLSearchParams({artworkId,artworkRevision:'2',importJobId,serverReceiptSha256}).toString();
 const match=`"studio-r8-${'e'.repeat(64)}"`,headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 const result={version:1,approved:true,exhibitionId,revision:8,etag:match,custody:{artworkId,artworkRevision:2,importJobId,serverReceiptSha256,original:{assetId:randomUUID()},display:{assetId:randomUUID()}},approvalSha256:'d'.repeat(64)};
 services.approve.mockResolvedValue(result);services.read.mockResolvedValue(result);
 try{
  expect((await ordinary.inject({method:'POST',url:postUrl,headers,payload})).statusCode).toBe(404);
  expect((await ordinary.inject({method:'GET',url:getUrl+'?'+query,headers})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url:postUrl,headers:{...headers,origin:'http://foreign.invalid'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:postUrl,headers:{...headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:postUrl,headers:{...headers,'if-match':''},payload})).statusCode).toBe(400);
  for(const extra of [{sourceAssetId:randomUUID()},{original:{assetId:randomUUID()}},{operationId:randomUUID()}])expect((await app.inject({method:'POST',url:postUrl,headers,payload:{...payload,...extra}})).statusCode).toBe(400);
  expect(services.approve).not.toHaveBeenCalled();
  const approved=await app.inject({method:'POST',url:postUrl,headers,payload});expect(approved.statusCode).toBe(200);expect(approved.json()).toEqual(result);expect(services.approve.mock.calls[0]?.[3]).toEqual(payload);expect(services.approve.mock.calls[0]?.[4]).toBe(headers['if-match']);
  for(const suffix of ['', '?'+query+'&sourceAssetId='+randomUUID(),'?'+query.replace('artworkRevision=2','artworkRevision=0')])expect((await app.inject({method:'GET',url:getUrl+suffix,headers})).statusCode).toBe(400);
  const denied=await app.inject({method:'GET',url:getUrl+'?'+query,headers:{...headers,'x-csrf-token':''}});expect(denied.statusCode).toBe(403);expect(services.read).not.toHaveBeenCalled();
  const read=await app.inject({method:'GET',url:getUrl+'?'+query,headers});expect(read.statusCode).toBe(200);expect(read.json()).toEqual(result);expect(read.headers.etag).toBe(result.etag);expect(read.headers['cache-control']).toBe('no-store');expect(services.read.mock.calls[0]?.[3]).toEqual(payload);
  live=false;expect((await app.inject({method:'POST',url:postUrl,headers,payload})).statusCode).toBe(503);expect((await app.inject({method:'GET',url:getUrl+'?'+query,headers})).statusCode).toBe(503);expect(services.approve).toHaveBeenCalledOnce();expect(services.read).toHaveBeenCalledOnce();
 }finally{await app.close();await ordinary.close();vi.clearAllMocks();}
});
