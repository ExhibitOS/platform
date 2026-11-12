// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomBytes,randomUUID} from 'node:crypto';
import {test,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {REFINED_BENCH,furnishingAsset} from '@exhibitos/studio-contract';
import {buildApp} from './app.ts';
import {digest} from './auth.ts';
// Route delegation uses synthetic bytes. Actual packaged bytes are checked by
// the producer and the separate fresh-profile consumer, not this HTTP fixture.
const read=vi.hoisted(()=>vi.fn(async(_asset:unknown,role:string)=>Buffer.from('synthetic '+role)));
vi.mock('./furnishing-assets.ts',()=>({readFurnishingBytes:read}));
test('authenticated ordinary catalogue exposes only the admitted refined bench and delegates exact model/notice identity',async()=>{
 const tenant=randomUUID(),token=randomBytes(32).toString('base64url');let role='curator';
 const query=vi.fn(async(sql:string,args?:unknown[])=>({rows:sql.startsWith('SELECT s.*,m.role')&&args?.[0]===digest(token)?[{id:randomUUID(),tenant_id:tenant,user_id:randomUUID(),role,csrf_token:'fixture',expires_at:new Date('2099-01-01')}]:[]}));
 const pool={connect:async()=>({query,release:()=>{}})} as unknown as Pool;
 const app=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:'exhibitos_local_session='+token};
 const base=`/api/v1/tenants/${tenant}/studio/furnishings`;
 try{
  const catalog=await app.inject({method:'GET',url:base,headers});expect(catalog.statusCode).toBe(200);
  const body=catalog.json();expect(body.items).toHaveLength(7);expect(body.items.filter((v:{catalogId:string})=>v.catalogId==='sculpture-bench-refined')).toEqual([expect.objectContaining({catalogVersion:1,name:'조각 벤치',hostKinds:['bench'],bytes:345608,sha256:REFINED_BENCH.sha256,functional:REFINED_BENCH.functional})]);
  for(const resource of ['model','notice']){
   const response=await app.inject({method:'GET',url:base+'/sculpture-bench-refined/1/'+resource,headers});expect(response.statusCode).toBe(200);expect(response.body).toBe('synthetic '+resource);expect(read).toHaveBeenLastCalledWith(furnishingAsset('10000000-0000-4000-8000-000000000001','sculpture-bench-refined'),resource);
  }
  const count=read.mock.calls.length;
  for(const suffix of ['sculpture-bench-refined/2/model','sculpture-bench-refined/1/source','not-admitted/1/model'])expect((await app.inject({method:'GET',url:base+'/'+suffix,headers})).statusCode).toBe(404);
  expect((await app.inject({method:'GET',url:base,headers:{host:headers.host}})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:base,headers:{...headers,origin:'http://foreign.invalid'}})).statusCode).toBe(403);
  expect((await app.inject({method:'GET',url:base.replace(tenant,randomUUID()),headers})).statusCode).toBe(403);
  role='viewer';expect((await app.inject({method:'GET',url:base,headers})).statusCode).toBe(403);expect((await app.inject({method:'GET',url:base+'/sculpture-bench-refined/1/model',headers})).statusCode).toBe(403);expect(read).toHaveBeenCalledTimes(count);
 }finally{await app.close();}
});
