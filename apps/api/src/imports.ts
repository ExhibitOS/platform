import {modelDerivationInput,prepareModelPair,type ModelDerivation,type ModelPairResult} from './model-derivation.ts';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Pool, PoolClient } from 'pg';
import { artworkAccess, transaction, type BlobStore, sha256 } from '@exhibitos/storage';
import { ApiError, type Session } from './auth.ts';
import { validRights } from './rights.ts';
import {preparedImageInput,preparedImageHeader,type PreparedImage} from './prepared-image.ts';
export const MAX_UPLOAD=32*1024*1024;
export interface ImportInput { artworkId:string; idempotencyKey:string; mime:'model/gltf-binary'|'image/png'|'image/jpeg'; sha256:string; bytes:number; scaleMeters:number; rights:unknown; derived?:PreparedImage; modelDerivation?:ModelDerivation; }
export function decode(bytes:Buffer,mime:string) {
 return new Promise<void>((resolve,reject)=>{
  const path=new URL('./validation-worker.js',import.meta.url);if(import.meta.url.endsWith('.ts'))path.pathname=path.pathname.replace(/\.js$/,'.ts');
  const child=execFile(process.execPath,['--max-old-space-size=128',fileURLToPath(path),mime],{timeout:5000,maxBuffer:4096,env:{PATH:process.env.PATH},killSignal:'SIGKILL'},(error,stdout)=>{
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
  const artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},input.artworkId,true);
  const model=modelDerivationInput(input.modelDerivation);
  if(model&&(input.mime!=='model/gltf-binary'||input.derived!==undefined||model.operationID!==input.idempotencyKey))throw new ApiError(400,'INVALID_MODEL_DERIVATION');
  if(model&&artwork.revision!==model.artworkRevision)throw new ApiError(409,'REVISION_CONFLICT');
  const derived=preparedImageInput(input.derived);
  if((input.mime==='image/jpeg')!==(derived!==undefined))throw new ApiError(400,'INVALID_DERIVED_INPUT');
  if(!['model/gltf-binary','image/png','image/jpeg'].includes(input.mime)||!Number.isInteger(input.bytes)||input.bytes<1||input.bytes>MAX_UPLOAD||!Number.isFinite(input.scaleMeters)||input.scaleMeters<=0||input.scaleMeters>1000000||!/^[0-9a-f]{64}$/.test(input.sha256)||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<1||input.idempotencyKey.length>128)throw new ApiError(400,'INVALID_INPUT');
  if(!validRights(input.rights))throw new ApiError(400,'INVALID_RIGHTS');
  // Rights object order is normalized for semantic replay equality.
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  const hash=createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
  const prior=await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey]);
  if(prior.rowCount){if(prior.rows[0].request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return this.view(prior.rows[0]);}
  const id=randomUUID(),key=`${s.tenantId}/quarantine/import-${id}/${input.sha256}`,target=`${s.tenantId}/approved/${derived?.sha256??input.sha256}`,preparedKey=derived?`${s.tenantId}/quarantine/import-${id}/prepared-${derived.sha256}`:null;
  const row=await c.query('INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key,model_derivation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[s.tenantId,id,s.userId,input.artworkId,input.idempotencyKey,hash,input.mime,input.sha256,input.bytes,input.rights,key,target,input.scaleMeters,derived??null,preparedKey,model?{kind:'model-texture-pair',request:model}:null]);
  return this.view(row.rows[0]);
 }
 model(row:Record<string,unknown>){
  const value=row.model_derivation as {kind?:unknown;request?:unknown;result?:unknown}|null;
  if(!value||value.kind!=='model-texture-pair')return undefined;
  if(row.mime!=='model/gltf-binary'||Object.keys(value).some(k=>!['kind','request','result'].includes(k)))throw new ApiError(422,'FORMAT_REJECTED');
  return modelDerivationInput(value.request);
 }
 view(row:Record<string,unknown>){
  const model=this.model(row),result=(row.model_derivation as {result?:Record<string,unknown>}|null)?.result;
  return {id:row.id,state:row.state,progress:row.progress,attempts:row.attempts,errorCode:row.error_code,assetId:row.asset_id,retryAt:row.available_at,
   ...(model?{modelDerivation:{...(result??{}),operationID:model.operationID,generation:model.generation,profileId:model.profileId,status:result?.status??(['failed','cancelled'].includes(String(row.state))?'failed':'pending'),workerDrained:row.lease_id==null}}:row.derived==null?{}:{originalAssetId:row.original_asset_id})};
 }
 prepared(row:Record<string,unknown>){if(this.model(row))return undefined;const derived=preparedImageInput(row.derived??undefined);if((row.mime==='image/jpeg')!==(derived!==undefined))throw new ApiError(422,'FORMAT_REJECTED');return derived;}
 async preparedBytes(row:Record<string,unknown>,derived:PreparedImage){
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(String(row.derived_object_key)));}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}
  if(bytes.length!==derived.bytes||sha256(bytes)!==derived.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');return bytes;
 }
 async uploadDerived(c:PoolClient,s:Session,id:string,bytes:Buffer){
  const row=await this.access(c,s,id),derived=this.prepared(row);if(!derived||row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  if(bytes.length!==derived.bytes||sha256(bytes)!==derived.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
  await this.blobs.put(row.derived_object_key,bytes);return {received:bytes.length};
 }
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
  const derived=this.prepared(row);if(derived)await this.preparedBytes(row,derived);
  const result=await c.query("UPDATE import_jobs SET state='queued',progress=10,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[s.tenantId,id]);return this.view(result.rows[0]);
 }
 async action(c:PoolClient,s:Session,id:string,action:'cancel'|'retry'){
  const row=await this.access(c,s,id);
  if(action==='cancel'){
   if(row.state==='approved')throw new ApiError(409,'JOB_STATE');
   if(this.model(row)&&row.lease_id!=null)await c.query("UPDATE import_jobs SET state='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
   else await c.query("UPDATE import_jobs SET state='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
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
   const derived=this.prepared(row);let display:Buffer=bytes;
   if(derived){
    // Bounded private original custody, not server JPEG codec or pixel-equivalence certification.
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw new ApiError(422,'FORMAT_REJECTED');
    display=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return this.preparedBytes(row,derived);});preparedImageHeader(display);
   }
   await decode(display,derived?'image/png':row.mime);
   const model=this.model(row);let pair:ModelPairResult|undefined;
   if(model){try{pair=await prepareModelPair(display,model);}catch{/* Preserve a successfully decoded original without registering a partial derivative. */}}
   await hooks?.beforeCommit?.();
   await transaction(this.pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const current=await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[row.tenant_id,row.id,lease]);if(!current.rowCount)return;
    // Recheck current membership and ownership, including revocation during decoding.
    const artwork=await artworkAccess(c,{tenantId:row.tenant_id,userId:row.user_id},row.artwork_id,true);
    if(model&&artwork.revision!==model.artworkRevision)throw new ApiError(409,'REVISION_CONFLICT');
    await this.blobs.put(row.approved_key,display);await hooks?.afterCopy?.();
    const deadline=await c.query('SELECT lease_until>clock_timestamp() AS valid FROM import_jobs WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id]);if(!deadline.rows[0]?.valid)throw new ApiError(409,'LEASE_EXPIRED');
    const asset=randomUUID(),rights=randomUUID();await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rights,row.rights]);
    let originalAsset:string|null=null;
    if(derived){
     originalAsset=randomUUID();
     await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'quarantine')",[row.tenant_id,originalAsset,row.artwork_id,rights,row.object_key,row.expected_hash,row.expected_bytes,row.mime,row.scale_meters]);
    }
    await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'approved')",[row.tenant_id,asset,row.artwork_id,rights,row.approved_key,derived?.sha256??row.expected_hash,derived?.bytes??row.expected_bytes,derived?'image/png':row.mime,row.scale_meters]);
    if(derived)await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),originalAsset,{version:1,kind:'image-preparation',originalAssetId:originalAsset,derivedAssetId:asset,original:{mime:row.mime,sha256:row.expected_hash,bytes:row.expected_bytes},derived:{mime:derived.mime,sha256:derived.sha256,bytes:derived.bytes},recipe:derived.recipe,provenance:'client-declared'}]);
    if(model){
     let reducedAsset:string|undefined;
     if(pair){
      reducedAsset=randomUUID();const reducedKey=`${row.tenant_id}/approved/${pair.receipt.reduced.sha256}`;
      await this.blobs.put(reducedKey,pair.bytes);
      await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'approved')",[row.tenant_id,reducedAsset,row.artwork_id,rights,reducedKey,pair.receipt.reduced.sha256,pair.bytes.length,'model/gltf-binary',row.scale_meters]);
      await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),asset,{version:1,kind:'model-texture-pair',fullAssetId:asset,reducedAssetId:reducedAsset,receipt:pair.receipt}]);
     }
     const result=pair?{status:'ready',fullAssetId:asset,reducedAssetId:reducedAsset,full:{...pair.receipt.full,assetId:asset},reduced:{...pair.receipt.reduced,assetId:reducedAsset}}:{status:'failed',fullAssetId:asset,full:{assetId:asset,sha256:row.expected_hash,bytes:Number(row.expected_bytes),reusedExactBytes:true},errorCode:'MODEL_DERIVATIVE_UNSUPPORTED'};
     await c.query('UPDATE import_jobs SET model_derivation=$3 WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id,{kind:'model-texture-pair',request:model,result}]);
     const currentLease=await c.query('SELECT lease_until>clock_timestamp() AS valid FROM import_jobs WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id]);if(!currentLease.rows[0]?.valid)throw new ApiError(409,'LEASE_EXPIRED');
    }
    await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,asset,originalAsset]);
   });
  }catch(error){
   const code=error instanceof ApiError?error.code:'WORKER_FAILED';
   await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await c.query("UPDATE import_jobs SET state='failed',error_code=$4,lease_id=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(60,power(2,attempts)::int)),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3",[row.tenant_id,row.id,lease,code]);});
  }finally{
   // Only the actual completed worker/decoder call reaches this owner cleanup.
   // A cancellation response keeps this lease until close; timeout is not drain.
   if(this.model(row))await transaction(this.pool,async c=>{await c.query("UPDATE import_jobs SET lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND state='cancelled' AND lease_id=$3",[row.tenant_id,row.id,lease]);});
  }return true;
 }
}
