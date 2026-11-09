import {createCompactVariant,type CompactVariantInput} from './compact-model-variant.ts';
import {modelPreparationIntent,storedModelPreparation,modelPreparationView,type ModelPreparationIntent} from './model-preparation-intent.ts';
import {assertModelPreparationContext,assertModelPreparationSlot,workRequiredModelPreparation,assertModelPreparationExecution,type ModelPreparationExecution} from './model-preparation-import.ts';
import {isDeepStrictEqual} from 'node:util';
import {modelDerivationInput,prepareModelPair,type ModelDerivation,type ModelPairResult} from './model-derivation.ts';
import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { artworkAccess, transaction, type BlobStore, sha256 } from '@exhibitos/storage';
import { ApiError, type Session } from './auth.ts';
import { validRights,allowedRights } from './rights.ts';
import {preparedImageInput,preparedImageHeader,type PreparedImage} from './prepared-image.ts';
import {LARGE_MODEL_RECIPE} from './oam-original-preparation.ts';
import {MAX_UPLOAD} from './upload-limits.ts';
export {MAX_UPLOAD} from './upload-limits.ts';
export interface ImportInput { artworkId:string; idempotencyKey:string; mime:'model/gltf-binary'|'image/png'|'image/jpeg'; sha256:string; bytes:number; scaleMeters:number; rights:unknown; derived?:PreparedImage; modelDerivation?:ModelDerivation; coarsePreparation?:ImageCoarseIntent; modelPreparation?:ModelPreparationIntent; }
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {imageCoarseIntent,imageCoarsePolicy,storedImageCoarse,type ImageCoarseIntent} from './image-coarse-intent.ts';
import {prepareIntentImageCoarse} from './artwork-coarse-preparation.ts';
import {decode} from './validation-client.ts';
import {assertHayesOriginalContext} from './hayes-original-attempt.ts';
export {decode} from './validation-client.ts';
export class Imports {
 readonly pool:Pool; readonly blobs:BlobStore; readonly nativeWorkspace:NativeOexWorkspaceContext|undefined; readonly modelExecution:ModelPreparationExecution|undefined;
 constructor(pool:Pool,blobs:BlobStore,nativeWorkspace?:NativeOexWorkspaceContext,modelExecution?:ModelPreparationExecution){if(modelExecution)assertModelPreparationExecution(modelExecution,blobs,nativeWorkspace);this.pool=pool;this.blobs=blobs;this.nativeWorkspace=nativeWorkspace;this.modelExecution=modelExecution;}
 async requiredModelReady(c:PoolClient,s?:{tenantId:string;userId:string}){if(!this.modelExecution)throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');await this.modelExecution.assertReady(c,s);}
 async largeModelReady(c:PoolClient,s:{tenantId:string;userId:string}){
  await this.requiredModelReady(c,s);
  const result=await c.query('SELECT 1 FROM schema_migrations WHERE name=$1 AND sha256=$2',['046_large_model_preparation.sql','88d2840c9f948be4573e1a8682aa67c4225c087643273afb3b74b9cac8b558b4']);
  if(!result.rowCount)throw new ApiError(503,'LARGE_MODEL_PREPARATION_UNAVAILABLE');
 }
 async createCompact(c:PoolClient,s:Session,artworkId:string,input:CompactVariantInput){await this.requiredModelReady(c,s);return this.view(await createCompactVariant(c,s,artworkId,input,this.modelExecution!));}
 async coarseOwner(c:PoolClient,tenantId:string,principalId:string,workspaceId?:string){const owner=this.nativeWorkspace;if(!owner||owner.tenantId!==tenantId||owner.principalId!==principalId||(workspaceId!==undefined&&owner.workspaceId!==workspaceId))throw new ApiError(403,'FORBIDDEN');await owner.assertDatabase(c);return owner;}
 async boundedBlob(key:string,bytes:number){const read=this.blobs.getBounded;if(!read)throw new ApiError(503,'STORAGE_UNAVAILABLE');return read.call(this.blobs,key,bytes);}
 async access(c:PoolClient,s:Session,id:string) {
  const result=await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,id]);
  const row=result.rows[0];if(!row)throw new ApiError(403,'FORBIDDEN');
  await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},row.artwork_id,true);if(Object.hasOwn(row,'hayes_attempt_id')&&row.mime==='model/gltf-binary'&&row.expected_hash==='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6'&&Number(row.expected_bytes)===8383096){if(row.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');await assertHayesOriginalContext(c,s,this.nativeWorkspace);}const coarse=storedImageCoarse(row);if(coarse){if(row.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');await this.coarseOwner(c,s.tenantId,s.userId,coarse.workspaceId);}if(storedModelPreparation(row)){if(row.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');if(row.state==='approved')await assertModelPreparationContext(c,row);}return row;
 }
 async create(c:PoolClient,s:Session,input:ImportInput) {
  const preparation=modelPreparationIntent(input.modelPreparation);
  const large=preparation?.profileId===LARGE_MODEL_RECIPE.id;
  if(preparation?.sourceFull||preparation?.sourceDisplayReference)throw new ApiError(400,'INVALID_MODEL_PREPARATION');
  let artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},input.artworkId,true);
  if(preparation){
   // Match CMS approval/revision serialization; retain this row lock through
   // idempotent replay or new-job insertion in the caller's transaction.
   await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,input.artworkId]);
   artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},input.artworkId,true);
  }
  if(preparation){
   if(input.mime!=='model/gltf-binary'||input.derived!==undefined||input.modelDerivation!==undefined||input.coarsePreparation!==undefined||preparation.operationID!==input.idempotencyKey)throw new ApiError(400,'INVALID_MODEL_PREPARATION');
   if(large)await this.largeModelReady(c,s);else await this.requiredModelReady(c,s);
  }
  const reference=artwork.metadata?.displayReference;
  if(reference&&!preparation&&!input.coarsePreparation&&(input.mime!=='model/gltf-binary'||input.sha256!==reference.assetSha256||input.scaleMeters!==1||input.derived!==undefined||input.modelDerivation!==undefined))throw new ApiError(409,'PROVISIONAL_ASSET_MISMATCH');
  const model=modelDerivationInput(input.modelDerivation);
  if(model&&(input.mime!=='model/gltf-binary'||input.derived!==undefined||model.operationID!==input.idempotencyKey))throw new ApiError(400,'INVALID_MODEL_DERIVATION');
  if(model&&artwork.revision!==model.artworkRevision)throw new ApiError(409,'REVISION_CONFLICT');
  const derived=preparedImageInput(input.derived);
  const coarse=imageCoarseIntent(input.coarsePreparation);
  const coarseWorkspace=coarse?await this.coarseOwner(c,s.tenantId,s.userId):undefined;
  if(coarse&&(input.mime!=='image/jpeg'||!derived||model||input.scaleMeters!==1))throw new ApiError(400,'COARSE_INTENT_INVALID');
  if((input.mime==='image/jpeg')!==(derived!==undefined))throw new ApiError(400,'INVALID_DERIVED_INPUT');
  if(!['model/gltf-binary','image/png','image/jpeg'].includes(input.mime)||!Number.isInteger(input.bytes)||input.bytes<1||input.bytes>(large?LARGE_MODEL_RECIPE.limits.sourceBytes:MAX_UPLOAD)||!Number.isFinite(input.scaleMeters)||input.scaleMeters<=0||input.scaleMeters>1000000||!/^[0-9a-f]{64}$/.test(input.sha256)||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<1||input.idempotencyKey.length>128)throw new ApiError(400,'INVALID_INPUT');
  if(!validRights(input.rights))throw new ApiError(400,'INVALID_RIGHTS');
  // Rights object order is normalized for semantic replay equality.
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  const hash=createHash('sha256').update(JSON.stringify(canonical(coarse?{...input,coarsePreparation:coarse}:input))).digest('hex');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
  const prior=await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey]);
  if(prior.rowCount){if(preparation&&prior.rows[0].user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');if(coarse){const old=storedImageCoarse(prior.rows[0]);if(prior.rows[0].user_id!==s.userId||!old||old.workspaceId!==coarseWorkspace?.workspaceId||old.principalId!==s.userId)throw new ApiError(403,'FORBIDDEN');}if(prior.rows[0].request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');if(preparation&&prior.rows[0].state==='approved')await assertModelPreparationContext(c,prior.rows[0]);return this.view(prior.rows[0]);}
  if(preparation){
   if(artwork.revision!==preparation.artworkRevision||!isDeepStrictEqual(artwork.metadata?.rights,input.rights)||!allowedRights(input.rights,'display'))throw new ApiError(409,'MODEL_PREPARATION_CONTEXT_CHANGED');
   if(reference&&(artwork.metadata?.provenance?.sourceUnits!=='unknown'||artwork.metadata?.provenance?.scaleApplied!==false||reference.assetSha256!==input.sha256||input.scaleMeters!==1))throw new ApiError(409,'PROVISIONAL_ASSET_MISMATCH');
   if(artwork.approved_revision===artwork.revision)throw new ApiError(409,'MODEL_PREPARATION_REVISION_APPROVED');
   // This exact input remains bound to the existing dedicated Hayes route.
   if(input.sha256==='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6'&&input.bytes===8383096)throw new ApiError(409,'MODEL_PREPARATION_DEDICATED_ROUTE_REQUIRED');
   await assertModelPreparationSlot(c,s.tenantId,input.artworkId,preparation.artworkRevision);
  }
  if(coarse&&derived){if(reference)throw new ApiError(409,'PROVISIONAL_ASSET_MISMATCH');if(artwork.revision!==coarse.artworkRevision)throw new ApiError(409,'REVISION_CONFLICT');imageCoarsePolicy(coarse,input.sha256,derived.sha256,derived.bytes,derived.recipe);if(!allowedRights(input.rights,'display')||!allowedRights(input.rights,'export')||!isDeepStrictEqual(input.rights,artwork.metadata?.rights))throw new ApiError(403,'RIGHTS_DENIED');}
  const id=randomUUID(),key=`${s.tenantId}/quarantine/import-${id}/${input.sha256}`,target=`${s.tenantId}/approved/${derived?.sha256??input.sha256}`,preparedKey=derived?`${s.tenantId}/quarantine/import-${id}/prepared-${derived.sha256}`:null;
  const approvedCoarse=coarse&&derived?imageCoarsePolicy(coarse,input.sha256,derived.sha256,derived.bytes,derived.recipe).coarse:undefined;
  const storedDerived=derived&&coarse&&approvedCoarse&&coarseWorkspace?{...derived,viewerCoarse:{intent:coarse,workspaceId:coarseWorkspace.workspaceId,principalId:s.userId,stageKey:`${s.tenantId}/quarantine/import-${id}/coarse-${approvedCoarse.sha256}`,sha256:approvedCoarse.sha256,bytes:approvedCoarse.bytes}}:derived;
  const row=await c.query('INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key,model_derivation,png_drain_version'+(preparation?',model_preparation':'')+') VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17'+(preparation?',$18':'')+') RETURNING *',[s.tenantId,id,s.userId,input.artworkId,input.idempotencyKey,hash,input.mime,input.sha256,input.bytes,input.rights,key,target,input.scaleMeters,storedDerived??null,preparedKey,model?{kind:'model-texture-pair',request:model}:null,input.mime==='image/png'||coarse||preparation?1:0,...(preparation?[{kind:'required-model-compact',request:{...preparation,...(reference?{sourceDisplayReference:structuredClone(reference)}:{})}}]:[])]);
  return this.view(row.rows[0]);
 }
 model(row:Record<string,unknown>){
  const value=row.model_derivation as {kind?:unknown;request?:unknown;result?:unknown}|null;
  if(!value||value.kind!=='model-texture-pair')return undefined;
  if(row.mime!=='model/gltf-binary'||Object.keys(value).some(k=>!['kind','request','result'].includes(k)))throw new ApiError(422,'FORMAT_REJECTED');
  return modelDerivationInput(value.request);
 }
 view(row:Record<string,unknown>){
  const coarse=storedImageCoarse(row),preparation=modelPreparationView(row);
  const model=this.model(row),result=(row.model_derivation as {result?:Record<string,unknown>}|null)?.result;
  const recipe=(row.derived as {recipe?:{colourConversion?:unknown}}|null)?.recipe;
  const imagePreparation=!model&&row.mime==='image/jpeg'&&recipe&&Object.hasOwn(recipe,'colourConversion')?this.prepared(row):undefined;
  return {id:row.id,state:row.state,progress:row.progress,attempts:row.attempts,errorCode:row.error_code,assetId:!preparation||preparation.status==='ready'?row.asset_id:undefined,retryAt:row.available_at,
   ...(preparation?{modelPreparation:preparation}:{}),
   ...(imagePreparation?{imagePreparation:{provenance:'client-declared' as const,originalSha256:row.expected_hash,derivedSha256:imagePreparation.sha256,recipe:imagePreparation.recipe}}:{}),
   ...(coarse?{coarsePreparation:{profile:coarse.intent.profile,approvalId:coarse.intent.approvalId,artworkRevision:coarse.intent.artworkRevision,status:row.state==='approved'&&coarse.assetId?'ready':['failed','cancelled'].includes(String(row.state))?'failed':'pending',...(coarse.assetId?{assetId:coarse.assetId,sha256:coarse.sha256,bytes:coarse.bytes}:{}),workerDrained:row.png_drain_version===1&&row.lease_id==null&&Array.isArray(row.png_worker_tokens)&&row.png_worker_tokens.length===0&&['approved','failed','cancelled'].includes(String(row.state))}}:{}),
   ...(row.mime==='image/png'?{workerDrainVersion:row.png_drain_version===1?1:0,workerDrained:row.png_drain_version===1&&row.lease_id==null&&Array.isArray(row.png_worker_tokens)&&row.png_worker_tokens.length===0&&['approved','failed','cancelled'].includes(String(row.state))}:{}),
   ...(model?{modelDerivation:{...(result??{}),operationID:model.operationID,generation:model.generation,profileId:model.profileId,status:result?.status??(['failed','cancelled'].includes(String(row.state))?'failed':'pending'),workerDrained:row.lease_id==null}}:row.derived==null?{}:{originalAssetId:row.original_asset_id})};
 }
 prepared(row:Record<string,unknown>){if(this.model(row))return undefined;const state=storedImageCoarse(row),raw=row.derived as Record<string,unknown>|null;const input=state&&raw?Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='viewerCoarse')):raw;const derived=preparedImageInput(input??undefined);if((row.mime==='image/jpeg')!==(derived!==undefined))throw new ApiError(422,'FORMAT_REJECTED');return derived;}
 async preparedBytes(row:Record<string,unknown>,derived:PreparedImage){
  let bytes:Buffer;try{const coarse=storedImageCoarse(row);bytes=Buffer.from(coarse?await this.boundedBlob(String(row.derived_object_key),derived.bytes):await this.blobs.get(String(row.derived_object_key)));}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}
  if(bytes.length!==derived.bytes||sha256(bytes)!==derived.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');return bytes;
 }
 async uploadDerived(c:PoolClient,s:Session,id:string,bytes:Buffer){
  const row=await this.access(c,s,id),derived=this.prepared(row);if(!derived||row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  if(bytes.length!==derived.bytes||sha256(bytes)!==derived.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
  await this.blobs.put(row.derived_object_key,bytes);return {received:bytes.length};
 }
 async upload(c:PoolClient,s:Session,id:string,bytes:Buffer,large=false){
  const row=await this.access(c,s,id);if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  if((storedModelPreparation(row)?.profileId===LARGE_MODEL_RECIPE.id)!==large)throw new ApiError(409,'MODEL_PREPARATION_PROFILE_MISMATCH');
  if(large)await this.largeModelReady(c,s);
  if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
  await this.blobs.put(row.object_key,bytes);return {received:bytes.length};
 }
 async complete(c:PoolClient,s:Session,id:string){
  const row=await this.access(c,s,id);if(['queued','processing','approved'].includes(row.state))return this.view(row);
  if(row.state!=='uploading')throw new ApiError(409,'JOB_STATE');
  const large=storedModelPreparation(row)?.profileId===LARGE_MODEL_RECIPE.id;
  if(large)await this.largeModelReady(c,s);
  let bytes:Buffer;try{bytes=Buffer.from(large?await this.boundedBlob(row.object_key,Number(row.expected_bytes)):await this.blobs.get(row.object_key));}catch{throw new ApiError(409,'UPLOAD_INCOMPLETE');}
  if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
  const derived=this.prepared(row);if(derived)await this.preparedBytes(row,derived);
  const result=await c.query("UPDATE import_jobs SET state='queued',progress=10,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[s.tenantId,id]);return this.view(result.rows[0]);
 }
 async action(c:PoolClient,s:Session,id:string,action:'cancel'|'retry'){
  if(action==='retry'){
   const peek=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0];
   if(peek&&storedModelPreparation(peek)){await artworkAccess(c,s,peek.artwork_id,true);await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,peek.artwork_id]);}
  }
  const row=await this.access(c,s,id);
  if(action==='cancel'){
   if(row.hayes_attempt_id!=null){await c.query("UPDATE import_jobs SET state='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing'",[s.tenantId,id]);return this.view((await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]);}
   if(row.state==='approved')throw new ApiError(409,'JOB_STATE');
   if((this.model(row)||row.png_drain_version===1)&&row.lease_id!=null)await c.query("UPDATE import_jobs SET state='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
   else await c.query("UPDATE import_jobs SET state='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
  }else{
   if(row.hayes_attempt_id!=null)throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');
   const required=storedModelPreparation(row);if(required){await assertModelPreparationContext(c,row);await assertModelPreparationSlot(c,s.tenantId,String(row.artwork_id),required.artworkRevision,id);}
   const model=this.model(row),value=row.model_derivation as {result?:Record<string,unknown>}|null;
   const optionalRetry=!!model&&row.state==='approved'&&row.asset_id!=null&&value?.result?.status==='failed'&&row.lease_id==null;
   if(!optionalRetry&&row.state!=='failed'||row.attempts>=5||new Date(row.available_at).getTime()>Date.now())throw new ApiError(409,'JOB_STATE');
   if(row.png_drain_version===1&&(row.lease_id!=null||!Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length!==0))throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');
   if(model){const result={...(value?.result??{}),status:'pending'} as Record<string,unknown>;delete result.errorCode;await c.query('UPDATE import_jobs SET model_derivation=$3 WHERE tenant_id=$1 AND id=$2',[s.tenantId,id,{kind:'model-texture-pair',request:model,result}]);}
   await c.query("UPDATE import_jobs SET state='queued',error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
  }
  return this.view((await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]);
 }
 async work(hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>}){
  const lease=randomUUID();
  const row=await transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
   // The current ordinary catalog has no 042 column; discover this one
   // optional catalog before issuing SQL that references it.
   const feature=await c.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='import_jobs'::regclass AND attname='hayes_attempt_id' AND NOT attisdropped) AS selected, EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='import_jobs'::regclass AND attname='model_preparation' AND NOT attisdropped) AS model_selected");
   const modelFilter=feature.rows[0]?.model_selected===true&&!this.modelExecution?.isActive()?' AND model_preparation IS NULL':'';
   const hayesFilter=feature.rows[0]?.selected===true?" AND hayes_attempt_id IS NULL AND NOT (state='queued' AND mime='model/gltf-binary' AND expected_hash='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6' AND expected_bytes=8383096)":'';
   await c.query("UPDATE import_jobs SET state='failed',error_code='RETRY_EXHAUSTED',lease_id=NULL,lease_until=NULL WHERE state='processing' AND lease_until<clock_timestamp() AND attempts>=5 AND NOT (png_drain_version=1 AND cardinality(png_worker_tokens)>0)"+hayesFilter+modelFilter);
   const found=await c.query("SELECT * FROM import_jobs WHERE (state='queued' AND available_at<=now() OR state='processing' AND lease_until<clock_timestamp()) AND attempts<5 AND NOT (png_drain_version=1 AND cardinality(png_worker_tokens)>0)"+hayesFilter+modelFilter+" ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1");
   if(!found.rowCount)return null;const r=found.rows[0];
   if(storedModelPreparation(r)){await this.requiredModelReady(c,{tenantId:r.tenant_id,userId:r.user_id});const writer=this.modelExecution?.writer;if(writer){const value={...r.model_preparation,claim:{token:lease,...writer.identity}};await c.query('UPDATE import_jobs SET model_preparation=$3 WHERE tenant_id=$1 AND id=$2',[r.tenant_id,r.id,value]);r.model_preparation=value;}}
   await c.query("UPDATE import_jobs SET state='processing',progress=25,attempts=attempts+1,lease_id=$3,lease_until=clock_timestamp()+interval '30 seconds',png_worker_tokens=CASE WHEN png_drain_version=1 THEN array_append(png_worker_tokens,$3::uuid) ELSE png_worker_tokens END,updated_at=now() WHERE tenant_id=$1 AND id=$2",[r.tenant_id,r.id,lease]);return r;
  });if(!row)return false;
  try{
   if(storedModelPreparation(row)){await workRequiredModelPreparation(this.pool,this.blobs,row,lease,hooks,this.modelExecution?.writer,this.nativeWorkspace);return true;}
   const coarse=storedImageCoarse(row);if(coarse&&!this.blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
   const bytes=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return Buffer.from(coarse?await this.boundedBlob(String(row.object_key),Number(row.expected_bytes)):await this.blobs.get(row.object_key));});if(bytes.length!==row.expected_bytes||sha256(bytes)!==row.expected_hash)throw new ApiError(422,'UPLOAD_INTEGRITY');
   const derived=this.prepared(row);let display:Buffer=bytes;
   if(derived){
    // Bounded private original custody, not server JPEG codec or pixel-equivalence certification.
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw new ApiError(422,'FORMAT_REJECTED');
    display=await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');return this.preparedBytes(row,derived);});preparedImageHeader(display);
   }
   await decode(display,derived?'image/png':row.mime,{classifyPngPixelLimit:row.mime==='image/png'&&!derived});
   let preparedCoarse:Awaited<ReturnType<typeof prepareIntentImageCoarse>>|undefined;
   if(coarse){await transaction(this.pool,async c=>this.coarseOwner(c,String(row.tenant_id),String(row.user_id),coarse.workspaceId));preparedCoarse=await prepareIntentImageCoarse(coarse.intent,String(row.expected_hash),display);const readyCoarse=preparedCoarse;await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');const live=await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease]);if(!live.rowCount||!isDeepStrictEqual(storedImageCoarse(live.rows[0]),coarse))throw new ApiError(409,'COARSE_SOURCE_CHANGED');await this.coarseOwner(c,String(row.tenant_id),String(row.user_id),coarse.workspaceId);await this.blobs.put(coarse.stageKey,readyCoarse.bytes);const staged=Buffer.from(await this.boundedBlob(coarse.stageKey,coarse.bytes));if(staged.length!==coarse.bytes||sha256(staged)!==coarse.sha256)throw new ApiError(409,'ASSET_INTEGRITY');});}
   const model=this.model(row);let pair:ModelPairResult|undefined;
   if(model){try{pair=await prepareModelPair(display,model);}catch{/* Preserve a successfully decoded original without registering a partial derivative. */}}
   await hooks?.beforeCommit?.();
   await transaction(this.pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const current=await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[row.tenant_id,row.id,lease]);if(!current.rowCount)return;
    // Recheck current membership and ownership, including revocation during decoding.
    const artwork=await artworkAccess(c,{tenantId:row.tenant_id,userId:row.user_id},row.artwork_id,true);
    if(model&&artwork.revision!==model.artworkRevision)throw new ApiError(409,'REVISION_CONFLICT');
    if(coarse)await this.coarseOwner(c,String(row.tenant_id),String(row.user_id),coarse.workspaceId);
    if(coarse&&(!preparedCoarse||!isDeepStrictEqual(storedImageCoarse(current.rows[0]),coarse)||artwork.revision!==coarse.intent.artworkRevision||!isDeepStrictEqual(artwork.metadata?.rights,row.rights)||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export')))throw new ApiError(409,'COARSE_SOURCE_CHANGED');
    const existing=model&&row.asset_id?(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[row.tenant_id,row.artwork_id,row.asset_id])).rows[0]:undefined;
    if(model&&row.asset_id){
     if(!existing||existing.mime!=='model/gltf-binary'||existing.sha256!==row.expected_hash||Number(existing.bytes)!==row.expected_bytes||existing.object_key!==row.approved_key||!isDeepStrictEqual(existing.rights,row.rights)||!allowedRights(existing.rights,'display'))throw new ApiError(403,'RIGHTS_DENIED');
     if(!Buffer.from(await this.blobs.get(existing.object_key)).equals(display))throw new ApiError(409,'ASSET_INTEGRITY');
    }else await this.blobs.put(row.approved_key,display);
    await hooks?.afterCopy?.();
    const deadline=await c.query('SELECT lease_until>clock_timestamp() AS valid FROM import_jobs WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id]);if(!deadline.rows[0]?.valid)throw new ApiError(409,'LEASE_EXPIRED');
    const asset=existing?.id??randomUUID(),rights=existing?.rights_id??randomUUID();if(!existing)await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rights,row.rights]);
    let originalAsset:string|null=null;
    if(derived){
     originalAsset=randomUUID();
     await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'quarantine')",[row.tenant_id,originalAsset,row.artwork_id,rights,row.object_key,row.expected_hash,row.expected_bytes,row.mime,row.scale_meters]);
    }
    if(!existing)await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'approved')",[row.tenant_id,asset,row.artwork_id,rights,row.approved_key,derived?.sha256??row.expected_hash,derived?.bytes??row.expected_bytes,derived?'image/png':row.mime,row.scale_meters]);
    if(derived)await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),originalAsset,{version:1,kind:'image-preparation',originalAssetId:originalAsset,derivedAssetId:asset,original:{mime:row.mime,sha256:row.expected_hash,bytes:row.expected_bytes},derived:{mime:derived.mime,sha256:derived.sha256,bytes:derived.bytes},recipe:derived.recipe,provenance:'client-declared'}]);
    if(coarse&&preparedCoarse){
     const staged=Buffer.from(await this.boundedBlob(coarse.stageKey,coarse.bytes));if(staged.length!==coarse.bytes||sha256(staged)!==coarse.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
     const coarseAsset=randomUUID();
     await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'image/png',1,'approved')",[row.tenant_id,coarseAsset,row.artwork_id,rights,coarse.stageKey,coarse.sha256,coarse.bytes]);
     await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),asset,{version:1,kind:'viewer-image-coarse',sourceJobId:row.id,primaryAssetId:asset,primarySha256:derived!.sha256,coarseAssetId:coarseAsset,objectKey:coarse.stageKey,sha256:coarse.sha256,bytes:coarse.bytes,width:preparedCoarse.width,height:preparedCoarse.height,profile:preparedCoarse.profile,provenance:'server-generated'}]);
     await c.query('UPDATE import_jobs SET derived=$3 WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.id,{...(row.derived as Record<string,unknown>),viewerCoarse:{...coarse,assetId:coarseAsset}}]);
    }
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
    if(coarse){const approved=await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$5 AND lease_until>clock_timestamp() AND $5::uuid=ANY(png_worker_tokens) RETURNING id",[row.tenant_id,row.id,asset,originalAsset,lease]);if(!approved.rowCount)throw new ApiError(409,'LEASE_EXPIRED');}
    else await c.query("UPDATE import_jobs SET state='approved',asset_id=$3,original_asset_id=$4,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,asset,originalAsset]);
   });
  }catch(error){
   const code=error instanceof ApiError?error.code:'WORKER_FAILED';
   await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await c.query("UPDATE import_jobs SET state='failed',error_code=$4,lease_id=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(60,power(2,attempts)::int)),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3",[row.tenant_id,row.id,lease,code]);});
  }finally{
   // Only the actual completed worker/decoder call reaches this owner cleanup.
   // A cancellation response keeps this lease until close; timeout is not drain.
   if(this.model(row)||row.png_drain_version===1)await transaction(this.pool,async c=>{await c.query("UPDATE import_jobs SET lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND state='cancelled' AND lease_id=$3",[row.tenant_id,row.id,lease]);});
   if(row.png_drain_version===1)await transaction(this.pool,async c=>{await c.query("UPDATE import_jobs SET png_worker_tokens=array_remove(png_worker_tokens,$3::uuid) WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,lease]);});
  }return true;
 }
}
