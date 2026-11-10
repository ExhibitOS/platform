// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {nativeModelAdoptionRightsPolicyDigest,validNativeModelSourceCredit} from './native-model-adoption-grant.ts';
import {readNativeModelAdoptionReceipt} from './native-model-adoption-target.ts';
import {allowedRights} from './rights.ts';
import {etag,type Studio} from './studio.ts';
import {inspectAdoptedModelDetail} from './adopted-model-detail-report.ts';
import {NativeDetailDrainUncertain} from './native-detail-drain.ts';

export const ADOPTED_MODEL_ORIGINAL_APPROVAL='adopted-model-custody-v1';
export const adoptedModelOriginalGrantKind='adopted-model-original-static-grant';
const mime='model/gltf-binary';
const digest=/^[a-f0-9]{64}$/;
const unavailable=():never=>{throw new ApiError(409,'NATIVE_MODEL_ORIGINAL_UNAVAILABLE');};

export interface AdoptedModelOriginalApproval {
 kind:typeof ADOPTED_MODEL_ORIGINAL_APPROVAL;
 artworkId:string;
 artworkRevision:number;
 operationId:string;
 grantSha256:string;
}

async function checkedAdoptedOriginal(
 c:PoolClient,s:Session,exhibitionId:string,input:AdoptedModelOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,
 options:{match?:string;signal?:AbortSignal},
){
 const {signal,match}=options;
 signal?.throwIfAborted();
 if(!input||Object.keys(input).sort().join(',')!=='artworkId,artworkRevision,grantSha256,kind,operationId'||
    input.kind!==ADOPTED_MODEL_ORIGINAL_APPROVAL||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1||
    !digest.test(input.grantSha256))throw new ApiError(400,'INVALID_INPUT');
 for(const id of [exhibitionId,input.artworkId,input.operationId])uuid(id);
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 const exhibition=await studio.access(c,s,exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 if(match!==undefined&&etag(exhibition.revision,exhibition.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');
 const adoption=await readNativeModelAdoptionReceipt(c,s,input.operationId,input.grantSha256,exhibitionId);
 const current=await cms.ownArtwork(c,s,input.artworkId);
 const {artwork}=await cms.studioArtwork(c,s,input.artworkId);
 if(!adoption||artwork.artworkType!=='sculpture'||current.revision!==input.artworkRevision||current.approved_revision!==input.artworkRevision||
    artwork.revision!==input.artworkRevision||current.approved_asset_id!==artwork.primaryAssetId||
    !adoption.draft.candidate.artworks.some(item=>isDeepStrictEqual(item,artwork))||
    !exhibition.metadata.candidate.artworks.some((item:unknown)=>isDeepStrictEqual(item,artwork)))return unavailable();
 if(artwork.rights.expiresAt!==undefined||!(['download','display','export'] as const).every(permission=>allowedRights(artwork.rights,permission)))throw new ApiError(403,'ORIGINAL_STATIC_RIGHTS_DENIED');

 const records=(await c.query(`SELECT asset_id,metadata FROM asset_derivatives
   WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='native-model-adoption' AND metadata->>'operationId'=$2
   LIMIT 2 FOR SHARE`,[s.tenantId,input.operationId])).rows;
 const record=records[0]?.metadata;
 const rightsSha256=modelReceiptDigest(artwork.rights);
 if(records.length!==1||!record||record.version!==1||record.grantSha256!==input.grantSha256||
    !digest.test(record.receiptSha256)||record.originalId!==records[0].asset_id||record.displayId!==artwork.primaryAssetId||
    record.originalId===record.displayId||record.targetRightsSha256!==rightsSha256||
    record.rightsPolicySha256!==nativeModelAdoptionRightsPolicyDigest(artwork.rights))return unavailable();
 uuid(record.originalId);
 const sourceCreditLine=record.sourceCreditLine??(record.sourceRightsSha256===rightsSha256?artwork.rights.creditLine:undefined);
 if(!digest.test(record.sourceRightsSha256)||!validNativeModelSourceCredit(sourceCreditLine))return unavailable();

 const assets=(await c.query(`SELECT a.id,a.object_key,a.target_key,a.sha256,a.bytes,a.mime,a.state,r.metadata AS rights
   FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id)
   WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL
   FOR SHARE OF a,r`,[s.tenantId,artwork.id,[record.originalId,record.displayId]])).rows;
 const original=assets.find(item=>item.id===record.originalId),display=assets.find(item=>item.id===record.displayId);
 const primary=artwork.assets.find(item=>item.id===record.displayId);
 const expectedRoot=`${s.tenantId}/approved/model-adoption/${input.operationId}`;
 if(assets.length!==2||!original||!display||!primary||assets.some(item=>item.state!=='approved'||item.mime!==mime||item.object_key!==item.target_key||
    !isDeepStrictEqual(item.rights,artwork.rights))||original.object_key!==`${expectedRoot}/original.glb`||display.object_key!==`${expectedRoot}/display.glb`||
    primary.sha256!==display.sha256||primary.bytes!==Number(display.bytes))return unavailable();
 const identity={sha256:original.sha256 as string,bytes:Number(original.bytes)};
 if(!digest.test(identity.sha256)||!Number.isSafeInteger(identity.bytes)||identity.bytes<28||identity.bytes>25*1024*1024)return unavailable();

 const grant={version:1,kind:adoptedModelOriginalGrantKind,workspaceId:owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,
  exhibitionId,input,artworkRevisionId:artwork.revisionId,originalAssetId:original.id as string,displayAssetId:display.id as string,
  original:identity,display:{sha256:primary.sha256,bytes:primary.bytes},rightsSha256,sourceRightsSha256:record.sourceRightsSha256 as string,sourceCreditLine,receiptSha256:record.receiptSha256 as string};
 let bytes:Buffer|undefined,returned=false;
 try{
  signal?.throwIfAborted();
  if(!blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  const loaded=await blobs.getBounded(original.object_key,identity.bytes,signal);
  bytes=Buffer.isBuffer(loaded)?loaded:Buffer.from(loaded);
  if(bytes.length!==identity.bytes||sha256(bytes)!==identity.sha256)return unavailable();
  signal?.throwIfAborted();
  returned=true;
  return {grant,bytes};
 }catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='BLOB_CLEANUP_UNCERTAIN')throw new NativeDetailDrainUncertain();
  throw error;
 }finally{if(!returned)bytes?.fill(0);}
}

function lockKey(s:Session,input:AdoptedModelOriginalApproval){
 return `adopted-model-original-static:${s.tenantId}:${input.artworkId}:${input.artworkRevision}:${input.operationId}`;
}

export async function approveAdoptedModelOriginal(
 c:PoolClient,s:Session,exhibitionId:string,input:AdoptedModelOriginalApproval,match:string,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,
){
 const {grant,bytes}=await checkedAdoptedOriginal(c,s,exhibitionId,input,studio,cms,imports,blobs,{match});
 try{
  const featureReport=await inspectAdoptedModelDetail(bytes,grant.original);
  const approved={...grant,featureReport};
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey(s,input)]);
  const prior=(await c.query(`SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL
    AND metadata->>'kind'=$3 AND metadata->>'exhibitionId'=$4 AND metadata->>'artworkRevisionId'=$5 LIMIT 2`,
   [s.tenantId,grant.originalAssetId,adoptedModelOriginalGrantKind,exhibitionId,grant.artworkRevisionId])).rows;
  if(prior.length>1||prior.length===1&&!isDeepStrictEqual(prior[0].metadata,approved))throw new ApiError(409,'ORIGINAL_STATIC_APPROVAL_CONFLICT');
  if(!prior.length)await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',
   [s.tenantId,randomUUID(),grant.originalAssetId,approved]);
  return {approved:true,artworkId:input.artworkId,artworkRevision:input.artworkRevision};
 }finally{bytes.fill(0);}
}

