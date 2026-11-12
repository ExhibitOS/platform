// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import type {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
vi.mock('../../../scripts/native-workspace-furnishing-admission.mjs',()=>({assertIssuedFurnishingWriterLease:()=>{}}));
import {buildApp} from './app.ts';
import {createNativeModelPreparationExecution,createServiceModelPreparationExecution} from './model-preparation-import.ts';
import {GpuModelPreparations} from './gpu-model-preparations.ts';
import {GPU_MODEL_PREPARATION_PROFILE} from './gpu-model-preparation-contract.ts';
// HTTP capability wiring: issued writer and producer readiness are explicit
// mocks here; this does not qualify an actual managed Native runtime.
it.each(['native','service'] as const)('advertises only live installed native GPU readiness (%s execution)',async mode=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='gpu-session-test',root=await mkdtemp(join(tmpdir(),'gpu-session-'));
 const row={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01')};
 const client={query:vi.fn(async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[row],rowCount:1}:{rows:[],rowCount:0}),release:()=>{}},pool={connect:async()=>client} as unknown as Pool,blobs=new FileBlobStore(root);
 const workspace={workspaceId:randomUUID(),tenantId,principalId:userId,assertDatabase:async()=>{}} as never;
 const writer={writerFd:9,identity:workspace,assertLive:async()=>{}} as never;
 const execution=mode==='native'?createNativeModelPreparationExecution(blobs,workspace,writer,()=>true):createServiceModelPreparationExecution(blobs,()=>true);
 const service=new GpuModelPreparations(pool,execution,'/synthetic-managed-tool','/synthetic-jobs'),ready=vi.spyOn(service,'ready').mockResolvedValue(undefined);
 vi.spyOn(service,'work').mockResolvedValue(false);vi.spyOn(service,'close').mockResolvedValue(undefined);
 const app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},...(mode==='native'?{nativeOexWorkspace:workspace}:{}),...(mode==='native'?{nativeBoundedEditing:true}:{}),modelPreparationExecution:execution,gpuModelPreparations:service});
 const headers={host:'127.0.0.1:13200',cookie:'exhibitos_local_session='+'a'.repeat(43)};
 try{const response=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(response.statusCode,response.body).toBe(200);
  if(mode==='native'){expect(response.json().nativeGpuModelPreparationProfile).toBe(GPU_MODEL_PREPARATION_PROFILE);expect(ready).toHaveBeenCalledWith(client,expect.objectContaining({tenantId,userId}));ready.mockRejectedValueOnce(Error('revoked'));const revoked=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(revoked.statusCode).toBe(200);expect(revoked.json()).not.toHaveProperty('nativeGpuModelPreparationProfile');}
  else{expect(response.json()).not.toHaveProperty('nativeGpuModelPreparationProfile');expect(ready).not.toHaveBeenCalled();}
 }finally{await app.close();await rm(root,{recursive:true,force:true});vi.restoreAllMocks();}
});
