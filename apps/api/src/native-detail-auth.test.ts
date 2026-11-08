// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {Pool} from 'pg';
import {Auth} from './auth.ts';

it('establishes read committed before shared policy locks and still requires CSRF',async()=>{
 const tenantId=randomUUID(),csrf='csrf',queries:string[]=[],session={id:randomUUID(),user_id:randomUUID(),tenant_id:tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}},auth=new Auth({connect:async()=>client} as unknown as Pool);
 expect(await auth.requestForNativeDetailRead('a'.repeat(43),tenantId,csrf,async(_c,s)=>s.userId)).toBe(session.user_id);
 const isolation=queries.findIndex(q=>q.includes('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')),lock=queries.findIndex(q=>q.includes('pg_advisory_xact_lock_shared(82003)'));
 expect(isolation).toBeGreaterThan(-1);expect(lock).toBeGreaterThan(isolation);expect(queries.some(q=>q.includes('pg_advisory_xact_lock_shared(82002)'))).toBe(true);
 await expect(auth.requestForNativeDetailRead('a'.repeat(43),tenantId,'wrong',async()=>true)).rejects.toThrow('CSRF_REJECTED');
});
