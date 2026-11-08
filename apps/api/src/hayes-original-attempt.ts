// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {artworkAccess,sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';
import {isIssuedNativeWorkspaceImport,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIGRATION_SHA='074de4171572039f2f400d49d07aff8a3ec83ec222c1684cbc5452c6cc8b3ece';
const issued=new WeakSet<NativeOexWorkspaceContext>();
function quarantineRequestHash(input:{workspaceId:string;principalId:string;artworkId:string;artworkRevision:number;displayReferenceSha256:string;idempotencyKey:string}){return createHash('sha256').update(JSON.stringify({kind:'hayes-original-quarantine-v1',workspaceId:input.workspaceId,principalId:input.principalId,artworkId:input.artworkId,artworkRevision:input.artworkRevision,displayReferenceSha256:input.displayReferenceSha256,idempotencyKey:input.idempotencyKey,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096})).digest('hex');}
function validHayesIntake(artwork:{revision:unknown;metadata?:{displayReference?:{status?:unknown;assetSha256?:unknown};provenance?:{sourceUnits?:unknown;scaleApplied?:unknown};rights?:unknown}},row:{rights?:unknown;idempotency_key?:unknown;request_hash?:unknown},b:HayesOperationBinding){
 const reference=artwork.metadata?.displayReference,provenance=artwork.metadata?.provenance;
 return artwork.revision===b.artworkRevision&&reference?.status==='provisional-uncalibrated'&&typeof reference.assetSha256==='string'&&/^[a-f0-9]{64}$/.test(reference.assetSha256)&&provenance?.sourceUnits==='unknown'&&provenance.scaleApplied===false&&isDeepStrictEqual(artwork.metadata?.rights,row.rights)&&typeof row.idempotency_key==='string'&&row.request_hash===quarantineRequestHash({workspaceId:b.workspaceId,principalId:b.principalId,artworkId:b.artworkId,artworkRevision:b.artworkRevision,displayReferenceSha256:reference.assetSha256,idempotencyKey:row.idempotency_key});
}
async function catalog(c:PoolClient){const result=await c.query('SELECT sha256 FROM schema_migrations WHERE name=$1',['042_hayes_original_attempt.sql']);if(result.rowCount!==1||result.rows[0].sha256!==MIGRATION_SHA)throw new ApiError(409,'HAYES_CATALOG_INVALID');}
/** Runtime-private opt-in. A context is not a Manager custody receipt. */
export async function bindHayesOriginalContext(c:PoolClient,owner:NativeOexWorkspaceContext):Promise<NativeOexWorkspaceContext>{
 if(!isIssuedNativeWorkspaceImport(owner))throw new ApiError(403,'FORBIDDEN');
 await owner.assertDatabase(c);await catalog(c);await owner.assertDatabase(c);
 issued.add(owner);return owner;
}
export function isHayesOriginalContext(owner:NativeOexWorkspaceContext|undefined):boolean{return !!owner&&issued.has(owner);}
export async function assertHayesOriginalContext(c:PoolClient,s:Session,owner:NativeOexWorkspaceContext|undefined):Promise<void>{
 if(!owner||!issued.has(owner)||owner.tenantId!==s.tenantId||owner.principalId!==s.userId)throw new ApiError(403,'FORBIDDEN');
 await owner.assertDatabase(c);await catalog(c);
}
/** Selected exact-original intake only. This creates an uploading quarantine
 * job, not an approved asset; ordinary import admission remains unchanged. */
export async function createHayesOriginalQuarantine(c:PoolClient,s:Session,owner:NativeOexWorkspaceContext,raw:{artworkId:string;artworkRevision:number;displayReferenceSha256:string;idempotencyKey:string}):Promise<{id:string;state:string}>{
 const keys=['artworkId','artworkRevision','displayReferenceSha256','idempotencyKey'] as const;let input:typeof raw;
 try{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)throw Error();const descriptors=Object.getOwnPropertyDescriptors(raw),own=Reflect.ownKeys(descriptors);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k as typeof keys[number])))throw Error();const values=keys.map(k=>{const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error();return d.value;});input=Object.fromEntries(keys.map((k,i)=>[k,values[i]])) as typeof raw;}catch{throw new ApiError(400,'HAYES_INPUT_INVALID');}
 if(typeof input.artworkId!=='string'||!uuid.test(input.artworkId)||typeof input.idempotencyKey!=='string'||!uuid.test(input.idempotencyKey)||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1||typeof input.displayReferenceSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.displayReferenceSha256))throw new ApiError(400,'HAYES_INPUT_INVALID');
 await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await assertHayesOriginalContext(c,s,owner);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${input.idempotencyKey}`]);
 const locked=await c.query('SELECT 1 FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[s.tenantId,input.artworkId]);if(locked.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},input.artworkId,true),reference=artwork.metadata?.displayReference,provenance=artwork.metadata?.provenance,rights=artwork.metadata?.rights;
 if(artwork.revision!==input.artworkRevision||reference?.status!=='provisional-uncalibrated'||reference.assetSha256!==input.displayReferenceSha256||provenance?.sourceUnits!=='unknown'||provenance.scaleApplied!==false||!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const requestHash=quarantineRequestHash({workspaceId:owner.workspaceId,principalId:s.userId,...input});
 const prior=await c.query('SELECT id,state,user_id,request_hash FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,input.idempotencyKey]);
 if(prior.rowCount){if(prior.rows[0].user_id!==s.userId||prior.rows[0].request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return {id:String(prior.rows[0].id),state:String(prior.rows[0].state)};}
 await assertHayesOriginalContext(c,s,owner);if(!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const id=randomUUID(),sourceSha='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',key=`${s.tenantId}/quarantine/import-${id}/${sourceSha}`;
 await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters) VALUES($1,$2,$3,$4,$5,$6,'model/gltf-binary',$7,8383096,$8,$9,$10,1)",[s.tenantId,id,s.userId,input.artworkId,input.idempotencyKey,requestHash,sourceSha,rights,key,`${s.tenantId}/approved/${sourceSha}`]);
 if(!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');return {id,state:'uploading'};
}
/** Must execute inside the authenticated operation transaction. The manager
 * callback proves its live session, not worker completion or stage disposal.
 * The Manager must not start the worker until this transaction has committed. */
export async function openHayesOriginalAttempt(c:PoolClient,s:Session,owner:NativeOexWorkspaceContext,blobs:BlobStore,input:unknown,assertManagerLive:(binding:HayesOperationBinding)=>Promise<void>):Promise<HayesOperationBinding>{
 const b=parseHayesOperationBinding(input);
 if(!issued.has(owner)||owner.tenantId!==s.tenantId||owner.principalId!==s.userId||owner.workspaceId!==b.workspaceId||b.tenantId!==s.tenantId||b.principalId!==s.userId||typeof assertManagerLive!=='function'||!blobs.getBounded)throw new ApiError(403,'FORBIDDEN');
 await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
 await owner.assertDatabase(c);await catalog(c);await assertManagerLive(b);
 const found=await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND artwork_id=$4 AND state='queued' AND hayes_attempt_id IS NULL AND model_derivation IS NULL AND derived IS NULL AND mime='model/gltf-binary' AND expected_hash=$5 AND expected_bytes=$6 FOR UPDATE",[b.tenantId,b.jobId,b.principalId,b.artworkId,b.sourceSha256,b.sourceBytes]);
 if(found.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');const row=found.rows[0];
 const locked=await c.query('SELECT 1 FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[s.tenantId,b.artworkId]);if(locked.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},b.artworkId,true);
 if(!validHayesIntake(artwork,row,b)||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const source=Buffer.from(await blobs.getBounded(row.object_key,b.sourceBytes));try{if(source.length!==b.sourceBytes||sha256(source)!==b.sourceSha256)throw new ApiError(409,'HAYES_SOURCE_CHANGED');}finally{source.fill(0);}
 await owner.assertDatabase(c);await catalog(c);await assertManagerLive(b);
 await c.query('INSERT INTO hayes_original_attempts(tenant_id,id,workspace_id,principal_id,job_id,lease_id,runtime_generation,correlation_id,artwork_id,artwork_revision,source_sha256,source_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[b.tenantId,b.attemptId,b.workspaceId,b.principalId,b.jobId,b.leaseId,b.runtimeGeneration,b.correlationId,b.artworkId,b.artworkRevision,b.sourceSha256,b.sourceBytes]);
 const claimed=await c.query("UPDATE import_jobs SET state='processing',progress=25,attempts=attempts+1,lease_id=$3,lease_until=clock_timestamp()+interval '30 seconds',hayes_attempt_id=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='queued' AND hayes_attempt_id IS NULL AND attempts<5 RETURNING id",[b.tenantId,b.jobId,b.leaseId,b.attemptId]);
 if(claimed.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');await assertManagerLive(b);if(!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');const live=await c.query("SELECT 1 FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND hayes_attempt_id=$4 AND lease_until>clock_timestamp()",[b.tenantId,b.jobId,b.leaseId,b.attemptId]);if(live.rowCount!==1||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');return b;
}

/** Recheck the committed claim immediately before a separately authorized
 * Manager operation. Closing a transaction or losing this check is not drain. */
export async function revalidateHayesOriginalAttempt(c:PoolClient,s:Session,owner:NativeOexWorkspaceContext,blobs:BlobStore,input:unknown,assertManagerLive:(binding:HayesOperationBinding)=>Promise<void>):Promise<void>{
 const b=parseHayesOperationBinding(input);
 if(!issued.has(owner)||owner.workspaceId!==b.workspaceId||owner.tenantId!==s.tenantId||owner.principalId!==s.userId||b.tenantId!==s.tenantId||b.principalId!==s.userId||!blobs.getBounded||typeof assertManagerLive!=='function')throw new ApiError(403,'FORBIDDEN');
 await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await owner.assertDatabase(c);await catalog(c);await assertManagerLive(b);
 const result=await c.query("SELECT j.* FROM import_jobs j JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(j.tenant_id,j.hayes_attempt_id,j.id) WHERE j.tenant_id=$1 AND j.id=$2 AND j.state='processing' AND j.lease_id=$3 AND j.lease_until>clock_timestamp() AND a.id=$4 AND a.workspace_id=$5 AND a.principal_id=$6 AND a.runtime_generation=$7 AND a.correlation_id=$8 AND a.artwork_id=$9 AND a.artwork_revision=$10 AND a.source_sha256=$11 AND a.source_bytes=$12 FOR UPDATE OF j,a",[b.tenantId,b.jobId,b.leaseId,b.attemptId,b.workspaceId,b.principalId,b.runtimeGeneration,b.correlationId,b.artworkId,b.artworkRevision,b.sourceSha256,b.sourceBytes]);
 if(result.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');const row=result.rows[0];
 const locked=await c.query('SELECT 1 FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[s.tenantId,b.artworkId]);if(locked.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const artwork=await artworkAccess(c,{tenantId:s.tenantId,userId:s.userId},b.artworkId,true);
 if(!validHayesIntake(artwork,row,b)||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export')||row.expected_hash!==b.sourceSha256||Number(row.expected_bytes)!==b.sourceBytes)throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const source=Buffer.from(await blobs.getBounded(row.object_key,b.sourceBytes));try{if(source.length!==b.sourceBytes||sha256(source)!==b.sourceSha256)throw new ApiError(409,'HAYES_SOURCE_CHANGED');}finally{source.fill(0);}
 await owner.assertDatabase(c);await catalog(c);await assertManagerLive(b);
 if(!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
 const live=await c.query("SELECT 1 FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND hayes_attempt_id=$4 AND lease_until>clock_timestamp()",[b.tenantId,b.jobId,b.leaseId,b.attemptId]);if(live.rowCount!==1||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
}
