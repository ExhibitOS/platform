// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {etag,type Studio} from './studio.ts';
import {modelPreparationDrained,modelPreparationReceipt,modelReceiptDigest,storedModelPreparation} from './model-preparation-intent.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {allowedRights} from './rights.ts';
import {inspectAdoptedModelDetail} from './adopted-model-detail-report.ts';
import {NativeDetailDrainUncertain} from './native-detail-drain.ts';

export const REQUIRED_MODEL_ORIGINAL_PROFILE='required-model-custody-v1';
export const requiredModelOriginalGrantKind='required-model-original-static-grant';
export interface RequiredModelOriginalApproval {kind:typeof REQUIRED_MODEL_ORIGINAL_PROFILE;artworkId:string;artworkRevision:number;importJobId:string;serverReceiptSha256:string}
const unavailable=():never=>{throw new ApiError(409,'REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');};

/** Resolve current CMS custody independently of an upload transfer or adoption.
 * Imports.access verifies both asset rows and their immutable producer lineage,
 * including the supported provisional source-r1 -> approved-r2 transition. */
async function resolveCurrentRequiredModel(c:PoolClient,s:Session,artworkId:string,artworkRevision:number,cms:Cms,imports:Imports,forOriginal:boolean){
 uuid(artworkId);artworkId=artworkId.toLowerCase();
 if(!Number.isSafeInteger(artworkRevision)||artworkRevision<1||artworkRevision>2147483647)throw new ApiError(400,'INVALID_INPUT');
 await imports.requiredModelReady(c,s);
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId),current=await cms.ownArtwork(c,s,artworkId);
 if(current.revision!==artworkRevision||current.approved_revision!==artworkRevision||!current.approved_asset_id)return unavailable();
 const rows=(await c.query(`SELECT id FROM import_jobs WHERE tenant_id=$1 AND user_id=$2 AND artwork_id=$3 AND asset_id=$4
  AND model_preparation->'request'->>'profileId'=$5 AND (model_preparation->'request'->'sourceFull') IS NULL LIMIT 2`,
 [s.tenantId,s.userId,artworkId,current.approved_asset_id,COMPACT_MODEL_RECIPE.id])).rows;
 if(rows.length!==1)return unavailable();
 const job=await imports.access(c,s,rows[0].id),intent=storedModelPreparation(job);
 if(!intent||intent.sourceFull!==undefined||intent.profileId!==COMPACT_MODEL_RECIPE.id||job.user_id!==s.userId||job.artwork_id!==artworkId||job.state!=='approved'||!modelPreparationDrained(job)||
   !(intent.artworkRevision===artworkRevision||intent.sourceDisplayReference&&intent.artworkRevision+1===artworkRevision))return unavailable();
 const receipt=modelPreparationReceipt(job),{artwork}=await cms.studioArtwork(c,s,artworkId),primary=artwork.assets.find(a=>a.id===artwork.primaryAssetId);
 if(artwork.artworkType!=='sculpture'||artwork.revision!==artworkRevision||artwork.primaryAssetId!==receipt.display.assetId||artwork.assets.length!==1||
   !primary||primary.mime!==receipt.display.mime||primary.sha256!==receipt.display.sha256||primary.bytes!==receipt.display.bytes||!isDeepStrictEqual(artwork.rights,job.rights))return unavailable();
 if(!(['display','export'] as const).every(permission=>allowedRights(artwork.rights,permission))||forOriginal&&(artwork.rights.expiresAt!==undefined||!allowedRights(artwork.rights,'download')))throw new ApiError(403,'ORIGINAL_STATIC_RIGHTS_DENIED');
 const custody={version:1 as const,kind:REQUIRED_MODEL_ORIGINAL_PROFILE,workspaceId:owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,
  artworkId,artworkRevision,artworkRevisionId:artwork.revisionId,importJobId:String(job.id),serverReceiptSha256:receipt.sha256,
  original:receipt.original,display:receipt.display,rightsSha256:modelReceiptDigest(artwork.rights)};
 return {job,artwork,receipt,custody};
}

export const resolveRequiredModelCustody=(c:PoolClient,s:Session,artworkId:string,artworkRevision:number,cms:Cms,imports:Imports)=>resolveCurrentRequiredModel(c,s,artworkId,artworkRevision,cms,imports,true);

export async function resolveRequiredModelCandidate(c:PoolClient,s:Session,artworkId:string,revision:number,cms:Cms,imports:Imports){
 const {job,artwork,custody}=await resolveCurrentRequiredModel(c,s,artworkId,revision,cms,imports,false);
 const originalEligible=artwork.rights.expiresAt===undefined&&allowedRights(artwork.rights,'download')&&!custody.display.reusedOriginal;
 return {...imports.view(job),...(originalEligible?{requiredModelCustody:custody}:{})};
}

