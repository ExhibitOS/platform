// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {ModelPreparationExecution} from './model-preparation-import.ts';
import {ApiError} from './api-error.ts';
const mocked=vi.hoisted(()=>({fixture:undefined as unknown as Fixture}));
vi.mock('@exhibitos/storage',()=>({
 sha256:(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),
 artworkAccess:async(_c:unknown,s:{tenantId:string;userId:string},id:string)=>{const f=mocked.fixture;if(s.tenantId!==tenant||s.userId!==principal||id!==artworkId||!f.authorized)throw new ApiError(403,'FORBIDDEN');return structuredClone(f.artwork);},
 transaction:async(_pool:unknown,work:(c:PoolClient)=>Promise<unknown>)=>{
  const f=mocked.fixture,save=structuredClone({row:f.row,artwork:f.artwork,snapshots:[...f.snapshots],assets:[...f.assets],lineage:f.lineage});
  try{const value=await work(f.client);await f.onCommit?.();return value;}catch(error){f.row=save.row;f.artwork=save.artwork;f.snapshots=new Map(save.snapshots);f.assets=new Map(save.assets);f.lineage=save.lineage;throw error;}
 },
}));
vi.mock('./auth.ts',()=>({ApiError,uuid:(id:unknown)=>{if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw new ApiError(400,'INVALID_ID');}}));
vi.mock('./rights.ts',()=>({allowedRights:(r:unknown,role:string)=>!!r&&typeof r==='object'&&(r as Record<string,unknown>)[role]===true}));
vi.mock('./model-preparation-import.ts',()=>({assertModelPreparationExecution:()=>{}}));
vi.mock('./cms.ts',()=>({revisionIdentity:(_s:unknown,id:string,n:number)=>`${id}:${n}`}));
vi.mock('./gpu-model-encoder.ts',()=>({
 assertGpuModelEncoderReady:async()=>{const f=mocked.fixture;f.events.push('encoder-ready');if(!f.encoderReady)throw new ApiError(503,'GPU_MODEL_ENCODER_IDENTITY_INVALID');},
 GpuModelEncoderError:class extends ApiError{workerDrained:boolean;cleanupComplete:boolean;constructor(code:string,drained:boolean,cleanup:boolean){super(503,code);this.workerDrained=drained;this.cleanupComplete=cleanup;}},
 encodeGpuModelBaseColor:async(_png:Buffer,context:EncoderContext)=>{const f=mocked.fixture;f.events.push('spawn');f.encoderContext=context;context.onSpawn();if(f.encode)return f.encode(context);await context.assertCurrent();return {ktx:Buffer.from('ktx'),workerDrained:true};},
}));
vi.mock('./gpu-model-producer.ts',()=>({
 assertGpuModelOutputCapacity:(source:Buffer,identity:{sha256:string;bytes:number})=>{if(hash(source)!==identity.sha256||source.length!==identity.bytes)throw new ApiError(422,'GPU_SOURCE_INVALID');mocked.fixture.events.push('capacity-preflight');if(mocked.fixture.capacityFailure)throw new ApiError(422,'GPU_MODEL_OUTPUT_CAPACITY');return {colourPNG:Buffer.from('synthetic-png')};},
 assembleGpuModelDerivative:(source:Buffer,_identity:unknown,ktx:Buffer)=>({bytes:Buffer.concat([source,ktx]),producer:producer()}),
}));
vi.mock('./gpu-source-preservation.ts',()=>({parseGpuModelSource:(bytes:Buffer)=>({doc:{images:[{bufferView:0}],bufferViews:[{byteOffset:0,byteLength:3}]},bin:bytes.subarray(bytes.length-3)})}));
import {GpuModelPreparations,GPU_MODEL_MIGRATION_SHA256} from './gpu-model-preparations.ts';
import {GpuModelEncoderError} from './gpu-model-encoder.ts';
import {GPU_MODEL_PREPARATION_PROFILE,GPU_MODEL_PREPARATION_RECIPE as recipe,bindGpuModelPreparationIntent} from './gpu-model-preparation-contract.ts';
import {gpuModelDigest,createGpuModelReceipt} from './gpu-model-preparation-state.ts';
const tenant='11111111-1111-4111-8111-111111111111',principal='22222222-2222-4222-8222-222222222222',artworkId='33333333-3333-4333-8333-333333333333',sourceId='44444444-4444-4444-8444-444444444444',jobId='55555555-5555-4555-8555-555555555555';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),actor={tenantId:tenant,userId:principal};
const source=Buffer.alloc(32,42),rights={display:true,export:true};
const request={revision:7,assetId:sourceId,sha256:hash(source),bytes:source.length,idempotencyKey:'synthetic-operation',generation:'native-client-7',profile:GPU_MODEL_PREPARATION_PROFILE};
// pg returns dynamically shaped SQL records; these mocks deliberately preserve that boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
type EncoderContext={signal:AbortSignal;assertCurrent:()=>Promise<void>;onSpawn:()=>void;writerFd?:number};
function producer(){return {version:1,tool:{name:'toktx',version:'4.4.2',executableSHA256:recipe.encoder.sha256,librarySHA256:recipe.encoder.librarySHA256,recipeSHA256:'886e3815a386a46462e46d35ccb640498ebefcc853cefba61f76560b62cae4bc'},geometry:{algorithm:'glb-source-preservation-v1',sourceSHA256:'a'.repeat(64),outputSHA256:'a'.repeat(64),triangles:1,vertices:3},samplers:{sourceSHA256:'b'.repeat(64),outputSHA256:'b'.repeat(64),semantics:'source-preserved-implicit-repeat-mipmapped'},roles:['baseColor','normal','occlusion'].map((role,i)=>({role,textureIndex:i,sourceImageIndex:i+1,sourceSHA256:'c'.repeat(64),sourceBytes:24,outputPngImageIndex:i+1,outputPngSHA256:'c'.repeat(64),outputPngBytes:24,width:512,height:512,colorSpace:i===0?'srgb':'linear'})),ktx:{imageIndex:0,sha256:hash(Buffer.from('ktx')),bytes:3,width:512,height:512,levels:10,format:'uastc',transfer:'srgb',opaque:true,levelDimensions:[512,256,128,64,32,16,8,4,2,1]}};}
function deferred<T=void>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
class Fixture{
 row:Row;artwork:Row;snapshots:Map<number,Row>;assets=new Map<string,Row>();lineage:Row[]=[];events:string[]=[];objects=new Map<string,Buffer>([['source',Buffer.from(source)]]);
 capacityFailure=false;active=true;authorized=true;encoderReady=true;supported=true;onCommit?:()=>Promise<void>;encoderContext?:EncoderContext;encode?: (context:EncoderContext)=>Promise<{ktx:Buffer;workerDrained:true}>;
 query=vi.fn(async(sql:string,args:unknown[]=[]):Promise<{rows:Row[];rowCount:number}>=>{
  const rows=(items:Row[])=>({rows:structuredClone(items),rowCount:items.length});
  if(sql.includes('AS supported')){expect(args).toEqual(['049_gpu_model_preparation.sql',GPU_MODEL_MIGRATION_SHA256]);return rows([{supported:this.supported}]);}
  if(sql.includes('FOR UPDATE SKIP LOCKED'))return rows(this.row.state==='queued'&&this.row.attempts<5&&this.row.png_worker_tokens.length===0?[this.row]:[]);
  if(sql.startsWith("UPDATE import_jobs SET state='processing'")){this.row={...this.row,state:'processing',progress:25,attempts:this.row.attempts+1,lease_id:args[2],lease_until:'live',png_worker_tokens:[...this.row.png_worker_tokens,args[2]],gpu_preparation:args[3]};return rows([this.row]);}
  if(sql.includes("state='processing' AND lease_id")&&sql.startsWith('SELECT *'))return rows(this.row.state==='processing'&&this.row.lease_id===args[2]&&this.row.lease_until==='live'&&this.row.png_worker_tokens.includes(args[2])?[this.row]:[]);
  if(sql.startsWith('SELECT snapshot FROM artwork_approvals'))return rows(this.snapshots.has(Number(args[2]))?[{snapshot:this.snapshots.get(Number(args[2]))}]:[]);
  if(sql.startsWith('SELECT a.*,r.metadata'))return rows(this.assets.has(String(args[2]))?[this.assets.get(String(args[2]))!]:[]);
  if(sql.startsWith('SELECT metadata FROM asset_derivatives'))return rows(this.lineage);
  if(sql.startsWith('SELECT lease_until>'))return rows([{live:this.row.lease_id===args[2]&&this.row.lease_until==='live'}]);
  if(sql.startsWith('INSERT INTO rights')){this.events.push('rights');return rows([]);}
  if(sql.startsWith('INSERT INTO assets')){this.events.push('asset');this.assets.set(String(args[1]),{id:args[1],object_key:args[4],sha256:args[5],bytes:args[6],mime:'model/gltf-binary',scale_meters:args[7],current_rights:structuredClone(this.row.rights)});return rows([]);}
  if(sql.startsWith('INSERT INTO asset_derivatives')){this.events.push('lineage');this.lineage.push({metadata:structuredClone(args[3])});return rows([]);}
  if(sql.startsWith("UPDATE import_jobs SET state='approved'")){if(this.row.state!=='processing'||this.row.lease_id!==args[5]||this.row.lease_until!=='live')return rows([]);this.events.push('approved');Object.assign(this.row,{state:'approved',progress:100,error_code:null,asset_id:args[2],approved_key:args[3],gpu_preparation:args[4]});return rows([{id:this.row.id}]);}
  if(sql.startsWith("UPDATE import_jobs SET state='failed'")){if(this.row.state==='processing'&&this.row.lease_id===args[2])Object.assign(this.row,{state:'failed',error_code:args[3]});return rows([]);}
  if(sql.startsWith('UPDATE import_jobs SET lease_id=NULL')){if(this.row.lease_id===args[2]){this.events.push('drained');this.row.lease_id=null;this.row.lease_until=null;this.row.png_worker_tokens=this.row.png_worker_tokens.filter((x:string)=>x!==args[2]);}return rows([]);}
  if(sql.startsWith("UPDATE import_jobs SET state='cancelled'")){this.row.state='cancelled';return rows([]);}
  if(sql.startsWith("UPDATE import_jobs SET state='queued'")){this.row.state='queued';this.row.error_code=null;return rows([]);}
  if(sql.startsWith('SELECT id FROM import_jobs WHERE tenant_id'))return rows([]);
  if(sql.startsWith('SELECT * FROM import_jobs WHERE tenant_id'))return rows(args[0]===this.row.tenant_id&&args[1]===(sql.includes('idempotency_key')?this.row.idempotency_key:this.row.id)?[this.row]:[]);
  if(sql.startsWith('SELECT artwork_id,user_id'))return rows([{artwork_id:artworkId,user_id:this.row.user_id}]);
  if(sql.startsWith('INSERT INTO artwork_approvals')){this.snapshots.set(Number(args[2]),structuredClone(args[4] as Row));return rows([]);}
  if(sql.startsWith('UPDATE artworks SET approved_revision')){this.artwork.approved_revision=args[2];this.artwork.approved_asset_id=args[3];return rows([]);}
  if(sql.startsWith('SELECT r.revision'))return rows([{revision:1}]);
  if(sql.startsWith('SELECT pg_advisory')||sql.startsWith('SELECT id FROM artworks'))return rows([]);
  throw Error('UNHANDLED_SQL:'+sql);
 });
 client={query:this.query} as unknown as PoolClient;
 blobs={getBounded:vi.fn(async(key:string,n:number)=>{this.events.push('read:'+key);const bytes=this.objects.get(key);if(!bytes||bytes.length>n)throw Error('MISSING_BLOB');return Buffer.from(bytes);}),putDurable:vi.fn(async(key:string,bytes:Uint8Array)=>{this.events.push('durable');this.objects.set(key,Buffer.from(bytes));})} as unknown as BlobStore;
 base={mode:'service',blobs:this.blobs,isActive:()=>this.active,assertReady:vi.fn(async()=>{if(!this.active)throw new ApiError(503,'MODEL_PREPARATION_UNAVAILABLE');})} as ModelPreparationExecution;
 constructor(){
  const approval={asset:{id:sourceId,mime:'model/gltf-binary',sha256:hash(source),bytes:source.length},metadata:{rights:structuredClone(rights)}};
  this.snapshots=new Map([[7,approval]]);this.artwork={revision:7,approved_revision:7,approved_asset_id:sourceId,metadata:{rights:structuredClone(rights)}};
  this.assets.set(sourceId,{id:sourceId,object_key:'source',mime:'model/gltf-binary',sha256:hash(source),bytes:source.length,scale_meters:1,current_rights:structuredClone(rights)});
  this.row={tenant_id:tenant,id:jobId,user_id:principal,artwork_id:artworkId,idempotency_key:request.idempotencyKey,request_hash:gpuModelDigest({purpose:'approved-display-gpu-derivative',artworkId,...request}),expected_hash:request.sha256,expected_bytes:request.bytes,mime:'model/gltf-binary',object_key:'source',approved_key:'quarantine',rights:structuredClone(rights),scale_meters:1,state:'queued',progress:10,attempts:0,error_code:null,available_at:new Date(0).toISOString(),lease_id:null,png_drain_version:1,png_worker_tokens:[],gpu_preparation:{kind:'gpu-model-preparation',intent:bindGpuModelPreparationIntent(request,{tenantId:tenant,principalId:principal,artworkId,approvalSHA256:gpuModelDigest(approval),rightsSHA256:gpuModelDigest(rights)})}};
 }
}
let root:string,f:Fixture,jobs:GpuModelPreparations;
beforeEach(async()=>{root=await mkdtemp(join(await import('node:fs/promises').then(m=>m.realpath(tmpdir())),'gpu-job-unit-'));f=new Fixture();mocked.fixture=f;jobs=new GpuModelPreparations({} as Pool,f.base,'/synthetic-managed-encoder',root);});
afterEach(async()=>{await jobs.close();await rm(root,{recursive:true});vi.restoreAllMocks();});
describe('ordinary GPU producer job lifecycle (mocked encoder, no conversion)',()=>{
 it('keeps immutable candidate receipts within the same 32 MiB read/write boundary',()=>{
  const candidate={assetId:jobId,mime:'model/gltf-binary' as const,sha256:'c'.repeat(64),bytes:32*1024*1024};
  expect(createGpuModelReceipt(f.row,candidate,producer() as never).candidate.bytes).toBe(32*1024*1024);
  expect(()=>createGpuModelReceipt(f.row,{...candidate,bytes:candidate.bytes+1},producer() as never)).toThrow('GPU_MODEL_PREPARATION_STATE_INVALID');
 });
 it('rejects output capacity before encoder dispatch and never publishes durable candidate bytes or receipt',async()=>{
  // The real producer boundary is exercised separately with structurally valid
  // near-limit GLB. Here the job seam receives its explicit preflight rejection.
  const {FileBlobStore}=await vi.importActual<typeof import('@exhibitos/storage')>('@exhibitos/storage');
  const root=await mkdtemp(join(tmpdir(),'gpu-job-capacity-')),store=new FileBlobStore(root),input=Buffer.alloc(32*1024*1024,42);
  try{
   await store.putDurable('synthetic/source',input);const durable=vi.spyOn(store,'putDurable');
   f.row.object_key='synthetic/source';f.assets.get(sourceId)!.object_key='synthetic/source';f.row.expected_hash=hash(input);f.row.expected_bytes=input.length;
   Object.assign(f.assets.get(sourceId)!,{sha256:hash(input),bytes:input.length});
   Object.assign(f.snapshots.get(7)!.asset,{sha256:hash(input),bytes:input.length});
   const previous=f.row.gpu_preparation.intent;
   f.row.gpu_preparation.intent=bindGpuModelPreparationIntent({...previous.request,sha256:hash(input),bytes:input.length},{...previous.binding,approvalSHA256:gpuModelDigest(f.snapshots.get(7))});
   Object.assign(f.base,{blobs:store});f.capacityFailure=true;
   expect(await jobs.work()).toBe(true);
   expect(f.events).toContain('capacity-preflight');expect(f.events).not.toContain('spawn');expect(durable).not.toHaveBeenCalled();
   expect(f.row).toMatchObject({state:'failed',error_code:'GPU_MODEL_OUTPUT_CAPACITY',lease_id:null,png_worker_tokens:[]});
   expect(f.row.gpu_preparation).not.toHaveProperty('result');expect(f.assets.size).toBe(1);expect(f.lineage).toEqual([]);
   expect(Buffer.from(await store.getBounded('synthetic/source',input.length)).equals(input)).toBe(true);expect(await store.listAll()).toEqual(['synthetic/source']);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('commits a separate durable candidate/lineage before readiness and never changes source or primary approval',async()=>{
  const original=structuredClone(f.snapshots.get(7));expect(await jobs.work()).toBe(true);
  expect(f.events.indexOf('durable')).toBeLessThan(f.events.indexOf('asset'));expect(f.events.indexOf('asset')).toBeLessThan(f.events.indexOf('approved'));expect(f.events.at(-1)).toBe('drained');
  const view=jobs.view(f.row);expect(view.gpuPreparation).toMatchObject({status:'ready',workerDrained:true,source:{assetId:sourceId}});expect(view).toHaveProperty('assetId');expect(f.snapshots.get(7)).toEqual(original);expect(f.artwork.approved_asset_id).toBe(sourceId);expect(f.objects.get('source')).toEqual(source);expect(f.assets.size).toBe(2);expect(f.lineage).toHaveLength(1);
  expect(await jobs.selection(f.client,actor,artworkId)).toMatchObject({revision:7,selection:null});
  const review=await jobs.review(f.client,actor,artworkId,jobId);expect(review.candidate.assetId).not.toBe(sourceId);expect(review.receiptSHA256).toBe(f.row.gpu_preparation.result.sha256);
 });
 it('keeps approved output unready until actual invocation cleanup has completed',async()=>{
  const copied=deferred(),release=deferred();const work=jobs.work({afterCopy:async()=>{copied.resolve();await release.promise;}});await copied.promise;
  expect(jobs.view(f.row).gpuPreparation.workerDrained).toBe(false);expect(jobs.view(f.row)).not.toHaveProperty('assetId');release.resolve();await work;expect(jobs.view(f.row).gpuPreparation.status).toBe('ready');
 });
 it('cancels an owned worker after rights and encoder readiness change, but waits for close before releasing its token',async()=>{
  const spawned=deferred(),closed=deferred();f.encode=async()=>{spawned.resolve();await closed.promise;throw new GpuModelEncoderError('GPU_MODEL_ENCODER_CANCELLED',true,true);};const work=jobs.work();await spawned.promise;
  f.artwork.metadata.rights.export=false;f.encoderReady=false;
  expect(await jobs.action(f.client,actor,jobId,'cancel')).toMatchObject({state:'cancelled',gpuPreparation:{workerDrained:false}});expect(f.encoderContext!.signal.aborted).toBe(true);expect(f.row.png_worker_tokens).toHaveLength(1);
  let settled=false;const close=jobs.close().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);closed.resolve();await work;await close;expect(f.row.state).toBe('cancelled');expect(f.row.png_worker_tokens).toEqual([]);expect(f.assets.size).toBe(1);
 });
 it('rejects foreign cancellation and refuses cancellation of an already approved candidate',async()=>{
  await expect(jobs.action(f.client,{...actor,userId:sourceId},jobId,'cancel')).rejects.toMatchObject({status:403});expect(f.row.state).toBe('queued');
  await jobs.work();await expect(jobs.action(f.client,actor,jobId,'cancel')).rejects.toMatchObject({code:'JOB_STATE'});
 });
 it('does not start a child when close races the claim transaction commit',async()=>{
  const claimed=deferred(),release=deferred();let first=true;f.onCommit=async()=>{if(first){first=false;claimed.resolve();await release.promise;}};const work=jobs.work();await claimed.promise;const closing=jobs.close();release.resolve();await work;await closing;
  expect(f.events).not.toContain('spawn');expect(f.row.state).toBe('failed');expect(f.row.png_worker_tokens).toEqual([]);expect(f.row.error_code).toBe('GPU_MODEL_PREPARATION_CANCELLED');
 });
 it.each(['rights','revision','source','lease'] as const)('fails closed on %s change before custody publication',async change=>{
  await jobs.work({beforeCommit:()=>{if(change==='rights')f.artwork.metadata.rights.export=false;if(change==='revision')f.artwork.revision++;if(change==='source')f.assets.get(sourceId)!.sha256='e'.repeat(64);if(change==='lease')f.row.lease_until='expired';}});
  expect(f.row.state).toBe('failed');expect(f.assets.size).toBe(1);expect(f.lineage).toEqual([]);expect(f.events).not.toContain('durable');expect(f.row.png_worker_tokens).toEqual([]);
 });
 it('fences a changed invocation claim even while its lease remains live',async()=>{
  await jobs.work({beforeCommit:()=>{f.row.gpu_preparation.claim.token=sourceId;}});expect(f.row.state).toBe('failed');expect(f.events).not.toContain('durable');expect(f.assets.size).toBe(1);expect(f.row.png_worker_tokens).toEqual([]);
 });
 it('rolls back asset/receipt registration when rights change after durable copy',async()=>{
  await jobs.work({afterCopy:()=>{f.artwork.metadata.rights.export=false;}});expect(f.events).toContain('durable');expect(f.assets.size).toBe(1);expect(f.lineage).toEqual([]);expect(f.row.state).toBe('failed');expect(f.row.gpu_preparation).not.toHaveProperty('result');expect(f.objects.get('source')).toEqual(source);
 });
 it('does not publish when runtime authority disappears after copying',async()=>{
  await jobs.work({afterCopy:()=>{f.active=false;}});expect(f.row.state).toBe('failed');expect(f.assets.size).toBe(1);expect(f.lineage).toEqual([]);
 });
 it.each([[false,true],[true,false]])('retains ownership when drain=%s cleanup=%s is unconfirmed',async(drained,cleanup)=>{
  f.encode=async()=>{throw new GpuModelEncoderError('GPU_MODEL_ENCODER_FAILED',drained,cleanup);};await jobs.work();expect(f.row.state).toBe('failed');expect(f.row.png_worker_tokens).toHaveLength(1);await expect(jobs.action(f.client,actor,jobId,'retry')).rejects.toMatchObject({code:'WORKER_DRAIN_UNCONFIRMED'});expect(await jobs.work()).toBe(false);
 });
 it('retries only a drained failed job with current source authority and preserves operation identity',async()=>{
  f.encode=async()=>{throw new GpuModelEncoderError('GPU_MODEL_ENCODER_FAILED',true,true);};await jobs.work();const intent=structuredClone(f.row.gpu_preparation.intent);expect(f.row.state).toBe('failed');
  expect(await jobs.action(f.client,actor,jobId,'retry')).toMatchObject({state:'queued'});expect(f.row.gpu_preparation.intent).toEqual(intent);f.encode=undefined;await jobs.work();expect(f.row.attempts).toBe(2);expect(jobs.view(f.row).gpuPreparation.status).toBe('ready');
 });
 it.each(['future','attempts','rights'] as const)('rejects retry with %s barrier',async barrier=>{
  f.row.state='failed';if(barrier==='future')f.row.available_at=new Date(Date.now()+60000).toISOString();if(barrier==='attempts')f.row.attempts=5;if(barrier==='rights')f.artwork.metadata.rights.export=false;
  await expect(jobs.action(f.client,actor,jobId,'retry')).rejects.toMatchObject({code:barrier==='rights'?'GPU_MODEL_PREPARATION_CONTEXT_CHANGED':'WORKER_DRAIN_UNCONFIRMED'});expect(f.row.state).toBe('failed');
 });
 it('keeps missing optional migration or encoder unadvertised and starts no worker',async()=>{
  f.supported=false;await expect(jobs.ready(f.client,actor)).rejects.toMatchObject({status:503});expect(await jobs.work()).toBe(false);f.supported=true;f.encoderReady=false;await expect(jobs.work()).rejects.toMatchObject({status:503});expect(f.row.state).toBe('queued');expect(f.events).not.toContain('spawn');
 });
 it('replays exact create idempotency without enqueueing a second job and rejects conflicting input/foreign owner',async()=>{
  expect(await jobs.create(f.client,actor,artworkId,request)).toMatchObject({id:jobId,state:'queued'});
  await expect(jobs.create(f.client,actor,artworkId,{...request,bytes:33})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  f.row.user_id=sourceId;await expect(jobs.create(f.client,actor,artworkId,request)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.row.attempts).toBe(0);
 });
 it('approves only the exact reviewed receipt, preserves primary source, and replays after the approved revision increment',async()=>{
  await jobs.work();const before=structuredClone(f.snapshots.get(7)),receipt=f.row.gpu_preparation.result;
  const body={revision:7,jobId,receiptSHA256:receipt.sha256,candidateSHA256:receipt.candidate.sha256,generation:request.generation};
  const revise=vi.fn(async(_c:unknown,_s:unknown,_id:string,metadata:Row)=>{f.artwork.revision++;f.artwork.metadata=metadata;});
  const cms={ownArtwork:async()=>structuredClone(f.artwork),revise} as unknown as import('./cms.ts').Cms;
  await expect(jobs.approve(f.client,actor as import('./auth.ts').Session,artworkId,{...body,generation:'foreign-client'},cms)).rejects.toMatchObject({code:'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'});
  await expect(jobs.approve(f.client,actor as import('./auth.ts').Session,artworkId,{...body,candidateSHA256:'f'.repeat(64)},cms)).rejects.toMatchObject({code:'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'});
  const approved=await jobs.approve(f.client,actor as import('./auth.ts').Session,artworkId,body,cms);expect(approved).toMatchObject({revision:8,selection:{jobId,sourceAssetId:sourceId,candidateAssetId:receipt.candidate.assetId,approvedRevision:8}});
  expect(await jobs.approve(f.client,actor as import('./auth.ts').Session,artworkId,body,cms)).toEqual(approved);expect(revise).toHaveBeenCalledTimes(1);expect(f.snapshots.get(7)).toEqual(before);expect(f.snapshots.get(8)!.gpuVariant).toEqual(receipt);expect(f.artwork.approved_asset_id).toBe(sourceId);expect(f.objects.get('source')).toEqual(source);
  f.snapshots.get(8)!.gpuVariant.candidate.sha256='e'.repeat(64);await expect(jobs.selection(f.client,actor,artworkId)).rejects.toMatchObject({code:'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'});
 });
 it('does not admit review or approval while an approved invocation still carries a drain token',async()=>{
  await jobs.work();f.row.lease_id=sourceId;f.row.png_worker_tokens=[sourceId];const receipt=f.row.gpu_preparation.result;
  expect(jobs.view(f.row)).not.toHaveProperty('assetId');await expect(jobs.review(f.client,actor,artworkId,jobId)).rejects.toMatchObject({code:'GPU_MODEL_CANDIDATE_NOT_READY'});
  await expect(jobs.approve(f.client,actor as import('./auth.ts').Session,artworkId,{revision:7,jobId,receiptSHA256:receipt.sha256,candidateSHA256:receipt.candidate.sha256,generation:request.generation},{} as import('./cms.ts').Cms)).rejects.toMatchObject({code:'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'});
 });
 it('retains invocation ownership on unknown post-spawn failure instead of treating notification as close',async()=>{
  f.encode=async()=>{throw Error('unknown notification without close evidence');};await jobs.work();expect(f.row.state).toBe('failed');expect(f.row.png_worker_tokens).toHaveLength(1);expect(f.row.lease_id).not.toBeNull();expect(f.assets.size).toBe(1);
 });
 it('rejects tampered candidate bytes during reviewed byte retrieval',async()=>{
  await jobs.work();const receipt=f.row.gpu_preparation.result;f.objects.set(f.row.approved_key,Buffer.alloc(receipt.candidate.bytes));await expect(jobs.reviewedBytes(f.client,actor,artworkId,jobId,{receiptSHA256:receipt.sha256,candidateSHA256:receipt.candidate.sha256})).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 });
 it('requires exact immutable receipt and candidate bytes during review',async()=>{
  await jobs.work();f.lineage[0]!.metadata.serverReceipt.candidate.sha256='d'.repeat(64);await expect(jobs.review(f.client,actor,artworkId,jobId)).rejects.toMatchObject({code:'GPU_MODEL_PREPARATION_CONTEXT_CHANGED'});
 });
});
