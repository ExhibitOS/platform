// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';

const CHUNK=16*1024*1024,MAX=512*1024*1024,hex=/^[a-f0-9]{64}$/;
type Job={tenant_id:string;id:string;user_id:string;state:string;expected_bytes:number;payload_sha256:string;archive_profile:string;oex_format:string;staging_keys:unknown};
async function requireTransaction(c:PoolClient){
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.oex_tx_probe',$1,true)",[probe]);
 const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.oex_tx_probe',true) AS probe")).rows[0];
 if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
}
/** Transactional job creation only; the caller must supply a continuously
 * open READ COMMITTED transaction and already hold the real native Session /
 * operation-ready capability and supported-workspace writer exclusion.
 * The transaction-local probe detects accidental autocommit; it is never
 * authentication or a substitute for a live owner/fence. No route is connected. */
export async function createBoundedOexJob(c:PoolClient,s:Session,input:{requestId:string;bytes:number;sha256:string}){
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='bytes,requestId,sha256')throw new ApiError(400,'INVALID_INPUT');
 uuid(input.requestId);if(input.requestId!==input.requestId.toLowerCase()||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>MAX||typeof input.sha256!=='string'||!hex.test(input.sha256))throw new ApiError(400,'INVALID_INPUT');
 await requireTransaction(c);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:oex-quota`]);
 const prior=(await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0] as Job|undefined;
 if(prior){if(prior.archive_profile!=='bounded-file-v1'||prior.oex_format!=='1.0.0-draft.9'||prior.payload_sha256!==input.sha256||Number(prior.expected_bytes)!==input.bytes)throw new ApiError(409,'REQUEST_CONFLICT');return {id:prior.id,state:prior.state};}
 const quota=(await c.query("SELECT count(*) AS count,coalesce(sum(expected_bytes),0) AS bytes FROM oex_import_jobs WHERE tenant_id=$1 AND (state IN ('uploading','queued','processing','failed') OR cleanup_pending)",[s.tenantId])).rows[0];
 if(Number(quota.count)>=16||Number(quota.bytes)+input.bytes>MAX)throw new ApiError(409,'OEX_JOB_LIMIT');
 const id=randomUUID(),keys=Array.from({length:Math.ceil(input.bytes/CHUNK)},(_,i)=>`${s.tenantId}/oex-staging/${id}/chunk-${i}`);
 const row=(await c.query("INSERT INTO oex_import_jobs(tenant_id,id,user_id,request_id,payload_sha256,expected_bytes,staging_keys,archive_profile,oex_format) VALUES($1,$2,$3,$4,$5,$6,$7,'bounded-file-v1','1.0.0-draft.9') RETURNING id,state",[s.tenantId,id,s.userId,input.requestId,input.sha256,input.bytes,JSON.stringify(keys)])).rows[0];
 if(!row||row.id!==id||row.state!=='uploading')throw new ApiError(409,'OEX_JOB_INVALID');return {id:row.id as string,state:row.state as string};
}
/** Inactive bounded-profile source. The caller owns the DB transaction and
 * Session; no route may use this until workspace fencing and old-worker refusal
 * are established. Verification never queues, deletes, or releases a job. */
async function lockedJob(c:PoolClient,s:Session,id:string):Promise<{row:Job;keys:string[]}>{
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');uuid(id);
 await requireTransaction(c);
 const row=(await c.query('SELECT * FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,id])).rows[0] as Job|undefined;
 // This bounded path is scoped to the personal Session principal even when
 // that principal has an administrative role; it cannot adopt another job.
 if(!row||row.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 if(row.archive_profile!=='bounded-file-v1'||row.oex_format!=='1.0.0-draft.9'||row.state!=='uploading'||!Number.isSafeInteger(row.expected_bytes)||row.expected_bytes<1||row.expected_bytes>MAX||!hex.test(row.payload_sha256)||!Array.isArray(row.staging_keys)||row.staging_keys.length!==Math.ceil(row.expected_bytes/CHUNK))throw new ApiError(409,'OEX_PROFILE_UNSUPPORTED');
 const keys=row.staging_keys as unknown[];
 if(keys.some((key,index)=>key!==`${s.tenantId}/oex-staging/${id}/chunk-${index}`))throw new ApiError(409,'OEX_STAGING_INVALID');
 return {row,keys:keys as string[]};
}

/** Immutable BlobStore.put rejects different bytes at an existing chunk key. */
export async function putBoundedOexChunk(c:PoolClient,s:Session,id:string,index:number,bytes:Uint8Array,blobs:FileBlobStore){
 if(!(blobs instanceof FileBlobStore))throw new ApiError(409,'OEX_PROFILE_UNSUPPORTED');
 const {row,keys}=await lockedJob(c,s,id);
 if(!Number.isSafeInteger(index)||index<0||index>=keys.length||!(bytes instanceof Uint8Array)||bytes.byteLength!==Math.min(CHUNK,row.expected_bytes-index*CHUNK))throw new ApiError(400,'INVALID_INPUT');
 await blobs.put(keys[index]!,bytes);return {received:bytes.byteLength,index};
}

/** Read each immutable chunk once in job order, without aggregating the OEX. */
export async function verifyBoundedOexChunks(c:PoolClient,s:Session,id:string,blobs:FileBlobStore){
 if(!(blobs instanceof FileBlobStore))throw new ApiError(409,'OEX_PROFILE_UNSUPPORTED');
 const {row,keys}=await lockedJob(c,s,id),hash=createHash('sha256');let total=0;
 for(const [index,key] of keys.entries()){
  let bytes:Uint8Array;try{bytes=await blobs.get(key);}catch(error){if((error as NodeJS.ErrnoException)?.code==='ENOENT')throw new ApiError(409,'UPLOAD_INCOMPLETE');throw error;}const length=Math.min(CHUNK,row.expected_bytes-index*CHUNK);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==length)throw new ApiError(409,'UPLOAD_INCOMPLETE');
  hash.update(bytes);total+=bytes.byteLength;
 }
 if(total!==row.expected_bytes||hash.digest('hex')!==row.payload_sha256)throw new ApiError(409,'UPLOAD_INCOMPLETE');
 return {bytes:total,sha256:row.payload_sha256};
}

/** Transition only the already verified personal bounded upload to queued.
 * Caller retains the same owner capability and READ COMMITTED transaction;
 * queueing alone does not authorize any worker, claim, or resource release. */
export async function queueBoundedOexJob(c:PoolClient,s:Session,id:string,blobs:FileBlobStore){
 const verified=await verifyBoundedOexChunks(c,s,id,blobs);
 const row=await c.query("UPDATE oex_import_jobs SET state='queued',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND state='uploading' AND archive_profile='bounded-file-v1' AND oex_format='1.0.0-draft.9' AND expected_bytes=$4 AND payload_sha256=$5 RETURNING id,state",[s.tenantId,id,s.userId,verified.bytes,verified.sha256]);
 if(row.rowCount!==1||row.rows[0]?.id!==id||row.rows[0]?.state!=='queued')throw new ApiError(409,'OEX_JOB_INVALID');
 return {id,state:'queued' as const};
}
