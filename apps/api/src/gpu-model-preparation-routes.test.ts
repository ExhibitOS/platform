// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import type {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {buildApp} from './app.ts';
import {ApiError} from './api-error.ts';
import {GpuModelPreparations} from './gpu-model-preparations.ts';
import {GPU_MODEL_PREPARATION_PROFILE} from './gpu-model-preparation-contract.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {Imports} from './imports.ts';

afterEach(()=>vi.restoreAllMocks());
async function fixture(installed=true){
 const tenantId=randomUUID(),userId=randomUUID(),artworkId=randomUUID(),jobId=randomUUID(),csrf='synthetic-gpu-csrf',token='a'.repeat(43),queries:string[]=[];
 const row={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[row],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool,root=await mkdtemp(join(tmpdir(),'gpu-http-')),blobs=new FileBlobStore(root);
 const execution=createServiceModelPreparationExecution(blobs,()=>false),service=new GpuModelPreparations(pool,execution,'/synthetic-managed-encoder','/synthetic-server-jobs');
 // HTTP wiring only: never schedule or execute an encoder or claim a real job.
 const work=vi.spyOn(service,'work').mockResolvedValue(false),close=vi.spyOn(service,'close').mockResolvedValue(undefined);
 const app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},...(installed?{gpuModelPreparations:service}:{})});
 const prefix=`/api/v1/tenants/${tenantId}`,cms=`${prefix}/cms/artworks/${artworkId}`,gpu=`${cms}/gpu-preparations`;
 const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 const input={revision:3,assetId:randomUUID(),sha256:'a'.repeat(64),bytes:2017704,idempotencyKey:'synthetic-gpu-request',generation:'generation-1',profile:GPU_MODEL_PREPARATION_PROFILE};
 return {app,service,work,close,pool,blobs,execution,tenantId,userId,artworkId,jobId,client,queries,prefix,cms,gpu,headers,input,cleanup:async()=>{await app.close();await rm(root,{recursive:true,force:true});}};
}

it('dispatches only the explicit closed GPU profile; ordinary compact requests retain their producer',async()=>{
 const f=await fixture(),gpuView={id:f.jobId,state:'queued',gpuPreparation:{profile:GPU_MODEL_PREPARATION_PROFILE}};
 const create=vi.spyOn(f.service,'create').mockImplementation(async()=>gpuView as never),compact=vi.spyOn(Imports.prototype,'createCompact').mockImplementation(async()=>({id:'ordinary-compact'}) as never);
 try{
  const response=await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers:f.headers,payload:f.input});
  expect(response.statusCode,response.body).toBe(201);expect(response.json()).toEqual(gpuView);
  expect(create).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId,userId:f.userId}),f.artworkId,f.input);expect(compact).not.toHaveBeenCalled();
  const {profile,...ordinary}=f.input;expect(profile).toBe(GPU_MODEL_PREPARATION_PROFILE);
  const legacy=await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers:f.headers,payload:ordinary});expect(legacy.statusCode,legacy.body).toBe(201);expect(compact).toHaveBeenCalledOnce();expect(create).toHaveBeenCalledOnce();
  for(const payload of [{...f.input,profile:'embedded-model-compact-20k-512-v1'},{...f.input,encoderPath:'/tmp/tool'},{...f.input,recipe:{}},{...f.input,bytes:27},{...f.input,sha256:'A'.repeat(64)}])expect((await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers:f.headers,payload})).statusCode).toBe(400);
  expect(create).toHaveBeenCalledOnce();
 }finally{await f.cleanup();}
});

it('fails explicit GPU requests closed when the producer is absent, without compact fallback',async()=>{
 const f=await fixture(false),compact=vi.spyOn(Imports.prototype,'createCompact').mockImplementation(async()=>({}) as never);
 try{
  const response=await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers:f.headers,payload:f.input});expect(response.statusCode).toBe(503);expect(response.json()).toMatchObject({code:'GPU_MODEL_PREPARATION_UNAVAILABLE'});expect(compact).not.toHaveBeenCalled();
  expect((await f.app.inject({method:'GET',url:f.gpu+'/selection',headers:f.headers})).statusCode).toBe(503);
 }finally{await f.cleanup();}
});

