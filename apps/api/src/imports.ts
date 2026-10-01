import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Pool, PoolClient } from 'pg';
import { artworkAccess, transaction, type BlobStore, sha256 } from '@exhibitos/storage';
import { ApiError, type Session } from './auth.ts';
import { validRights } from './rights.ts';
export const MAX_UPLOAD=32*1024*1024;
export interface ImportInput { artworkId:string; idempotencyKey:string; mime:'model/gltf-binary'|'image/png'; sha256:string; bytes:number; scaleMeters:number; rights:unknown; }
export function decode(bytes:Buffer,mime:string) {
 return new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  const child=execFile(process.execPath,['--max-old-space-size=128',path.pathname,mime],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,stdout)=>{
   if(error || stdout.trim()!=='VALID')reject(new ApiError(422,'FORMAT_REJECTED'));else resolve();
  });
  child.stdin?.on('error',()=>{});child.stdin?.end(bytes);
 });
}
export class Imports {
 readonly pool:Pool; readonly blobs:BlobStore;
 constructor(pool:Pool,blobs:BlobStore){this.pool=pool;this.blobs=blobs;}
 async access(c:PoolClient,s:Session,id:string) {
  const result=await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,id]);
  const row=result.rows[0];if(!row)throw new ApiError(403,'FORBIDDEN');
  await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},row.artwork_id,true);return row;
 }
 async create(c:PoolClient,s:Session,input:ImportInput) {
  await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},input.artworkId,true);
  if(!['model/gltf-binary','image/png'].includes(input.mime)||!Number.isInteger(input.bytes)||input.bytes<1||input.bytes>MAX_UPLOAD||!Number.isFinite(input.scaleMeters)||input.scaleMeters<=0||input.scaleMeters>1000000||!/^[0-9a-f]{64}$/.test(input.sha256)||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<1||input.idempotencyKey.length>128)throw new ApiError(400,'INVALID_INPUT');
  if(!validRights(input.rights))throw new ApiError(400,'INVALID_RIGHTS');
  // Rights object order is normalized for semantic replay equality.
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  const hash=createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
  const prior=await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey]);
  if(prior.rowCount){if(prior.rows[0].request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return this.view(prior.rows[0]);}
  const id=randomUUID(),key=`${s.tenantId}/quarantine/import-${id}/${input.sha256}`,target=`${s.tenantId}/approved/${input.sha256}`;
  const row=await c.query('INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[s.tenantId,id,s.userId,input.artworkId,input.idempotencyKey,hash,input.mime,input.sha256,input.bytes,input.rights,key,target,input.scaleMeters]);
  return this.view(row.rows[0]);
 }
 view(row:Record<string,unknown>){return {id:row.id,state:row.state,progress:row.progress,attempts:row.attempts,errorCode:row.error_code,assetId:row.asset_id,retryAt:row.available_at};}
 async upload(c:PoolClient,s:Session,id:string,bytes:Buffer){
  const row=await this.access(c,s,id);if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
  await this.blobs.put(row.object_key,bytes);return {received:bytes.length};
 }
 async complete(c:PoolClient,s:Session,id:string){
  const row=await this.access(c,s,id);if(['queued','processing','approved'].includes(row.state))return this.view(row);
  if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(row.object_key));}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}
  if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
  const result=await c.query("UPDATE import_jobs SET state='queued',progress=10,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[s.tenantId,id]);return this.view(result.rows[0]);
 }
 async action(c:PoolClient,s:Session,id:string,action:'cancel'|'retry'){
  const row=await this.access(c,s,id);
  if(action==='cancel'){
   if(row.state==='approved')throw new ApiError(409,'JOB_STATE');
   await c.query("UPDATE import_jobs SET state='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
  }else{
   if(row.state!=='failed'||row.attempts>=5||new Date(row.available_at).getTime()>Date.now())throw new ApiError(409,'JOB_STATE');
   await c.query("UPDATE import_jobs SET state='queued',error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
  }
  return this.view((await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]);
 }
 async work(hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>}){
  const lease=randomUUID();
  const row=await transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
   await c.query("UPDATE import_jobs SET state='failed',error_code='RETRY_EXHAUSTED',lease_id=NULL,lease_until=NULL WHERE state='processing' AND lease_until<clock_timestamp() AND attempts>=5");
   const found=await c.query("SELECT * FROM import_jobs WHERE (state='queued' AND available_at<=now() OR state='processing' AND lease_until<clock_timestamp()) AND attempts<5 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1");
   if(!found.rowCount)return null;const r=found.rows[0];
   await c.query("UPDATE import_jobs SET state='processing',progress=25,attempts=attempts+1,lease_id=$3,lease_until=clock_timestamp()+interval '30 seconds',updated_at=now() WHERE tenant_id=$1 AND id=$2",[r.tenant_id,r.id,lease]);return r;
  });if(!row)return false;
  try{
   const bytes=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return Buffer.from(await this.blobs.get(row.object_key));});if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
   await decode(bytes,row.mime);
   await hooks?.beforeCommit?.();
   await transaction(this.pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const current=await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[row.tenant_id,row.id,lease]);if(!current.rowCount)return;
    // Recheck current membership and ownership, including revocation during decoding.
    await artworkAccess(c,{tenantId:row.tenant_id,userId:row.user_id},row.artwork_id,true);
    await this.blobs.put(row.approved_key,bytes);await hooks?.afterCopy?.();
    const deadline=await c.query('SELECT lease_until>clock_timestamp() AS valid FROM import_jobs WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id]);if(!deadline.rows[0]?.valid)throw new ApiError(409,'LEASE_EXPIRED');
    const asset=randomUUID(),rights=randomUUID();await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rights,row.rights]);
    await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'approved')",[row.tenant_id,asset,row.artwork_id,rights,row.approved_key,row.expected_hash,row.expected_bytes,row.mime,row.scale_meters]);
    await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,asset]);
   });
  }catch(error){
   const code=error instanceof ApiError?error.code:'WORKER_FAILED';
   await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await c.query("UPDATE import_jobs SET state='failed',error_code=$4,lease_id=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(60,power(2,attempts)::int)),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3",[row.tenant_id,row.id,lease,code]);});
  }return true;
 }
}