export type ApprovedAdoptedModelOriginal=Awaited<ReturnType<typeof checkedAdoptedOriginal>>['grant']&{
 featureReport:Awaited<ReturnType<typeof inspectAdoptedModelDetail>>;
};

export async function readApprovedAdoptedModelOriginal(
 c:PoolClient,s:Session,exhibitionId:string,input:AdoptedModelOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal:AbortSignal,
){
 const {grant,bytes}=await checkedAdoptedOriginal(c,s,exhibitionId,input,studio,cms,imports,blobs,{signal});
 let returned=false;
 try{
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lockKey(s,input)]);
  const rows=(await c.query(`SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL
    AND metadata->>'kind'=$3 AND metadata->>'exhibitionId'=$4 AND metadata->>'artworkRevisionId'=$5 LIMIT 2 FOR SHARE`,
   [s.tenantId,grant.originalAssetId,adoptedModelOriginalGrantKind,exhibitionId,grant.artworkRevisionId])).rows;
  if(rows.length!==1||!rows[0].metadata||typeof rows[0].metadata!=='object')return unavailable();
  const {featureReport,...saved}=rows[0].metadata as ApprovedAdoptedModelOriginal;
  if(!isDeepStrictEqual(saved,grant)||!featureReport||featureReport.assetSha256!==grant.original.sha256||
    featureReport.assetBytes!==grant.original.bytes||featureReport.media.kind!=='glb')return unavailable();
  signal.throwIfAborted();
  returned=true;
  return {grant:{...grant,featureReport},bytes};
 }finally{if(!returned)bytes.fill(0);}
}
