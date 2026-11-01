// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ApiError,uuid,type Session} from './auth.ts';

/** Record every destination key before the first blob write. Caller must use
 * its dedicated fenced READ COMMITTED transaction, commit it successfully and
 * retain the same live Session/operation claim/lease before writing anything.
 * The row itself does not bind attemptId: caller must verify its exact issued
 * claim and reservation before commit and again before writes. This records
 * cleanup evidence, not authority, a process-drain proof, or a release
 * capability. Uncertain commits and all failures retain evidence. */
export async function recordBoundedOexDestinations(c:PoolClient,s:Session,jobId:string,leaseId:string,attemptId:string,paths:readonly string[]){
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
 for(const value of [s.tenantId,s.userId,jobId,leaseId,attemptId]){uuid(value);if(value!==value.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 if(!Array.isArray(paths)||paths.length<1||paths.length>254||paths.some(path=>typeof path!=='string'||path.length<1||Buffer.byteLength(path)>1024)||new Set(paths).size!==paths.length)throw new ApiError(400,'INVALID_INPUT');
 const snapshot=[...paths],probe=randomUUID();await c.query("SELECT set_config('exhibitos.oex_inventory_probe',$1,true)",[probe]);
 const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.oex_inventory_probe',true) AS probe")).rows[0];
 if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
 const keys=snapshot.map(()=>`${s.tenantId}/oex-import/${jobId}/${attemptId}/${randomUUID()}`);
 if(new Set(keys).size!==keys.length)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 const result=await c.query("UPDATE oex_import_jobs SET cleanup_keys=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND lease_id=$4 AND lease_until>clock_timestamp() AND state='processing' AND archive_profile='bounded-file-v1' AND oex_format='1.0.0-draft.9' AND cleanup_keys='[]'::jsonb AND NOT cleanup_pending RETURNING id",[s.tenantId,jobId,s.userId,leaseId,JSON.stringify(keys)]);
 if(result.rowCount!==1||result.rows[0]?.id!==jobId)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 return new Map(snapshot.map((path,index)=>[path,keys[index]!]));
}
