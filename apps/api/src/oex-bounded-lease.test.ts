// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const s={id:id(1),tenantId:id(2),userId:id(3),role:'artist'} as Session,input={jobId:id(4),requestId:id(5),bytes:12,sha256:'a'.repeat(64)};
function fixture(){
 let probe='',activeCount=0;const state={expireAfterLock:false},row={state:'queued',archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',request_id:input.requestId,expected_bytes:input.bytes,payload_sha256:input.sha256,lease_id:null,cleanup_pending:false,cleanup_keys:[],staging_keys:[`${s.tenantId}/oex-staging/${input.jobId}/chunk-0`]};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.includes('FROM auth_sessions')){activeCount++;return state.expireAfterLock&&activeCount>1?{rowCount:0,rows:[]}:{rowCount:1,rows:[{role:'artist'}]};}if(sql.startsWith('SELECT * FROM oex_import_jobs'))return {rows:[row]};if(sql.startsWith('UPDATE'))return {rowCount:1,rows:[{id:input.jobId,lease_id:args![3]}]};throw Error('unexpected');});return {row,query,state};
}
it('claims only the exact queued personal job under the existing transaction',async()=>{
 const f=fixture(),result=await claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input);expect(result.jobId).toBe(input.jobId);expect(result.archiveSha256).toBe(input.sha256);expect(result.leaseId).toMatch(/^[a-f0-9-]{36}$/);
});
it('refuses altered staging identity before assigning a lease',async()=>{
 const f=fixture();f.row.staging_keys=['other'];await expect(claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input)).rejects.toThrow('OEX_JOB_INVALID');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('refuses a session that expires while waiting for the job row',async()=>{
 const f=fixture();f.state.expireAfterLock=true;await expect(claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input)).rejects.toThrow('FORBIDDEN');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('rechecks Session and lease after acquiring the committed row lock',async()=>{
 let probe='',checks=0;const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.startsWith('SELECT j.id')){checks++;return checks===1?{rowCount:1,rows:[{id:input.jobId}]}:{rowCount:0,rows:[]};}throw Error('unexpected');});
 await expect(verifyBoundedOexLease({query} as unknown as PoolClient,s,{jobId:input.jobId,requestId:input.requestId,userId:s.userId,leaseId:'10000000-0000-4000-8000-000000000006',archiveBytes:input.bytes,archiveSha256:input.sha256})).rejects.toThrow('OEX_LEASE_UNAVAILABLE');expect(checks).toBe(2);
});
