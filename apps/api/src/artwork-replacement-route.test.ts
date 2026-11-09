// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {etag} from './studio.ts';
const operation=vi.hoisted(()=>vi.fn());
vi.mock('./artwork-replacement.ts',()=>({replaceApprovedArtwork:operation,PRODUCT_IMAGE_THUMBNAIL_REPAIR:'product-image-thumbnail-repair-v1'}));
it('exposes a closed, authenticated native-only replacement route and forwards the exact ETag',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),token='a'.repeat(43),csrf='test-csrf',draft=newDraft(),match=etag(1,draft),response={revision:2,etag:etag(2,draft),draft};
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')},client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs=new FileBlobStore('/synthetic-unused'),nativeOexWorkspace={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{}} as never;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace}),ordinary=buildApp({pool,auth,blobs}),bounded=buildApp({pool,auth,blobs,nativeOexWorkspace,nativeBoundedEditing:true});operation.mockResolvedValue(response);
 const url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-artwork-replacement`,payload={requestId:randomUUID(),artworkId:randomUUID(),artworkRevision:1,importJobId:randomUUID()},headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 try{
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://example.invalid'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers,payload:{...payload,assetId:randomUUID()}})).statusCode).toBe(400);
  const missing={...headers};delete (missing as Partial<typeof headers>)['if-match'];expect((await app.inject({method:'POST',url,headers:missing,payload})).statusCode).toBe(428);
  const model={...payload,kind:'approved-model-candidate-v1',placementId:randomUUID()};
  expect((await app.inject({method:'POST',url,headers,payload:model})).statusCode).toBe(403);
  expect((await bounded.inject({method:'POST',url,headers,payload:{...payload,kind:model.kind}})).statusCode).toBe(400);
  expect((await bounded.inject({method:'POST',url,headers,payload:{...model,kind:'unknown'}})).statusCode).toBe(400);
  expect((await bounded.inject({method:'POST',url,headers,payload:{...model,assetId:randomUUID()}})).statusCode).toBe(400);
  const sessionResponse=await bounded.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(sessionResponse.statusCode).toBe(200);expect(sessionResponse.json()).not.toHaveProperty('nativeModelCandidateReplacementProfile');
  const accepted=await bounded.inject({method:'POST',url,headers,payload:model});expect(accepted.statusCode).toBe(200);expect(operation.mock.calls[0]?.[3]).toEqual(model);expect(operation.mock.calls[0]?.[4]).toBe(match);operation.mockClear();
  const repair={...payload,kind:'product-image-thumbnail-repair-v1',artworkRevision:2};
  expect((await ordinary.inject({method:'POST',url,headers,payload:repair})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url,headers,payload:repair})).statusCode).toBe(403);
  expect((await bounded.inject({method:'POST',url,headers:missing,payload:repair})).statusCode).toBe(428);
  expect((await bounded.inject({method:'POST',url,headers,payload:{...repair,sourceSha256:'a'.repeat(64)}})).statusCode).toBe(400);
  const repaired=await bounded.inject({method:'POST',url,headers,payload:repair});
  expect(repaired.statusCode).toBe(200);expect(repaired.headers.etag).toBe(response.etag);
  expect(operation.mock.calls[0]?.[3]).toEqual(repair);expect(operation.mock.calls[0]?.[4]).toBe(match);operation.mockClear();
  const ok=await app.inject({method:'POST',url,headers,payload});expect(ok.statusCode).toBe(200);expect(ok.headers.etag).toBe(response.etag);expect(operation).toHaveBeenCalledOnce();expect(operation.mock.calls[0]?.[3]).toEqual(payload);expect(operation.mock.calls[0]?.[4]).toBe(match);
 }finally{await app.close();await ordinary.close();await bounded.close();vi.clearAllMocks();}
});
