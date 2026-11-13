// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {artworkAccess,transaction,sha256} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import type {Imports} from './imports.ts';
import type {ModelPreparationWriter} from './model-preparation-import.ts';
import {allowedRights} from './rights.ts';
import {canonicalImageHash,productImageDrained} from './product-image-intent.ts';
import {prepareFreshImageInWorker} from './product-image-preparation-process.ts';
import {prepareProductImageThumbnail,FRESH_IMAGE_RECIPE_SHA256,PRODUCT_IMAGE_RECIPE,type ProductImageProducerReceipt} from './product-image-preparation.ts';
import {validateThumbnailBytes} from './artwork-thumbnail.ts';
import {currentImageThumbnailReady} from './current-image-thumbnail-schema.ts';

export const CURRENT_IMAGE_THUMBNAIL_PROFILE='current-approved-image-thumbnail-256-v1' as const;
const KIND='current-approved-image-thumbnail' as const;
type Source={assetId:string;sha256:string;bytes:number;mime:'image/png'};
type Request={requestId:string;expectedRevision:number};
export interface CurrentImageThumbnailReceipt {
 version:1;profile:typeof CURRENT_IMAGE_THUMBNAIL_PROFILE;jobId:string;artworkId:string;artworkRevision:number;
 workspaceId:string;principalId:string;rightsSHA256:string;source:Source;
 thumbnail:{assetId:string;sha256:string;bytes:number;mime:'image/png';width:number;height:number};
 producer:ProductImageProducerReceipt<'image/png'>;sha256:string;
}
interface State {kind:typeof KIND;request:Request;workspaceId:string;principalId:string;source:Source;
 claim?:{token:string}&ModelPreparationWriter['identity'];result?:CurrentImageThumbnailReceipt}