it('enforces authentication, current tenant, Origin and CSRF before GPU creation or approval',async()=>{
 const f=await fixture(),create=vi.spyOn(f.service,'create').mockImplementation(async()=>({}) as never),approve=vi.spyOn(f.service,'approve').mockImplementation(async()=>({}) as never);
 try{
  for(const headers of [{...f.headers,cookie:''},{...f.headers,'x-csrf-token':''},{...f.headers,origin:'http://other.invalid'}]){
   const r=await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers,payload:f.input});expect([401,403]).toContain(r.statusCode);
  }
  const foreign=f.cms.replace(f.tenantId,randomUUID());expect((await f.app.inject({method:'POST',url:foreign+'/compact-preparations',headers:f.headers,payload:f.input})).statusCode).toBe(403);
  const payload={revision:3,jobId:f.jobId,receiptSHA256:'b'.repeat(64),candidateSHA256:'c'.repeat(64),generation:'generation-1'};
  expect((await f.app.inject({method:'POST',url:f.gpu+'/approve',headers:{...f.headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect(create).not.toHaveBeenCalled();expect(approve).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});

it('forwards immutable review pins and candidate bytes without exposing a cacheable fallback',async()=>{
 const f=await fixture(),receiptSHA256='b'.repeat(64),candidateSHA256='c'.repeat(64),bytes=Buffer.from('synthetic-route-byte-sentinel');
 const reviewed=vi.spyOn(f.service,'reviewedBytes').mockImplementation(async()=>({bytes,receipt:{sha256:receiptSHA256,candidate:{sha256:candidateSHA256}}}) as never);
 const review=vi.spyOn(f.service,'review').mockImplementation(async()=>({jobId:f.jobId,receiptSHA256}) as never),selection=vi.spyOn(f.service,'selection').mockImplementation(async()=>({artworkId:f.artworkId,selection:null}) as never);
 try{
  expect((await f.app.inject({method:'GET',url:f.gpu+'/'+f.jobId+'/review',headers:f.headers})).json()).toEqual({jobId:f.jobId,receiptSHA256});expect(review).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId}),f.artworkId,f.jobId);
  expect((await f.app.inject({method:'GET',url:f.gpu+'/selection',headers:f.headers})).json()).toEqual({artworkId:f.artworkId,selection:null});expect(selection).toHaveBeenCalledOnce();
  const url=f.gpu+'/'+f.jobId+'/model',pins={receiptSHA256,candidateSHA256};
  for(const query of ['',`?receiptSHA256=${receiptSHA256}`,`?receiptSHA256=${receiptSHA256}&candidateSHA256=${candidateSHA256}&source=true`])expect((await f.app.inject({method:'GET',url:url+query,headers:f.headers})).statusCode).toBe(400);
  expect(reviewed).not.toHaveBeenCalled();
  const response=await f.app.inject({method:'GET',url:url+`?receiptSHA256=${receiptSHA256}&candidateSHA256=${candidateSHA256}`,headers:f.headers});
  expect(response.statusCode,response.body).toBe(200);expect(response.rawPayload).toEqual(bytes);expect(response.headers).toMatchObject({'content-type':'model/gltf-binary','cache-control':'no-store','x-content-type-options':'nosniff','x-exhibitos-sha256':candidateSHA256,'x-exhibitos-receipt-sha256':receiptSHA256});
  expect(reviewed).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId,userId:f.userId}),f.artworkId,f.jobId,pins);
  reviewed.mockRejectedValueOnce(new ApiError(409,'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'));
  expect((await f.app.inject({method:'GET',url:url+`?receiptSHA256=${receiptSHA256}&candidateSHA256=${candidateSHA256}`,headers:f.headers})).statusCode).toBe(409);
 }finally{await f.cleanup();}
});

it('approves only an explicit source revision, job, receipt, candidate and generation',async()=>{
 const f=await fixture(),approve=vi.spyOn(f.service,'approve').mockImplementation(async()=>({revision:4}) as never),payload={revision:3,jobId:f.jobId,receiptSHA256:'b'.repeat(64),candidateSHA256:'c'.repeat(64),generation:'generation-1'};
 try{
  for(const invalid of [{...payload,sourceAssetId:f.input.assetId},{...payload,revision:2147483647},{...payload,receiptSHA256:'bad'},{...payload,generation:undefined}])expect((await f.app.inject({method:'POST',url:f.gpu+'/approve',headers:f.headers,payload:invalid})).statusCode).toBe(400);
  expect(approve).not.toHaveBeenCalled();
  const response=await f.app.inject({method:'POST',url:f.gpu+'/approve',headers:f.headers,payload});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toEqual({revision:4});expect(approve).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId}),f.artworkId,payload,expect.anything());
 }finally{await f.cleanup();}
});

