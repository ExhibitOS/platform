// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {lstat,realpath,mkdir,mkdtemp,rmdir} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {artworkAccess,transaction,sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session,uuid} from './auth.ts';
import {allowedRights} from './rights.ts';
import {assertModelPreparationExecution,type ModelPreparationExecution} from './model-preparation-import.ts';
import {parseGpuModelPreparationInput,bindGpuModelPreparationIntent} from './gpu-model-preparation-contract.ts';
import {storedGpuModelPreparation,gpuModelDigest,gpuModelJobView,gpuModelReceipt,gpuModelPreparationDrained,createGpuModelReceipt} from './gpu-model-preparation-state.ts';
import {parseGpuModelSource} from './gpu-source-preservation.ts';
import {assertGpuModelOutputCapacity,assembleGpuModelDerivative} from './gpu-model-producer.ts';
import {assertGpuModelEncoderReady,encodeGpuModelBaseColor,GpuModelEncoderError} from './gpu-model-encoder.ts';
import {revisionIdentity,type Cms} from './cms.ts';

export const GPU_MODEL_MIGRATION='049_gpu_model_preparation.sql';
// Set to the exact optional migration bytes, independently checked by tests.
export const GPU_MODEL_MIGRATION_SHA256='d525cb7f8d5040330aa7ccc3afd5d8a7878fd8612eae80a6613517510e546790';
const unavailable=()=>new ApiError(503,'GPU_MODEL_PREPARATION_UNAVAILABLE');
const changed=()=>new ApiError(409,'GPU_MODEL_PREPARATION_CONTEXT_CHANGED');
type Actor=Pick<Session,'tenantId'|'userId'>;
type Row=Record<string,unknown>;
/** Reuses ordinary import rows, leases, worker drain tokens and immutable asset
 * storage. Construction is internal; no HTTP request supplies paths or tools. */
