// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ApiError,uuid,type Session} from './auth.ts';
const hex=/^[a-f0-9]{64}$/;
/** Transactional queued-job claim for the single private bounded operation.
 * The caller holds the shared authorization/maintenance locks, the same
 * issued resource claim and workspace fence, has
 * bound the exact live Manager Session, and commits this transaction before
 * sending claim-ready. A DB lease does not prove worker exit or authorize
 * release. No timeout or restart automatically takes over this operation. */
export async function claimBoundedOexLease(c:PoolClient,s:Session,input:{jobId:string;requestId:string;bytes:number;sha256:string}){
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='bytes,jobId,requestId,sha256')throw new ApiError(400,'INVALID_INPUT');s=structuredClone(s);input=structuredClone(input);
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
 for(const value of [s.id,s.tenantId,s.userId,input.jobId,input.requestId]){uuid(value);if(value!==value.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 if(!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>512*1024*1024||typeof input.sha256!=='string'||!hex.test(input.sha256))throw new ApiError(400,'INVALID_INPUT');
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.oex_lease_probe',$1,true)",[probe]);const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.oex_lease_probe',true) AS probe")).rows[0];
 if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
 const requireActive=async()=>{const active=await c.query("SELECT m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL",[s.id,s.tenantId,s.userId]);if(active.rowCount!==1||active.rows[0]?.role!==s.role)throw new ApiError(403,'FORBIDDEN');};
 await requireActive();
 const selected=(await c.query("SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 FOR UPDATE",[s.tenantId,input.jobId,s.userId])).rows[0];
 if(!selected||selected.state!=='queued'||selected.archive_profile!=='bounded-file-v1'||selected.oex_format!=='1.0.0-draft.9'||selected.request_id!==input.requestId||Number(selected.expected_bytes)!==input.bytes||selected.payload_sha256!==input.sha256||selected.lease_id!==null||selected.cleanup_pending||!Array.isArray(selected.cleanup_keys)||selected.cleanup_keys.length||!Array.isArray(selected.staging_keys)||selected.staging_keys.length!==Math.ceil(input.bytes/(16*1024*1024))||selected.staging_keys.some((key:unknown,index:number)=>key!==`${s.tenantId}/oex-staging/${input.jobId}/chunk-${index}`))throw new ApiError(409,'OEX_JOB_INVALID');
 await requireActive();
 const leaseId=randomUUID(),result=await c.query("UPDATE oex_import_jobs SET state='processing',attempts=attempts+1,lease_id=$4,lease_until=clock_timestamp()+interval '30 minutes',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND state='queued' AND lease_id IS NULL AND attempts<5 RETURNING id,lease_id",[s.tenantId,input.jobId,s.userId,leaseId]);
 if(result.rowCount!==1||result.rows[0]?.id!==input.jobId||result.rows[0]?.lease_id!==leaseId)throw new ApiError(409,'OEX_JOB_INVALID');
 return Object.freeze({jobId:input.jobId,requestId:input.requestId,userId:s.userId,leaseId,archiveBytes:input.bytes,archiveSha256:input.sha256});
}

/** Recheck the committed processing lease with current Session time/authority.
 * The caller holds the same operation fence and authorization/maintenance
 * locks and must recheck again immediately before its final COMMIT. */
export async function verifyBoundedOexLease(c:PoolClient,s:Session,lease:Awaited<ReturnType<typeof claimBoundedOexLease>>){
 s=structuredClone(s);lease=structuredClone(lease);
 for(const value of [s.id,s.tenantId,s.userId,lease.jobId,lease.requestId,lease.userId,lease.leaseId]){uuid(value);if(value!==value.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 if(s.userId!==lease.userId||!['admin','artist'].includes(s.role)||!Number.isSafeInteger(lease.archiveBytes)||lease.archiveBytes<1||lease.archiveBytes>512*1024*1024||typeof lease.archiveSha256!=='string'||!hex.test(lease.archiveSha256))throw new ApiError(403,'FORBIDDEN');
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.oex_verify_probe',$1,true)",[probe]);const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.oex_verify_probe',true) AS probe")).rows[0];if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
 const sql="SELECT j.id FROM oex_import_jobs j JOIN auth_sessions a ON (a.tenant_id,a.user_id)=(j.tenant_id,j.user_id) JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL AND m.role=$4 AND j.id=$5 AND j.request_id=$6 AND j.lease_id=$7 AND j.lease_until>clock_timestamp() AND j.state='processing' AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.9' AND j.expected_bytes=$8 AND j.payload_sha256=$9 FOR UPDATE OF j",params=[s.id,s.tenantId,s.userId,s.role,lease.jobId,lease.requestId,lease.leaseId,lease.archiveBytes,lease.archiveSha256];
 for(let i=0;i<2;i++){const row=await c.query(sql,params);if(row.rowCount!==1||row.rows[0]?.id!==lease.jobId)throw new ApiError(409,'OEX_LEASE_UNAVAILABLE');}
}