async function checkedSource(c:PoolClient,s:Session,exhibitionId:string,input:RequiredModelOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal?:AbortSignal,match?:string){
 signal?.throwIfAborted();uuid(exhibitionId);
 if(!input||Object.keys(input).sort().join(',')!=='artworkId,artworkRevision,importJobId,kind,serverReceiptSha256'||input.kind!==REQUIRED_MODEL_ORIGINAL_PROFILE||!/^[a-f0-9]{64}$/.test(input.serverReceiptSha256))throw new ApiError(400,'INVALID_INPUT');
 uuid(input.importJobId);
 const exhibition=await studio.access(c,s,exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 const head={revision:exhibition.revision,etag:etag(exhibition.revision,exhibition.metadata)};
 if(match!==undefined&&match!==head.etag)throw new ApiError(412,'REMOTE_CONFLICT');
 const source=await resolveRequiredModelCustody(c,s,input.artworkId,input.artworkRevision,cms,imports),{job,artwork,receipt,custody}=source;
 if(job.id!==input.importJobId||receipt.sha256!==input.serverReceiptSha256||receipt.display.reusedOriginal||receipt.original.assetId===receipt.display.assetId||
   !exhibition.metadata.candidate.artworks.some((a:unknown)=>isDeepStrictEqual(a,artwork)))return unavailable();
 const grant={version:1 as const,kind:requiredModelOriginalGrantKind,workspaceId:custody.workspaceId,tenantId:s.tenantId,principalId:s.userId,
  exhibitionId,input:structuredClone(input),artworkRevisionId:artwork.revisionId,originalAssetId:receipt.original.assetId,displayAssetId:receipt.display.assetId,
  original:receipt.original,display:receipt.display,rightsSha256:custody.rightsSha256,serverReceiptSha256:receipt.sha256};
 const limit=COMPACT_MODEL_RECIPE.limits;
 if(!Number.isSafeInteger(receipt.original.bytes)||receipt.original.bytes<28||receipt.original.bytes>limit.sourceBytes||
   !Number.isSafeInteger(receipt.display.bytes)||receipt.display.bytes<28||receipt.display.bytes>limit.outputBytes||!blobs.getBounded) return unavailable();
 let bytes:Buffer|undefined,display:Buffer|undefined,returned=false;
 try{
  bytes=Buffer.from(await blobs.getBounded(job.object_key,receipt.original.bytes,signal));
  display=Buffer.from(await blobs.getBounded(job.approved_key,receipt.display.bytes,signal));
  if(bytes.length!==receipt.original.bytes||sha256(bytes)!==receipt.original.sha256||display.length!==receipt.display.bytes||sha256(display)!==receipt.display.sha256)return unavailable();
  signal?.throwIfAborted();returned=true;return {grant,bytes,head,custody};
 }catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='BLOB_CLEANUP_UNCERTAIN')throw new NativeDetailDrainUncertain();
  throw error;
 }finally{display?.fill(0);if(!returned)bytes?.fill(0);}
}
type Grant=Awaited<ReturnType<typeof checkedSource>>['grant']&{featureReport:Awaited<ReturnType<typeof inspectAdoptedModelDetail>>};
const lockKey=(s:Session,input:RequiredModelOriginalApproval)=>`required-model-original:${s.tenantId}:${input.artworkId}:${input.artworkRevision}`;
async function savedGrants(c:PoolClient,s:Session,grant:Awaited<ReturnType<typeof checkedSource>>['grant']){
 return (await c.query(`SELECT asset_id,metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL
  AND metadata->>'kind'=$2 AND metadata->>'exhibitionId'=$3 AND metadata->>'artworkRevisionId'=$4 LIMIT 2 FOR SHARE`,
 [s.tenantId,requiredModelOriginalGrantKind,grant.exhibitionId,grant.artworkRevisionId])).rows;
}
function verifiedGrant(rows:{asset_id:string;metadata:Grant}[],grant:Awaited<ReturnType<typeof checkedSource>>['grant']){
 const row=rows[0];
 if(rows.length!==1||!row||row.asset_id!==grant.originalAssetId||!row.metadata||typeof row.metadata!=='object')return unavailable();
 const {featureReport,...saved}=row.metadata;
 if(!isDeepStrictEqual(saved,grant)||!featureReport||featureReport.assetSha256!==grant.original.sha256||featureReport.assetBytes!==grant.original.bytes||featureReport.media?.kind!=='glb')return unavailable();
 return row.metadata;
}
export async function approveRequiredModelOriginal(c:PoolClient,s:Session,exhibitionId:string,input:RequiredModelOriginalApproval,match:string,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs,undefined,match);
 try{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey(s,input)]);
  const prior=await savedGrants(c,s,source.grant);
  let approved:Grant;
  if(prior.length)approved=verifiedGrant(prior,source.grant);
  else{
   approved={...source.grant,featureReport:await inspectAdoptedModelDetail(source.bytes,source.grant.original)};
   await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,randomUUID(),approved.originalAssetId,approved]);
  }
  return {version:1,approved:true,exhibitionId,...source.head,custody:source.custody,approvalSha256:modelReceiptDigest(approved)};
 }finally{source.bytes.fill(0);}
}
export async function readRequiredModelOriginalApproval(c:PoolClient,s:Session,exhibitionId:string,input:RequiredModelOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs);
 try{
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lockKey(s,input)]);
  const rows=await savedGrants(c,s,source.grant),grant=rows.length?verifiedGrant(rows,source.grant):undefined;
  return {version:1,approved:!!grant,exhibitionId,...source.head,custody:source.custody,approvalSha256:grant?modelReceiptDigest(grant):null};
 }finally{source.bytes.fill(0);}
}
export async function readApprovedRequiredModelOriginal(c:PoolClient,s:Session,exhibitionId:string,input:RequiredModelOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal:AbortSignal){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs,signal);let returned=false;
 try{
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lockKey(s,input)]);
  const grant=verifiedGrant(await savedGrants(c,s,source.grant),source.grant);signal.throwIfAborted();returned=true;return {grant,bytes:source.bytes};
 }finally{if(!returned)source.bytes.fill(0);}
}
