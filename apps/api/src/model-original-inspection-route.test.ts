// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {createServiceModelPreparationExecution} from './model-preparation-import.ts';
const inspect=vi.hoisted(()=>vi.fn());
vi.mock('./model-original-inspection.ts',()=>({inspectModelOriginal:inspect}));
it('inspects original bytes through authenticated current execution only, without a persisted job',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),token='a'.repeat(43),csrf='test-csrf',queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:sql.includes("attname='model_preparation'")?{rows:[{supported:true}],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs=new FileBlobStore('/synthetic-unused');let active=true;
 const execution=createServiceModelPreparationExecution(blobs,()=>active),app=buildApp({pool,auth,blobs,modelPreparationExecution:execution}),unavailable=buildApp({pool,auth,blobs});
 const url=`/api/v1/tenants/${tenantId}/imports/model-inspection`,payload=Buffer.from('synthetic route payload'),headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'content-type':'application/octet-stream'};
 inspect.mockReturnValue({qualification:'structure-only',sourceUnits:'unknown'});
 try{
  expect((await unavailable.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://example.invalid'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  active=false;expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(503);active=true;
  expect((await app.inject({method:'POST',url:url+'?extra=1',headers,payload})).statusCode).toBe(400);
  const response=await app.inject({method:'POST',url,headers,payload});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({qualification:'structure-only',sourceUnits:'unknown'});expect(inspect).toHaveBeenCalledExactlyOnceWith(payload);
  expect(queries.some(sql=>/^\s*(INSERT|UPDATE|DELETE)\s+(INTO\s+)?import_jobs/i.test(sql))).toBe(false);
 }finally{await app.close();await unavailable.close();vi.clearAllMocks();}
});
