// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import type {ModelPreparationExecution} from './model-preparation-import.ts';
const resolve=vi.hoisted(()=>vi.fn());
vi.mock('./artwork-replacement.ts',()=>({replaceApprovedArtwork:vi.fn(),resolveApprovedModelCandidate:resolve}));
// Route-only test. The real service independently verifies issued execution;
// this mock avoids fabricating native authority or touching an owned profile.
vi.mock('./imports.ts',async original=>{const actual=await original<typeof import('./imports.ts')>();return {...actual,Imports:class extends actual.Imports {constructor(...args:ConstructorParameters<typeof actual.Imports>){super(args[0],args[1],args[2]);} async requiredModelReady(){}}};});
it('exposes only the closed authenticated native candidate GET and forwards the current revision',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),artworkId=randomUUID(),csrf='test-csrf',token='a'.repeat(43),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')},client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const blobs=new FileBlobStore('/synthetic-unused'),nativeOexWorkspace={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{}} as never,modelPreparationExecution={} as ModelPreparationExecution;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true,modelPreparationExecution}),unavailable=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true}),ordinary=buildApp({pool,auth,blobs});
 const url=`/api/v1/tenants/${tenantId}/studio/artworks/${artworkId}/native-model-candidate`,headers={host:'127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`},candidate={id:randomUUID(),state:'approved',assetId:randomUUID(),modelPreparation:{status:'ready',workerDrained:true}};resolve.mockResolvedValue(candidate);
 try{
  expect((await ordinary.inject({method:'GET',url:url+'?artworkRevision=1',headers})).statusCode).toBe(404);
  expect((await unavailable.inject({method:'GET',url:url+'?artworkRevision=1',headers})).statusCode).toBe(404);
  const sessionResponse=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect(sessionResponse.statusCode).toBe(200);
  expect(sessionResponse.json()).toMatchObject({modelPreparationProfile:'embedded-model-compact-20k-512-v1',nativeModelCandidateReplacementProfile:'approved-model-candidate-v1',compactModelVariantProfile:'exhibitos-budget-geometry-pair-v1'});
  for(const query of ['', '?artworkRevision=0','?artworkRevision=no','?artworkRevision=1&jobId=ignored','?artworkRevision=2147483648'])expect((await app.inject({method:'GET',url:url+query,headers})).statusCode).toBe(400);
  const result=await app.inject({method:'GET',url:url+'?artworkRevision=3',headers});expect(result.statusCode).toBe(200);expect(result.json()).toEqual(candidate);expect(result.headers['cache-control']).toBe('no-store');expect(resolve).toHaveBeenCalledOnce();expect(resolve.mock.calls[0]?.[2]).toBe(artworkId);expect(resolve.mock.calls[0]?.[3]).toBe(3);
 }finally{await app.close();await unavailable.close();await ordinary.close();vi.clearAllMocks();}
});
