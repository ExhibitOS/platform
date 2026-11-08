// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
const operation=vi.hoisted(()=>vi.fn());
vi.mock('./artwork-original-static-approval.ts',()=>({approveOriginalStaticSource:operation}));

it('exposes source approval only to the authenticated native owner and rejects caller-supplied source fields',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),token='a'.repeat(43),csrf='test-csrf',exhibitionId=randomUUID();
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs=new FileBlobStore('/synthetic-unused'),nativeOexWorkspace={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{}} as never;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace}),ordinary=buildApp({pool,auth,blobs});
 const url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${exhibitionId}/native-original-static-approval`,payload={artworkId:randomUUID(),artworkRevision:2,importJobId:randomUUID()},headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 operation.mockResolvedValue({approved:true});
 try{
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://example.invalid'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers,payload:{...payload,sourceAssetId:randomUUID()}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(200);
  expect(operation).toHaveBeenCalledOnce();expect(operation.mock.calls[0]?.[3]).toEqual(payload);
 }finally{await app.close();await ordinary.close();vi.clearAllMocks();}
});