export class GpuModelPreparations {
 private readonly controllers=new Map<string,AbortController>();
 private readonly running=new Set<Promise<boolean>>();
 private closing=false;
 private readonly pool:Pool;private readonly base:ModelPreparationExecution;private readonly managedPrefix:string;private readonly jobRoot:string;
 constructor(pool:Pool,base:ModelPreparationExecution,managedPrefix:string,jobRoot:string){
  this.pool=pool;this.base=base;this.managedPrefix=managedPrefix;this.jobRoot=jobRoot;
  assertModelPreparationExecution(base,base.blobs,base.workspace);
  if(![managedPrefix,jobRoot].every(p=>isAbsolute(p)&&resolve(p)===p)||managedPrefix===jobRoot)throw unavailable();
 }
 matches(pool:Pool,blobs:BlobStore,workspace:unknown){return this.pool===pool&&this.base.blobs===blobs&&this.base.workspace===workspace;}
 async supported(c:PoolClient){
  const r=await c.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='import_jobs'::regclass AND attname='gpu_preparation' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='import_jobs'::regclass AND conname='import_gpu_preparation_shape') AND EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1 AND sha256=$2) AS supported",[GPU_MODEL_MIGRATION,GPU_MODEL_MIGRATION_SHA256]);return r.rows[0]?.supported===true;
 }
 async ready(c:PoolClient,s:Actor){
  if(this.closing||!this.base.isActive()||!this.base.blobs.getBounded||!this.base.blobs.putDurable||!await this.supported(c))throw unavailable();
  await this.base.assertReady(c,s);await assertGpuModelEncoderReady(this.managedPrefix);
  try{const stat=await lstat(this.jobRoot);if(await realpath(this.jobRoot)!==this.jobRoot||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)throw unavailable();}catch{throw unavailable();}
 }
 async has(c:PoolClient,s:Actor,id:string){
  if(!await this.supported(c))return false;
  const r=await c.query('SELECT gpu_preparation IS NOT NULL AS selected FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id]);return r.rows[0]?.selected===true;
 }
 /** Current source grant and immutable approval remain independent of bytes. */
 async context(c:PoolClient,row:Row){
  const value=storedGpuModelPreparation(row);if(!value)throw changed();const {intent}=value,r=intent.request,s={tenantId:intent.binding.tenantId,userId:intent.binding.principalId};
  await this.base.assertReady(c,s);const artwork=await artworkAccess(c,s,intent.binding.artworkId,true);
  const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,intent.binding.artworkId,r.revision])).rows[0]?.snapshot;
  if(!approval||gpuModelDigest(approval)!==intent.binding.approvalSHA256||approval.asset?.id!==r.assetId||approval.asset?.sha256!==r.sha256||Number(approval.asset?.bytes)!==r.bytes||approval.asset?.mime!=='model/gltf-binary'||!isDeepStrictEqual(artwork.metadata?.rights,row.rights)||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw changed();
  if(artwork.revision!==r.revision||artwork.approved_revision!==r.revision||artwork.approved_asset_id!==r.assetId){
   if(row.state!=='approved'||artwork.revision!==r.revision+1||artwork.approved_revision!==artwork.revision||artwork.approved_asset_id!==r.assetId)throw changed();
   const selected=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,intent.binding.artworkId,artwork.revision])).rows[0]?.snapshot?.gpuVariant;
   if(!isDeepStrictEqual(selected,gpuModelReceipt(row)))throw changed();
  }
  const asset=(await c.query("SELECT a.*,r.metadata AS current_rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,intent.binding.artworkId,r.assetId])).rows[0];
  if(!asset||asset.object_key!==row.object_key||asset.mime!=='model/gltf-binary'||asset.sha256!==r.sha256||Number(asset.bytes)!==r.bytes||Number(asset.scale_meters)!==Number(row.scale_meters)||!isDeepStrictEqual(asset.current_rights,row.rights))throw changed();
  return {artwork,approval,asset,intent};
 }
 private async owned(c:PoolClient,s:Actor,id:string){
  uuid(id);const row=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,id])).rows[0];
  if(!row||row.tenant_id!==s.tenantId||row.user_id!==s.userId||!storedGpuModelPreparation(row))throw new ApiError(403,'FORBIDDEN');
  return row;
 }
 async access(c:PoolClient,s:Actor,id:string){
  const row=await this.owned(c,s,id);
  await this.ready(c,s);await this.context(c,row);if(row.state==='approved')await this.candidate(c,row);return row;
 }
 view(row:Row){return gpuModelJobView(row);}
 async create(c:PoolClient,s:Actor,artworkId:string,body:unknown){
  uuid(artworkId);artworkId=artworkId.toLowerCase();const request=parseGpuModelPreparationInput(body);
  await this.base.assertReady(c,s);await assertGpuModelEncoderReady(this.managedPrefix);
  try{await mkdir(this.jobRoot,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw unavailable();}
  await this.ready(c,s);await artworkAccess(c,s,artworkId,true);
  await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,artworkId]);
  const requestHash=gpuModelDigest({purpose:'approved-display-gpu-derivative',artworkId,...request});
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${request.idempotencyKey}`]);
  const prior=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,request.idempotencyKey])).rows[0];
  if(prior){if(prior.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');if(prior.request_hash!==requestHash||prior.gpu_preparation==null)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return this.view(await this.access(c,s,String(prior.id)));}
  const artwork=await artworkAccess(c,s,artworkId,true);
  if(artwork.revision!==request.revision||artwork.approved_revision!==request.revision||artwork.approved_asset_id!==request.assetId||!allowedRights(artwork.metadata?.rights,'display')||!allowedRights(artwork.metadata?.rights,'export'))throw changed();
  const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,request.revision])).rows[0]?.snapshot;
  if(!approval||approval.asset?.id!==request.assetId||approval.asset?.sha256!==request.sha256||Number(approval.asset?.bytes)!==request.bytes||approval.asset?.mime!=='model/gltf-binary')throw changed();
  const source=(await c.query("SELECT a.*,r.metadata AS current_rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,artworkId,request.assetId])).rows[0];
  if(!source||source.sha256!==request.sha256||Number(source.bytes)!==request.bytes||source.mime!=='model/gltf-binary'||!isDeepStrictEqual(source.current_rights,artwork.metadata.rights))throw changed();
  await this.slot(c,s.tenantId,artworkId,request.revision);
  const intent=bindGpuModelPreparationIntent(request,{tenantId:s.tenantId,principalId:s.userId,artworkId,approvalSHA256:gpuModelDigest(approval),rightsSHA256:gpuModelDigest(source.current_rights)}),id=randomUUID();
  const result=await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,scale_meters,rights,object_key,approved_key,state,progress,png_drain_version,png_worker_tokens,gpu_preparation) VALUES($1,$2,$3,$4,$5,$6,'model/gltf-binary',$7,$8,$9,$10,$11,$12,'queued',10,1,'{}',$13) RETURNING *",[s.tenantId,id,s.userId,artworkId,request.idempotencyKey,requestHash,request.sha256,request.bytes,source.scale_meters,source.current_rights,source.object_key,`${s.tenantId}/quarantine/gpu-${id}`,{kind:'gpu-model-preparation',intent}]);
  return this.view(result.rows[0]);
 }
 private async slot(c:PoolClient,tenantId:string,artworkId:string,revision:number,except?:string){
  const result=await c.query("SELECT id FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND gpu_preparation->'intent'->'request'->>'revision'=$3 AND ($4::uuid IS NULL OR id<>$4) AND (state NOT IN ('failed','cancelled') OR lease_id IS NOT NULL OR cardinality(png_worker_tokens)>0) LIMIT 1",[tenantId,artworkId,String(revision),except??null]);if(result.rowCount)throw new ApiError(409,'GPU_MODEL_PREPARATION_ACTIVE_IMPORT');
 }
 async candidate(c:PoolClient,row:Row){
  const receipt=gpuModelReceipt(row),s=storedGpuModelPreparation(row)!.intent.binding;
  const asset=(await c.query("SELECT a.*,r.metadata AS current_rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,s.artworkId,receipt.candidate.assetId])).rows[0];
  if(!asset||asset.object_key!==row.approved_key||asset.sha256!==receipt.candidate.sha256||Number(asset.bytes)!==receipt.candidate.bytes||asset.mime!==receipt.candidate.mime||Number(asset.scale_meters)!==Number(row.scale_meters)||!isDeepStrictEqual(asset.current_rights,row.rights))throw changed();
  const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='approved-display-gpu-derivative' AND metadata->'serverReceipt'->>'jobId'=$3 AND deleted_at IS NULL",[s.tenantId,receipt.source.assetId,row.id])).rows;
  if(lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:'approved-display-gpu-derivative',serverReceipt:receipt,provenance:'server-generated'}))throw changed();
  const bytes=Buffer.from(await this.base.blobs.getBounded!(String(row.approved_key),receipt.candidate.bytes)),source=Buffer.from(await this.base.blobs.getBounded!(String(row.object_key),receipt.source.bytes));
  if(bytes.length!==receipt.candidate.bytes||sha256(bytes)!==receipt.candidate.sha256||source.length!==receipt.source.bytes||sha256(source)!==receipt.source.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  try{
   const parsed=parseGpuModelSource(bytes,33554432),doc=parsed.doc as unknown as {images?:{bufferView?:number}[];bufferViews?:{byteOffset?:number;byteLength?:number}[]};
   const image=doc.images?.[receipt.producer.ktx.imageIndex],view=image?.bufferView===undefined?undefined:doc.bufferViews?.[image.bufferView];
   if(!view||!Number.isSafeInteger(view.byteOffset)||!Number.isSafeInteger(view.byteLength))throw Error();
   const reconstructed=assembleGpuModelDerivative(source,{sha256:receipt.source.sha256,bytes:receipt.source.bytes},parsed.bin.subarray(view.byteOffset!,view.byteOffset!+view.byteLength!));
   if(!reconstructed.bytes.equals(bytes)||!isDeepStrictEqual(reconstructed.producer,receipt.producer))throw Error();
  }catch{throw new ApiError(409,'ASSET_INTEGRITY');}
  return {receipt,bytes};
 }
 async action(c:PoolClient,s:Actor,id:string,action:'retry'|'cancel'){
  if(action==='retry'){
   const peek=(await c.query('SELECT artwork_id,user_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0];
   if(!peek||peek.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');await artworkAccess(c,s,peek.artwork_id,true);
   await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,peek.artwork_id]);
  }
  // Cancellation releases an owned invocation even if its source authority or
  // encoder readiness changed. It grants no candidate/read/approval authority.
  const row=action==='cancel'?await this.owned(c,s,id):await this.access(c,s,id),value=storedGpuModelPreparation(row)!;
  if(action==='cancel')await artworkAccess(c,s,String(row.artwork_id),true);
  if(action==='cancel'){
   if(row.state==='approved')throw new ApiError(409,'JOB_STATE');
   await c.query("UPDATE import_jobs SET state='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);this.controllers.get(id)?.abort();
  }else{
   if(row.state!=='failed'||!gpuModelPreparationDrained(row)||Number(row.attempts)>=5||new Date(String(row.available_at)).getTime()>Date.now())throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');
   await this.context(c,row);await this.slot(c,s.tenantId,value.intent.binding.artworkId,value.intent.request.revision,id);
   await c.query("UPDATE import_jobs SET state='queued',error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);
  }
  return this.view((await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]);
 }
 async selection(c:PoolClient,s:Actor,artworkId:string){
  uuid(artworkId);artworkId=artworkId.toLowerCase();const artwork=await artworkAccess(c,s,artworkId,true);
  if(artwork.revision!==artwork.approved_revision||!artwork.approved_asset_id)throw changed();
  const snapshot=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,artwork.revision])).rows[0]?.snapshot;
  if(!snapshot)throw changed();if(snapshot.gpuVariant===undefined)return {artworkId,revision:artwork.revision,selection:null};
  const claimed=snapshot.gpuVariant as {jobId?:unknown};if(!claimed||typeof claimed.jobId!=='string')throw changed();
  const row=await this.access(c,s,claimed.jobId),receipt=gpuModelReceipt(row);
  if(!gpuModelPreparationDrained(row)||!isDeepStrictEqual(snapshot.gpuVariant,receipt)||receipt.artworkId!==artworkId||artwork.approved_asset_id!==receipt.source.assetId||artwork.revision!==receipt.artworkRevision+1)throw changed();
  return {artworkId,revision:artwork.revision,selection:{version:1 as const,profile:receipt.profile,jobId:receipt.jobId,sourceAssetId:receipt.source.assetId,candidateAssetId:receipt.candidate.assetId,candidateSHA256:receipt.candidate.sha256,receiptSHA256:receipt.sha256,approvedRevision:artwork.revision}};
 }
 async review(c:PoolClient,s:Actor,artworkId:string,jobId:string){
  uuid(artworkId);artworkId=artworkId.toLowerCase();
  const row=await this.access(c,s,jobId);if(row.artwork_id!==artworkId||!gpuModelPreparationDrained(row)||row.state!=='approved')throw new ApiError(409,'GPU_MODEL_CANDIDATE_NOT_READY');
  const {receipt}=await this.candidate(c,row),selection=await this.selection(c,s,artworkId);
  return {artworkId,revision:selection.revision,jobId,receiptSHA256:receipt.sha256,source:receipt.source,candidate:receipt.candidate,serverReceipt:receipt,selection:selection.selection};
 }
 async reviewedBytes(c:PoolClient,s:Actor,artworkId:string,jobId:string,binding:{receiptSHA256:string;candidateSHA256:string}){
  uuid(artworkId);artworkId=artworkId.toLowerCase();
  const row=await this.access(c,s,jobId);if(row.artwork_id!==artworkId||row.state!=='approved'||!gpuModelPreparationDrained(row))throw new ApiError(409,'GPU_MODEL_CANDIDATE_NOT_READY');
  const result=await this.candidate(c,row);if(binding.receiptSHA256!==result.receipt.sha256||binding.candidateSHA256!==result.receipt.candidate.sha256)throw changed();return result;
 }
 /** Separate explicit approval. Primary source and scene placements are untouched. */
 async approve(c:PoolClient,s:Session,artworkId:string,body:unknown,cms:Cms){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype||Reflect.ownKeys(body).length!==5||!['revision','jobId','receiptSHA256','candidateSHA256','generation'].every(k=>{const d=Object.getOwnPropertyDescriptor(body,k);return d?.enumerable&&Object.hasOwn(d,'value');}))throw new ApiError(400,'INVALID_INPUT');
  const b=body as {revision:number;jobId:string;receiptSHA256:string;candidateSHA256:string;generation:string};
  if(!Number.isSafeInteger(b.revision)||b.revision<1||b.revision>=2147483647||![b.receiptSHA256,b.candidateSHA256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||typeof b.generation!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(b.generation))throw new ApiError(400,'INVALID_INPUT');uuid(b.jobId);uuid(artworkId);artworkId=artworkId.toLowerCase();
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await artworkAccess(c,s,artworkId,true);await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,artworkId]);
  const row=await this.access(c,s,b.jobId),intent=storedGpuModelPreparation(row)!.intent;
  if(row.artwork_id!==artworkId||intent.request.revision!==b.revision||intent.request.generation!==b.generation||row.state!=='approved'||!gpuModelPreparationDrained(row))throw changed();
  const {receipt}=await this.candidate(c,row);if(receipt.sha256!==b.receiptSHA256||receipt.candidate.sha256!==b.candidateSHA256)throw changed();
  const current=await this.selection(c,s,artworkId);
  if(current.selection?.jobId===b.jobId){if(current.revision!==b.revision+1||current.selection.receiptSHA256!==b.receiptSHA256||current.selection.candidateSHA256!==b.candidateSHA256)throw changed();return {artworkId,revision:current.revision,jobId:b.jobId,receiptSHA256:receipt.sha256,selection:current.selection};}
  const artwork=await cms.ownArtwork(c,s,artworkId);if(artwork.revision!==b.revision||artwork.approved_revision!==b.revision||artwork.approved_asset_id!==receipt.source.assetId)throw changed();
  const previous=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,b.revision])).rows[0]?.snapshot;if(!previous)throw changed();
  await cms.revise(c,s,artworkId,{...artwork.metadata,revision:b.revision});
  const revision=b.revision+1,snapshot=structuredClone(previous);snapshot.gpuVariant=receipt;
  const rights=(await c.query('SELECT r.revision FROM rights r JOIN assets a ON (a.tenant_id,a.rights_id)=(r.tenant_id,r.id) WHERE a.tenant_id=$1 AND a.id=$2',[s.tenantId,receipt.source.assetId])).rows[0];if(!rights)throw changed();snapshot.asset.rightsRevision=rights.revision;
  if(snapshot.importedArtwork){const imported=snapshot.importedArtwork;imported.revision=revision;imported.revisionId=revisionIdentity(s,artworkId,revision);imported.createdAt=new Date().toISOString();imported.extensions={...imported.extensions,'org.exhibitos.studio/cms':{tenantId:s.tenantId,artworkId,revision}};}
  await c.query('INSERT INTO artwork_approvals VALUES($1,$2,$3,$4,$5,now())',[s.tenantId,artworkId,revision,receipt.source.assetId,snapshot]);
  await c.query('UPDATE artworks SET approved_revision=$3,approved_asset_id=$4 WHERE tenant_id=$1 AND id=$2',[s.tenantId,artworkId,revision,receipt.source.assetId]);
  const selected=await this.selection(c,s,artworkId);return {artworkId,revision,jobId:b.jobId,receiptSHA256:receipt.sha256,selection:selected.selection};
 }
 work(hooks?:{beforeCommit?:()=>Promise<void>|void;afterCopy?:()=>Promise<void>|void}){
  const task=this.run(hooks);this.running.add(task);void task.finally(()=>this.running.delete(task)).catch(()=>{});return task;
 }
 async close(){this.closing=true;for(const controller of this.controllers.values())controller.abort();await Promise.allSettled([...this.running]);}
 private async run(hooks?:{beforeCommit?:()=>Promise<void>|void;afterCopy?:()=>Promise<void>|void}){
  if(this.closing||!this.base.isActive())return false;const lease=randomUUID();
  const row=await transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock_shared(82002)');if(!await this.supported(c))return null;
   const r=(await c.query("SELECT * FROM import_jobs WHERE gpu_preparation IS NOT NULL AND (state='queued' AND available_at<=now() OR state='processing' AND lease_until<clock_timestamp()) AND attempts<5 AND cardinality(png_worker_tokens)=0 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!r)return null;
   const value=storedGpuModelPreparation(r)!;await this.ready(c,{tenantId:String(r.tenant_id),userId:String(r.user_id)});
   const claimed={...value,claim:{token:lease,...(this.base.writer?.identity??{mode:'service'})}};
   return (await c.query("UPDATE import_jobs SET state='processing',progress=25,attempts=attempts+1,lease_id=$3,lease_until=clock_timestamp()+interval '30 seconds',png_worker_tokens=array_append(png_worker_tokens,$3::uuid),gpu_preparation=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[r.tenant_id,r.id,lease,claimed])).rows[0];
  });if(!row)return false;
  const controller=new AbortController();this.controllers.set(String(row.id),controller);
  const assertActive=()=>{if(this.closing||!this.base.isActive())controller.abort();controller.signal.throwIfAborted();};
  // close() can begin while the claim transaction is awaiting COMMIT.
  if(this.closing||!this.base.isActive())controller.abort();
  let directory:string|undefined,spawned=false,drained=true,cleanup=true;
  const active=setInterval(()=>{if(!this.base.isActive()||this.closing)controller.abort();},250);active.unref();
  try{
   const check=async()=>{assertActive();await transaction(this.pool,async c=>{
    const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];
    if(!live||!isDeepStrictEqual(live.gpu_preparation,row.gpu_preparation))throw changed();await this.context(c,live);
   });assertActive();};
   await check();const source=Buffer.from(await this.base.blobs.getBounded!(String(row.object_key),Number(row.expected_bytes))),identity={sha256:String(row.expected_hash),bytes:Number(row.expected_bytes)},inspection=assertGpuModelOutputCapacity(source,identity);
   directory=await mkdtemp(join(this.jobRoot,`${row.id}-${lease}-`));
   const encoded=await encodeGpuModelBaseColor(inspection.colourPNG,{managedPrefix:this.managedPrefix,jobDirectory:directory,signal:controller.signal,writerFd:this.base.writer?.writerFd,assertCurrent:check,onSpawn:()=>{spawned=true;drained=false;}});drained=encoded.workerDrained;
   const output=assembleGpuModelDerivative(source,identity,encoded.ktx);await hooks?.beforeCommit?.();
   await transaction(this.pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[row.tenant_id,row.artwork_id]);
    const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];
    if(!live||!isDeepStrictEqual(live.gpu_preparation,row.gpu_preparation))throw changed();await this.context(c,live);assertActive();
    const assetId=randomUUID(),rightsId=randomUUID(),key=`${row.tenant_id}/approved/${sha256(output.bytes)}`;
    const receipt=createGpuModelReceipt(live,{assetId,mime:'model/gltf-binary',sha256:sha256(output.bytes),bytes:output.bytes.length},output.producer);
    await this.base.blobs.putDurable!(key,output.bytes);const stored=Buffer.from(await this.base.blobs.getBounded!(key,output.bytes.length));if(!stored.equals(output.bytes))throw new ApiError(409,'ASSET_INTEGRITY');await hooks?.afterCopy?.();
    await this.context(c,live);assertActive();
    if(!(await c.query('SELECT lease_until>clock_timestamp() AS live FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND lease_id=$3',[row.tenant_id,row.id,lease])).rows[0]?.live)throw changed();
    await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[row.tenant_id,rightsId,row.rights]);
    await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',$8,'approved')",[row.tenant_id,assetId,row.artwork_id,rightsId,key,receipt.candidate.sha256,receipt.candidate.bytes,row.scale_meters]);
    await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),receipt.source.assetId,{version:1,kind:'approved-display-gpu-derivative',serverReceipt:receipt,provenance:'server-generated'}]);
    const done=await c.query("UPDATE import_jobs SET state='approved',progress=100,error_code=NULL,asset_id=$3,approved_key=$4,gpu_preparation=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$6 AND lease_until>clock_timestamp() RETURNING id",[row.tenant_id,row.id,assetId,key,{...storedGpuModelPreparation(live),result:receipt},lease]);if(!done.rowCount)throw changed();
   });
  }catch(error){
   if(error instanceof GpuModelEncoderError){drained=error.workerDrained;cleanup=error.cleanupComplete;}else if(!spawned)drained=true;
   const code=controller.signal.aborted?'GPU_MODEL_PREPARATION_CANCELLED':error instanceof ApiError?error.code:'GPU_MODEL_PREPARATION_FAILED';
   await transaction(this.pool,c=>c.query("UPDATE import_jobs SET state='failed',error_code=$4,available_at=now()+interval '1 second',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3",[row.tenant_id,row.id,lease,code]));
  }finally{
   clearInterval(active);this.controllers.delete(String(row.id));
   if(directory&&drained&&cleanup)try{await rmdir(directory);}catch{cleanup=false;}
   if(drained&&cleanup)await transaction(this.pool,c=>c.query('UPDATE import_jobs SET lease_id=NULL,lease_until=NULL,png_worker_tokens=array_remove(png_worker_tokens,$3::uuid),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_id=$3',[row.tenant_id,row.id,lease]));
  }
  return true;
 }
}