const bad=()=>new ApiError(409,'IMAGE_THUMBNAIL_STATE_INVALID');
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function request(value:unknown):Request {
 if(!exact(value,['requestId','expectedRevision'])||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<1||Number(value.expectedRevision)>2147483647)throw new ApiError(400,'INVALID_INPUT');
 uuid(value.requestId);return {requestId:String(value.requestId).toLowerCase(),expectedRevision:Number(value.expectedRevision)};
}
export function storedCurrentImageThumbnail(row:Record<string,unknown>):State|undefined {
 const state=row.derived as State|null;if(state?.kind!==KIND)return;
 if(!exact(state,['kind','request','workspaceId','principalId','source',...(state.claim?['claim']:[]),...(state.result?['result']:[])]))throw bad();
 uuid(state.workspaceId);uuid(state.principalId);request(state.request);
 const source=state.source;
 if(!exact(source,['assetId','sha256','bytes','mime'])||source.mime!=='image/png'||!hash(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<33||source.bytes>32*1024*1024)throw bad();
 uuid(source.assetId);
 if(row.derived_object_key!==`${row.tenant_id}/quarantine/import-${row.id}/image-thumbnail.png`||row.approved_key!==row.object_key||row.mime!=='image/png'||row.png_drain_version!==1||row.user_id!==state.principalId||row.asset_id!==source.assetId||row.expected_hash!==source.sha256||Number(row.expected_bytes)!==source.bytes||row.model_preparation!=null||row.model_derivation!=null||row.original_asset_id!=null)throw bad();
 if(row.idempotency_key!==`image-thumbnail:${state.request.requestId}`||row.request_hash!==canonicalImageHash({profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,artworkId:row.artwork_id,...state.request,source:state.source,rights:row.rights,workspaceId:state.workspaceId,principalId:state.principalId}))throw bad();
 if((row.state==='approved')!==!!state.result)throw bad();
 if(state.claim){const c=state.claim;uuid(c.token);uuid(c.runtimeGeneration);
  if(c.workspaceId!==state.workspaceId||c.tenantId!==row.tenant_id||c.principalId!==state.principalId||!Array.isArray(row.png_worker_tokens)||!row.png_worker_tokens.includes(c.token)||!['processing','failed','cancelled'].includes(String(row.state))||row.state==='processing'&&row.lease_id!==c.token)throw bad();
 }
 if(state.result){const r=state.result;if(!r.source||!r.thumbnail||!r.producer?.source)throw bad();const {sha256:digest,...body}=r;
  if(canonicalImageHash(body)!==digest||r.version!==1||r.profile!==CURRENT_IMAGE_THUMBNAIL_PROFILE||r.jobId!==row.id||r.artworkId!==row.artwork_id||r.artworkRevision!==state.request.expectedRevision||r.workspaceId!==state.workspaceId||r.principalId!==state.principalId||r.rightsSHA256!==canonicalImageHash(row.rights)||!isDeepStrictEqual(r.source,source)||r.producer.version!==1||r.producer.recipeSHA256!==FRESH_IMAGE_RECIPE_SHA256||r.producer.decoder!==PRODUCT_IMAGE_RECIPE.decoder||r.producer.source.sha256!==source.sha256||r.producer.source.bytes!==source.bytes||r.producer.source.mime!=='image/png'||!hash(r.thumbnail.sha256)||r.thumbnail.mime!=='image/png'||!Number.isSafeInteger(r.thumbnail.bytes)||r.thumbnail.bytes<33||r.thumbnail.bytes>512*1024||!Number.isInteger(r.thumbnail.width)||!Number.isInteger(r.thumbnail.height)||r.thumbnail.width<1||r.thumbnail.height<1||r.thumbnail.width>256||r.thumbnail.height>256||r.thumbnail.assetId===source.assetId)throw bad();
  uuid(r.thumbnail.assetId);
 }
 return state;
}
export function currentImageThumbnailView(row:Record<string,unknown>){
 const state=storedCurrentImageThumbnail(row);if(!state)return;
 const ready=row.state==='approved'&&productImageDrained(row)&&!state.claim;
 return {profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,artworkRevision:state.request.expectedRevision,source:state.source,
  status:ready?'ready':['failed','cancelled'].includes(String(row.state))?'failed':'pending',workerDrained:productImageDrained(row)&&['approved','failed','cancelled'].includes(String(row.state)),
  ...(ready?{serverReceipt:state.result,selectionCandidate:{expectedRevision:state.request.expectedRevision,sourceAssetId:state.source.assetId,sourceSha256:state.source.sha256,thumbnailAssetId:state.result!.thumbnail.assetId,thumbnailSha256:state.result!.thumbnail.sha256,view:{kind:'default' as const}}}:{} )};
}
async function currentSource(imports:Imports,c:PoolClient,s:Pick<Session,'tenantId'|'userId'>,artworkId:string,revision:number){
 await currentImageThumbnailReady(c);
 await imports.requiredModelReady(c,s);const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 if(imports.modelExecution?.mode!=='native'||!imports.modelExecution.writer)throw new ApiError(503,'IMAGE_THUMBNAIL_PREPARATION_UNAVAILABLE');
 const art=await artworkAccess(c,s,artworkId,true);
 if(art.revision!==revision||art.approved_revision!==revision||!art.approved_asset_id)throw new ApiError(409,'REVISION_CONFLICT');
 if(!allowedRights(art.metadata?.rights,'display')||!allowedRights(art.metadata?.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
 const approval=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,revision])).rows[0]?.snapshot;
 const asset=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,artworkId,art.approved_asset_id])).rows[0];
 if(!asset||asset.mime!=='image/png'||!hash(asset.sha256)||!Number.isSafeInteger(Number(asset.bytes))||Number(asset.bytes)<33||Number(asset.bytes)>32*1024*1024||!isDeepStrictEqual(asset.rights,art.metadata.rights)||approval?.asset?.id!==asset.id||approval.asset.sha256!==asset.sha256||approval.asset.bytes!==Number(asset.bytes)||approval.asset.mime!==asset.mime||!isDeepStrictEqual(approval.metadata,art.metadata))throw new ApiError(409,'APPROVAL_INVALID');
 return {owner,art,asset,source:{assetId:String(asset.id),sha256:String(asset.sha256),bytes:Number(asset.bytes),mime:'image/png' as const}};
}
export async function assertCurrentImageThumbnail(imports:Imports,c:PoolClient,s:Session,row:Record<string,unknown>){
 const state=storedCurrentImageThumbnail(row);if(!state)throw bad();
 if(state.principalId!==s.userId||row.tenant_id!==s.tenantId)throw new ApiError(403,'FORBIDDEN');
 const now=await currentSource(imports,c,s,String(row.artwork_id),state.request.expectedRevision);
 if(now.owner.workspaceId!==state.workspaceId||!isDeepStrictEqual(now.source,state.source)||now.asset.object_key!==row.object_key||!isDeepStrictEqual(now.art.metadata.rights,row.rights))throw new ApiError(409,'IMAGE_THUMBNAIL_CONTEXT_CHANGED');
 if(state.result){const r=state.result;
  const asset=(await c.query("SELECT * FROM assets WHERE tenant_id=$1 AND artwork_id=$2 AND id=$3 AND state='approved' AND deleted_at IS NULL FOR SHARE",[s.tenantId,row.artwork_id,r.thumbnail.assetId])).rows[0];
  const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'=$3 AND metadata->>'jobId'=$4 AND deleted_at IS NULL",[s.tenantId,state.source.assetId,KIND,row.id])).rows;
  if(!asset||asset.rights_id!==now.asset.rights_id||asset.sha256!==r.thumbnail.sha256||Number(asset.bytes)!==r.thumbnail.bytes||asset.mime!=='image/png'||asset.object_key!==row.derived_object_key||lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:KIND,jobId:row.id,serverReceipt:r,provenance:'server-generated'}))throw bad();
 }
 return now;
}
export async function createCurrentImageThumbnail(imports:Imports,c:PoolClient,s:Session,artworkId:string,value:unknown){
 if(!imports.blobs.putDurable)throw new ApiError(503,'STORAGE_UNAVAILABLE');
 uuid(artworkId);const input=request(value);artworkId=artworkId.toLowerCase();
 await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenantId,artworkId]);
 const now=await currentSource(imports,c,s,artworkId,input.expectedRevision),idempotencyKey=`image-thumbnail:${input.requestId}`;
 const digest=canonicalImageHash({profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,artworkId,...input,source:now.source,rights:now.art.metadata.rights,workspaceId:now.owner.workspaceId,principalId:s.userId});
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${idempotencyKey}`]);
 const prior=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2',[s.tenantId,idempotencyKey])).rows[0];
 if(prior){await assertCurrentImageThumbnail(imports,c,s,prior);if(prior.request_hash!==digest)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return imports.view(prior);}
 const id=randomUUID(),state:State={kind:KIND,request:input,workspaceId:now.owner.workspaceId,principalId:s.userId,source:now.source},key=`${s.tenantId}/quarantine/import-${id}/image-thumbnail.png`;
 const row=(await c.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,derived,derived_object_key,png_drain_version,state,asset_id) VALUES($1,$2,$3,$4,$5,$6,'image/png',$7,$8,$9,$10,$10,1,$11,$12,1,'queued',$13) RETURNING *",[s.tenantId,id,s.userId,artworkId,idempotencyKey,digest,now.source.sha256,now.source.bytes,now.art.metadata.rights,now.asset.object_key,state,key,now.source.assetId])).rows[0];
 return imports.view(row);
}
/** Existing queue/lease/drain lifecycle; only a new thumbnail is registered.
 * Neither the approved Full/coarse, CMS revision, nor any scene is written. */
export async function workCurrentImageThumbnail(imports:Imports,row:Record<string,unknown>,lease:string,hooks?:{beforeCommit?:()=>void|Promise<void>;afterCopy?:()=>void|Promise<void>}){
 const state=storedCurrentImageThumbnail(row);if(!state?.claim)throw bad();
 const actor={tenantId:String(row.tenant_id),userId:String(row.user_id)} as Session,writer=imports.modelExecution?.writer;
 if(!writer||!isDeepStrictEqual(state.claim,{token:lease,...writer.identity}))throw bad();
 await transaction(imports.pool,c=>assertCurrentImageThumbnail(imports,c,actor,row));await writer.assertLive();
 const source=Buffer.from(await imports.boundedBlob(String(row.object_key),state.source.bytes));
 if(source.length!==state.source.bytes||sha256(source)!==state.source.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 // Reuse the existing bounded PNG decoder process; its Full is an ephemeral
 // normalized intermediate, never a replacement asset or stored source.
 const normalized=await prepareFreshImageInWorker(source,{...state.source,mime:'image/png'},{writerFd:writer.writerFd});
 const png=prepareProductImageThumbnail(normalized.full,normalized.receipt.full),dimensions=await validateThumbnailBytes(png);
 await hooks?.beforeCommit?.();
 await transaction(imports.pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await c.query('SELECT id FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[row.tenant_id,row.artwork_id]);
  const live=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) FOR UPDATE",[row.tenant_id,row.id,lease])).rows[0];
  if(!live)throw new ApiError(409,'LEASE_EXPIRED');
  if(!isDeepStrictEqual(live.derived,row.derived))throw bad();
  const now=await assertCurrentImageThumbnail(imports,c,actor,live);await writer.assertLive();
  const thumbnail={assetId:randomUUID(),sha256:sha256(png),bytes:png.length,mime:'image/png' as const,...dimensions};
  const body={version:1 as const,profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,jobId:String(row.id),artworkId:String(row.artwork_id),artworkRevision:state.request.expectedRevision,workspaceId:state.workspaceId,principalId:state.principalId,rightsSHA256:canonicalImageHash(row.rights),source:state.source,thumbnail,producer:normalized.receipt};
  const receipt:CurrentImageThumbnailReceipt={...body,sha256:canonicalImageHash(body)},derived={kind:KIND,request:state.request,workspaceId:state.workspaceId,principalId:state.principalId,source:state.source,result:receipt};
  if(!imports.blobs.putDurable)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  await imports.blobs.putDurable(String(row.derived_object_key),png);
  const stored=Buffer.from(await imports.boundedBlob(String(row.derived_object_key),png.length));if(stored.length!==png.length||sha256(stored)!==thumbnail.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  await hooks?.afterCopy?.();await writer.assertLive();
  await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'image/png',1,'approved')",[row.tenant_id,thumbnail.assetId,row.artwork_id,now.asset.rights_id,row.derived_object_key,thumbnail.sha256,thumbnail.bytes]);
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[row.tenant_id,randomUUID(),state.source.assetId,{version:1,kind:KIND,jobId:row.id,serverReceipt:receipt,provenance:'server-generated'}]);
  const updated=await c.query("UPDATE import_jobs SET state='approved',derived=$4,progress=100,error_code=NULL,lease_id=NULL,lease_until=NULL,png_worker_tokens=array_remove(png_worker_tokens,$3::uuid),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$3 AND lease_until>clock_timestamp() AND $3::uuid=ANY(png_worker_tokens) RETURNING id",[row.tenant_id,row.id,lease,derived]);
  if(!updated.rowCount)throw new ApiError(409,'LEASE_EXPIRED');
 });
}
