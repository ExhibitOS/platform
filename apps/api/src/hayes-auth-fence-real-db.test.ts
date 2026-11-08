// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {expect,it} from 'vitest';
import {migrate} from '@exhibitos/storage';
import {Auth,digest} from './auth.ts';

it.skipIf(!process.env.HAYES_FENCE_TEST_PG)('rejects aborted requests across the real commit boundary without asserting rollback',async()=>{
 const pool=new Pool({connectionString:process.env.HAYES_FENCE_TEST_PG}),tenantId=randomUUID(),userId=randomUUID(),token=randomBytes(32).toString('base64url'),csrf='test-csrf';
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'test']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),digest(token),digest(csrf),csrf,tenantId,userId]);
  await pool.query('CREATE TABLE hayes_fence_test(value integer NOT NULL)');
  const before=new AbortController();await expect(new Auth(pool).requestForHayesNativeMutation(token,tenantId,csrf,{signal:before.signal,deadlineMs:Date.now()+10000},async c=>{await c.query('INSERT INTO hayes_fence_test VALUES(1)');before.abort();})).rejects.toThrow();
  expect((await pool.query('SELECT count(*)::int AS n FROM hayes_fence_test')).rows[0].n).toBe(0);
  const during=new AbortController();let sawCommit=false;
  const fencedPool=new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const c=await target.connect();return new Proxy(c,{get(client,k){if(k==='query')return async (...args:unknown[])=>{const result=await Reflect.apply(client.query,client,args);if(args[0]==='COMMIT'){sawCommit=true;during.abort();}return result;};const value=Reflect.get(client,k,client);return typeof value==='function'?value.bind(client):value;}}) as PoolClient;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  await expect(new Auth(fencedPool).requestForHayesNativeMutation(token,tenantId,csrf,{signal:during.signal,deadlineMs:Date.now()+10000},async c=>{await c.query('INSERT INTO hayes_fence_test VALUES(2)');})).rejects.toThrow();
  expect(sawCommit).toBe(true);expect((await pool.query('SELECT value FROM hayes_fence_test')).rows.map(x=>x.value)).toEqual([2]);
 }finally{await pool.end();}
});
