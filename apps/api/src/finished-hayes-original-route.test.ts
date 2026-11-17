// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {ApiError} from './auth.ts';

const services=vi.hoisted(()=>({resolve:vi.fn(),required:vi.fn(),approve:vi.fn(),read:vi.fn(),issued:true}));
vi.mock('./finished-hayes-original.ts',async original=>({...await original<typeof import('./finished-hayes-original.ts')>(),resolveFinishedHayesCandidate:services.resolve,approveFinishedHayesOriginal:services.approve,readFinishedHayesOriginalApproval:services.read}));
vi.mock('./required-model-original.ts',async original=>({...await original<typeof import('./required-model-original.ts')>(),resolveRequiredModelCandidate:services.required}));
// Isolate HTTP authorization/schema/dispatch. Issued-context branding and release
// verification have independent tests; these mocks do not attest real custody.
vi.mock('./native-detail-context.ts',async original=>({...await original<typeof import('./native-detail-context.ts')>(),isIssuedNativeDetailContext:()=>true}));
vi.mock('./hayes-original-attempt.ts',async original=>({...await original<typeof import('./hayes-original-attempt.ts')>(),isHayesReleaseContext:()=>services.issued}));
vi.mock('./imports.ts',async original=>{const actual=await original<typeof import('./imports.ts')>();return {...actual,Imports:class extends actual.Imports {constructor(...args:ConstructorParameters<typeof actual.Imports>){super(args[0],args[1],args[2]);} async coarseOwner(){return this.nativeWorkspace!;}}};});

it('guards the closed finished-release approval/status contract and never falls back after failed Hayes discovery',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='test-csrf',token='b'.repeat(43),exhibitionId=randomUUID(),artworkId=randomUUID(),importJobId=randomUUID();
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const blobs=new FileBlobStore('/synthetic-unused'),owner={tenantId,principalId:userId,workspaceId:randomUUID(),matchesBlobRoot:()=>true,assertDatabase:async()=>{}};
 let live=true;
 const detail={owner,runtimeGeneration:randomUUID(),signal:new AbortController().signal,live:()=>live};
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace:owner as never,nativeExportWorkspace:owner as never,nativeDetailContext:detail as never,nativeBoundedEditing:true,modelPreparationExecution:{} as never,runtimeAvailable:()=>live}),ordinary=buildApp({pool,auth,blobs});
 const root=`/api/v1/tenants/${tenantId}/studio/exhibitions/${exhibitionId}`,postUrl=`${root}/native-original-static-approval`,getUrl=`${root}/native-finished-hayes-original`,candidateUrl=`/api/v1/tenants/${tenantId}/studio/artworks/${artworkId}/native-model-candidate?artworkRevision=1`;
 const payload={kind:'finished-hayes-custody-v1',artworkId,artworkRevision:1,importJobId,attemptId:randomUUID(),receiptId:randomUUID(),receiptSha256:'c'.repeat(64),completionFrameSha256:'d'.repeat(64)};
 const {kind,...flat}=payload;const query=new URLSearchParams(Object.entries(flat).map(([key,value])=>[key,String(value)])).toString();
 const match=`"studio-r123-${'e'.repeat(64)}"`,headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 const result={version:1,approved:true,exhibitionId,revision:123,etag:match,custody:{kind,artworkId},approvalSha256:'f'.repeat(64)};
 services.issued=true;services.approve.mockResolvedValue(result);services.read.mockResolvedValue(result);
 try{
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).toHaveProperty('nativeFinishedHayesOriginalProfile',kind);
  expect((await ordinary.inject({method:'POST',url:postUrl,headers,payload})).statusCode).toBe(404);
  expect((await ordinary.inject({method:'GET',url:getUrl+'?'+query,headers})).statusCode).toBe(404);
  for(const changed of [{origin:'http://foreign.invalid'},{'x-csrf-token':''}])expect((await app.inject({method:'POST',url:postUrl,headers:{...headers,...changed},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:postUrl,headers:{...headers,'if-match':''},payload})).statusCode).toBe(400);
  for(const extra of [{sourceSha256:'a'.repeat(64)},{originalAssetId:randomUUID()},{serverReceiptSha256:'a'.repeat(64)}])expect((await app.inject({method:'POST',url:postUrl,headers,payload:{...payload,...extra}})).statusCode).toBe(400);
  expect(services.approve).not.toHaveBeenCalled();
  const approved=await app.inject({method:'POST',url:postUrl,headers,payload});expect(approved.statusCode).toBe(200);expect(approved.json()).toEqual(result);expect(approved.headers.etag).toBe(match);expect(services.approve.mock.calls[0]?.[3]).toEqual(payload);expect(services.approve.mock.calls[0]?.[4]).toBe(match);
  for(const suffix of ['', '?'+query+'&kind='+kind,'?'+query.replace('artworkRevision=1','artworkRevision=0')])expect((await app.inject({method:'GET',url:getUrl+suffix,headers})).statusCode).toBe(400);
  expect((await app.inject({method:'GET',url:getUrl+'?'+query,headers:{...headers,'x-csrf-token':''}})).statusCode).toBe(403);expect(services.read).not.toHaveBeenCalled();
  const read=await app.inject({method:'GET',url:getUrl+'?'+query,headers});expect(read.statusCode).toBe(200);expect(read.json()).toEqual(result);expect(read.headers.etag).toBe(match);expect(read.headers['cache-control']).toBe('no-store');expect(services.read.mock.calls[0]?.[3]).toEqual(payload);
  services.resolve.mockResolvedValueOnce({finishedHayesCustody:result.custody});expect((await app.inject({method:'GET',url:candidateUrl,headers})).json()).toHaveProperty('finishedHayesCustody');expect(services.required).not.toHaveBeenCalled();
  services.resolve.mockRejectedValueOnce(new ApiError(409,'FINISHED_HAYES_ORIGINAL_UNAVAILABLE'));expect((await app.inject({method:'GET',url:candidateUrl,headers})).statusCode).toBe(409);expect(services.required).not.toHaveBeenCalled();
  services.resolve.mockResolvedValueOnce(null);services.required.mockResolvedValueOnce({requiredModelCustody:{}});expect((await app.inject({method:'GET',url:candidateUrl,headers})).json()).toHaveProperty('requiredModelCustody');expect(services.required).toHaveBeenCalledOnce();
  services.issued=false;expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeFinishedHayesOriginalProfile');expect((await app.inject({method:'POST',url:postUrl,headers,payload})).statusCode).toBe(409);
  live=false;expect((await app.inject({method:'GET',url:getUrl+'?'+query,headers})).statusCode).toBe(409);expect(services.approve).toHaveBeenCalledOnce();expect(services.read).toHaveBeenCalledOnce();
 }finally{await app.close();await ordinary.close();vi.clearAllMocks();services.issued=true;}
});
