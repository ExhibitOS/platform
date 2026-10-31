// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {Oex} from './oex.ts';
const tenant='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',user='10000000-0000-4000-8000-000000000003';
const session={tenantId:tenant,userId:user,role:'admin' as const,id,csrfToken:'',expiresAt:new Date().toISOString()};
const job={tenant_id:tenant,id,user_id:user,request_id:id,payload_sha256:'a'.repeat(64),expected_bytes:1,state:'queued',attempts:0,lease_id:null,lease_until:null,error_code:null,result:null,staging_keys:[],cleanup_keys:[],cleanup_pending:true,archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9'};
it('refuses a later-profile job even if a caller bypasses queue selection',async()=>{
 const queries:string[]=[],query=vi.fn(async(sql:string)=>{queries.push(sql);return {rows:sql.startsWith('SELECT * FROM oex_import_jobs')?[job]:[],rowCount:0};});
 const client={query,release:vi.fn()},pool={connect:async()=>client} as unknown as Pool,store={remove:vi.fn(),get:vi.fn(),put:vi.fn()} as unknown as BlobStore,service=new Oex(pool,store);
 expect(await service.run(id)).toBe(false);expect(await service.cleanup(id)).toBe(false);expect(queries.some(sql=>sql.startsWith('UPDATE oex_import_jobs'))).toBe(false);
 await expect(service.complete(client as unknown as PoolClient,session,id)).rejects.toMatchObject({code:'OEX_PROFILE_UNSUPPORTED'});
 await expect(service.action(client as unknown as PoolClient,session,id,'retry')).rejects.toMatchObject({code:'OEX_PROFILE_UNSUPPORTED'});
 expect(store.get).not.toHaveBeenCalled();expect(store.remove).not.toHaveBeenCalled();
});
