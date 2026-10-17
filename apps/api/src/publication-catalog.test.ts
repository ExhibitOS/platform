// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { Publications } from './publication.ts';
import type { Session } from './auth.ts';
import { buildApp } from './app.ts';
const tenant='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const session=(role:Session['role']):Session=>({id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,userId:user,role,csrfToken:'synthetic',expiresAt:'2099-01-01T00:00:00Z'});
const pool={} as Pool;
test('publication catalog returns only bounded approved-publication selection metadata',async()=>{
 const query=vi.fn(async()=>({rows:[{id:'pub-one',exhibition_id:'exhibition-one',title:'Known publication',revision_sha256:'a'.repeat(64),published_at:new Date('2026-10-17T12:00:00Z'),snapshot:{private:'must-not-expose'},created_by:'private-user',object_key:'private-key'}]}));
 const result=await new Publications(pool).catalog({query} as unknown as PoolClient,session('artist'));
 expect(result).toEqual({items:[{publicationId:'pub-one',exhibitionId:'exhibition-one',title:'Known publication',revisionSha256:'a'.repeat(64),publishedAt:'2026-10-17T12:00:00.000Z',status:'published'}]});
 expect(JSON.stringify(result)).not.toMatch(/must-not-expose|private-key|private-user/);
});
test('catalog keeps existing tenant, Studio owner, published-state and deletion constraints in the database query',async()=>{
 for(const role of ['admin','curator','artist'] as const){
  const query=vi.fn(async()=>({rows:[]}));await new Publications(pool).catalog({query} as unknown as PoolClient,session(role));
  const [sql,parameters]=query.mock.calls[0] as unknown as [string,unknown[]];
  expect(parameters).toEqual([tenant,role==='admin',user]);
  for(const boundary of ['p.tenant_id=$1',"state.status='published'",'e.tenant_id=p.tenant_id','e.id=p.exhibition_id','e.studio_managed','e.deleted_at IS NULL','($2::boolean OR e.studio_owner_user_id=$3)','LIMIT 100'])expect(sql).toContain(boundary);
 }
});
test('non-Studio roles cannot list any publication selection metadata',async()=>{
 const query=vi.fn();await expect(new Publications(pool).catalog({query} as unknown as PoolClient,session('viewer'))).rejects.toMatchObject({status:403,code:'FORBIDDEN'});expect(query).not.toHaveBeenCalled();
});
test('long or absent titles cannot make catalog metadata unbounded',async()=>{
 const query=vi.fn(async()=>({rows:[{id:'a',exhibition_id:'b',title:'x'.repeat(1000),revision_sha256:'a'.repeat(64),published_at:new Date(0)},{id:'c',exhibition_id:'d',title:null,revision_sha256:'b'.repeat(64),published_at:new Date(0)}]}));
 const result=await new Publications(pool).catalog({query} as unknown as PoolClient,session('admin'));expect(result.items[0]!.title.length).toBe(256);expect(result.items[1]!.title).toBe('');
});
test('catalog route uses existing session and exact-origin guards rather than anonymous publication access',async()=>{
 const query=vi.fn(async()=>{throw Error('No database connection expected');});const app=buildApp({pool:{query} as unknown as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{
  const url=`/api/v1/tenants/${tenant}/studio/publications`;
  const absent=await app.inject({method:'GET',url,headers:{host:'127.0.0.1:13200'}});expect(absent.statusCode).toBe(401);expect(absent.headers['cache-control']).toBe('no-store');
  const foreign=await app.inject({method:'GET',url,headers:{host:'127.0.0.1:13200',origin:'http://foreign.invalid'}});expect(foreign.statusCode).toBe(403);expect(foreign.json().code).toBe('ORIGIN_REJECTED');expect(query).not.toHaveBeenCalled();
 }finally{await app.close();}
});