it('routes GPU import status and empty cancel/retry to its job owner, retaining ordinary import dispatch',async()=>{
 const f=await fixture(),has=vi.spyOn(f.service,'has').mockResolvedValue(true),access=vi.spyOn(f.service,'access').mockImplementation(async()=>({id:f.jobId}) as never),view=vi.spyOn(f.service,'view').mockReturnValue({id:f.jobId,state:'processing'} as never),action=vi.spyOn(f.service,'action').mockImplementation(async()=>({id:f.jobId,state:'cancelled'}) as never);
 const ordinaryAccess=vi.spyOn(Imports.prototype,'access').mockImplementation(async()=>({id:'ordinary'}) as never),ordinaryView=vi.spyOn(Imports.prototype,'view').mockReturnValue({id:'ordinary'} as never),ordinaryAction=vi.spyOn(Imports.prototype,'action').mockImplementation(async()=>({id:'ordinary-action'}) as never);
 try{
  const url=f.prefix+'/imports/'+f.jobId;expect((await f.app.inject({method:'GET',url,headers:f.headers})).json()).toEqual({id:f.jobId,state:'processing'});expect(access).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId}),f.jobId);expect(view).toHaveBeenCalledOnce();expect(ordinaryAccess).not.toHaveBeenCalled();
  for(const which of ['cancel','retry']){
   expect((await f.app.inject({method:'POST',url:url+'/'+which,headers:f.headers,payload:{jobId:randomUUID()}})).statusCode).toBe(400);
   expect((await f.app.inject({method:'POST',url:url+'/'+which,headers:{...f.headers,'x-csrf-token':''},payload:{}})).statusCode).toBe(403);
   const response=await f.app.inject({method:'POST',url:url+'/'+which,headers:f.headers,payload:{}});expect(response.statusCode,response.body).toBe(200);expect(action).toHaveBeenLastCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId}),f.jobId,which);
  }
  expect(action).toHaveBeenCalledTimes(2);has.mockResolvedValue(false);
  expect((await f.app.inject({method:'GET',url,headers:f.headers})).json()).toEqual({id:'ordinary'});expect(ordinaryView).toHaveBeenCalledOnce();expect((await f.app.inject({method:'POST',url:url+'/cancel',headers:f.headers,payload:{}})).json()).toEqual({id:'ordinary-action'});expect(ordinaryAction).toHaveBeenCalledOnce();
  expect(has).toHaveBeenCalledWith(f.client,expect.objectContaining({tenantId:f.tenantId,userId:f.userId}),f.jobId);
 }finally{await f.cleanup();}
});

it('binds the real service to its pool/blob context and drains its registered worker hook without advertising GPU readiness',async()=>{
 const f=await fixture();
 try{
  expect(()=>buildApp({pool:{} as Pool,blobs:f.blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},gpuModelPreparations:f.service})).toThrow('GPU_MODEL_PREPARATION_CONFIGURATION');
  const response=await f.app.inject({method:'GET',url:'/api/v1/auth/session',headers:f.headers});expect(response.statusCode,response.body).toBe(200);expect(JSON.stringify(response.json())).not.toContain(GPU_MODEL_PREPARATION_PROFILE);expect(f.work).toHaveBeenCalled();
 }finally{await f.cleanup();}
 expect(f.close).toHaveBeenCalledOnce();
});

it('rejects the installed but inactive issued producer before encoder dispatch instead of falling back',async()=>{
 const f=await fixture(),compact=vi.spyOn(Imports.prototype,'createCompact').mockImplementation(async()=>({}) as never);
 try{
  const response=await f.app.inject({method:'POST',url:f.cms+'/compact-preparations',headers:f.headers,payload:f.input});expect(response.statusCode,response.body).toBe(503);expect(compact).not.toHaveBeenCalled();
  const read=await f.app.inject({method:'GET',url:f.gpu+'/'+f.jobId+'/review',headers:{...f.headers,cookie:''}});expect([401,403]).toContain(read.statusCode);
  expect((await f.app.inject({method:'GET',url:f.gpu.replace(f.tenantId,randomUUID())+'/selection',headers:f.headers})).statusCode).toBe(403);
 }finally{await f.cleanup();}
});
