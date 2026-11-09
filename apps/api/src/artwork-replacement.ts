// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {Cms,validMetadata} from './cms.ts';
import {Imports} from './imports.ts';
import {storedImageCoarse} from './image-coarse-intent.ts';
import {modelPreparationDrained,modelPreparationReceipt,storedModelPreparation} from './model-preparation-intent.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {allowedRights} from './rights.ts';
import {artworkReplacementSnapshot,productImageReplacementSnapshot} from './artwork-replacement-snapshot.ts';
import {storedProductImage,productImageReceipt,productImageDrained} from './product-image-intent.ts';
import {Studio,etag,insertStudioReceipt,type Draft,type StudioResponse} from './studio.ts';

interface ReviewedImageReplacement {requestId:string;artworkId:string;artworkRevision:number;importJobId:string}
interface ApprovedModelCandidateReplacement extends ReviewedImageReplacement {kind:'approved-model-candidate-v1';placementId:string}
export type ArtworkReplacementInput=ReviewedImageReplacement|ApprovedModelCandidateReplacement;
/** Must run inside the authenticated native request's single DB transaction.
 * No caller-supplied asset identifiers, keys, hashes or snapshots are trusted. */
export async function replaceApprovedArtwork(c:PoolClient,s:Session,exhibitionId:string,input:ArtworkReplacementInput,match:string,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore):Promise<StudioResponse>{
 const model=input&&typeof input==='object'&&'kind' in input&&input.kind==='approved-model-candidate-v1'?input:undefined;
 const keys=model?'artworkId,artworkRevision,importJobId,kind,placementId,requestId':'artworkId,artworkRevision,importJobId,requestId';
 if(!input||Object.keys(input).sort().join(',')!==keys||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1)throw new ApiError(400,'INVALID_INPUT');
 for(const id of [exhibitionId,input.artworkId,input.importJobId,input.requestId])uuid(id);
 if(model){uuid(model.placementId);await imports.requiredModelReady(c,s);}
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 const row=await studio.access(c,s,exhibitionId);if(row.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 const requestHash=createHash('sha256').update(JSON.stringify([model?.kind??'replace-approved-artwork-v1',s.tenantId,s.userId,owner.workspaceId,exhibitionId,input.requestId,input.artworkId,input.artworkRevision,input.importJobId,match,...(model?[model.placementId]:[])])).digest('hex');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${s.userId}:${input.requestId}`]);
 const receipt=await c.query('SELECT * FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId]);
 if(receipt.rowCount){if(receipt.rows[0].payload_sha256!==requestHash||receipt.rows[0].exhibition_id!==exhibitionId)throw new ApiError(409,'REQUEST_CONFLICT');return receipt.rows[0].response as StudioResponse;}
 if(etag(row.revision,row.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');
 if(model){
  const response=await replaceModelCandidate(c,s,exhibitionId,model,match,(row.metadata as Draft).candidate,studio,cms,imports,blobs);
  await insertStudioReceipt(c,[s.tenantId,s.userId,input.requestId,requestHash,exhibitionId,response]);
  return response;
 }
 // The image worker locks artwork before job; replacement uses that order too.
 const artwork=await cms.ownArtwork(c,s,input.artworkId);
 const job=await imports.access(c,s,input.importJobId);
 const product=storedProductImage(job);
 if(product){
  if(job.user_id!==s.userId||job.artwork_id!==input.artworkId||product.request.artworkRevision!==input.artworkRevision||job.state!=='approved'||!productImageDrained(job))throw new ApiError(409,'IMAGE_PREPARATION_JOB_NOT_READY');
  const receipt=productImageReceipt(job);
  assertImageReplacementCurrent(artwork,input,job.rights);
  const {artwork:prior}=await cms.studioArtwork(c,s,input.artworkId);
  const {rows:[primary]}=await c.query(
   "SELECT r.revision AS rights_revision FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",
   [s.tenantId,input.artworkId,receipt.full.assetId],
  );
  if(!primary)throw new ApiError(409,'ASSET_INTEGRITY');
  await readReplacementAsset(blobs,job.object_key,receipt.original.bytes,receipt.original.sha256);
  await readReplacementAsset(blobs,job.approved_key,receipt.full.bytes,receipt.full.sha256);
  if(receipt.coarse)await readReplacementAsset(blobs,`${s.tenantId}/quarantine/import-${job.id}/product-coarse`,receipt.coarse.bytes,receipt.coarse.sha256);
  if(!allowedRights(job.rights,'display')||!allowedRights(job.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
  const now=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at as Date;
  const next=productImageReplacementSnapshot(prior,receipt,{tenantId:s.tenantId,revisionId:randomUUID(),at:now.toISOString()});
  const response=await commitImageReplacement(c,s,exhibitionId,input,match,studio,cms,artwork,prior,next,now,{...receipt.full,rightsRevision:primary.rights_revision});
  await insertStudioReceipt(c,[s.tenantId,s.userId,input.requestId,requestHash,exhibitionId,response]);
  return response;
 }
 const coarse=storedImageCoarse(job);
 if(!coarse||job.user_id!==s.userId||job.artwork_id!==input.artworkId||coarse.intent.artworkRevision!==input.artworkRevision||job.state!=='approved'||job.lease_id!=null||job.png_drain_version!==1||!Array.isArray(job.png_worker_tokens)||job.png_worker_tokens.length!==0||!coarse.assetId||typeof job.asset_id!=='string'||typeof job.original_asset_id!=='string')throw new ApiError(409,'COARSE_JOB_NOT_READY');
 assertImageReplacementCurrent(artwork,input,job.rights);
 const {artwork:prior}=await cms.studioArtwork(c,s,input.artworkId);
 const rows=(await c.query("SELECT a.*,r.metadata AS rights,r.revision AS rights_revision FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,input.artworkId,[job.original_asset_id,job.asset_id,coarse.assetId]])).rows;
 const original=rows.find(x=>x.id===job.original_asset_id),primary=rows.find(x=>x.id===job.asset_id),low=rows.find(x=>x.id===coarse.assetId),derived=job.derived as {sha256:string;bytes:number;recipe:unknown};
 if(rows.length!==3||!original||!primary||!low||original.state!=='quarantine'||primary.state!=='approved'||low.state!=='approved'||original.sha256!==job.expected_hash||Number(original.bytes)!==Number(job.expected_bytes)||original.object_key!==job.object_key||original.mime!=='image/jpeg'||primary.sha256!==derived.sha256||Number(primary.bytes)!==derived.bytes||primary.mime!=='image/png'||primary.object_key!==job.approved_key||low.sha256!==coarse.sha256||Number(low.bytes)!==coarse.bytes||low.mime!=='image/png'||low.object_key!==coarse.stageKey||rows.some(x=>!isDeepStrictEqual(x.rights,job.rights)||!allowedRights(x.rights,'display')||!allowedRights(x.rights,'export')))throw new ApiError(409,'ASSET_INTEGRITY');
 const preparation=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='image-preparation'",[s.tenantId,job.original_asset_id])).rows;
 if(preparation.length!==1||!isDeepStrictEqual(preparation[0].metadata,{version:1,kind:'image-preparation',originalAssetId:job.original_asset_id,derivedAssetId:job.asset_id,original:{mime:job.mime,sha256:job.expected_hash,bytes:Number(job.expected_bytes)},derived:{mime:'image/png',sha256:derived.sha256,bytes:derived.bytes},recipe:derived.recipe,provenance:'client-declared'}))throw new ApiError(409,'COARSE_STATE_INVALID');
 const binding=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='viewer-image-coarse' AND metadata->>'sourceJobId'=$3",[s.tenantId,job.asset_id,input.importJobId])).rows;
 if(binding.length!==1||!isDeepStrictEqual(binding[0].metadata,{version:1,kind:'viewer-image-coarse',sourceJobId:job.id,primaryAssetId:job.asset_id,primarySha256:derived.sha256,coarseAssetId:coarse.assetId,objectKey:coarse.stageKey,sha256:coarse.sha256,bytes:coarse.bytes,width:512,height:408,profile:'viewer-png-box-512-v1',provenance:'server-generated'}))throw new ApiError(409,'COARSE_STATE_INVALID');
 await readReplacementAsset(blobs,original.object_key,Number(original.bytes),original.sha256);const full=await readReplacementAsset(blobs,primary.object_key,Number(primary.bytes),primary.sha256),reduced=await readReplacementAsset(blobs,low.object_key,Number(low.bytes),low.sha256);
 if(!allowedRights(job.rights,'display')||!allowedRights(job.rights,'export')||rows.some(x=>!allowedRights(x.rights,'display')||!allowedRights(x.rights,'export')))throw new ApiError(403,'RIGHTS_DENIED');
 const now=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at as Date;
 const next=artworkReplacementSnapshot(prior,{tenantId:s.tenantId,revisionId:randomUUID(),at:now.toISOString(),primaryId:job.asset_id,coarseId:coarse.assetId,intent:coarse.intent,originalSha256:job.expected_hash,primary:full,coarse:reduced});
 const response=await commitImageReplacement(c,s,exhibitionId,input,match,studio,cms,artwork,prior,next,now,{
  assetId:job.asset_id,sha256:primary.sha256,bytes:Number(primary.bytes),mime:primary.mime,rightsRevision:primary.rights_revision,
 });
 await insertStudioReceipt(c,[s.tenantId,s.userId,input.requestId,requestHash,exhibitionId,response]);
 return response;
}

function assertImageReplacementCurrent(artwork:Awaited<ReturnType<Cms['ownArtwork']>>,input:ReviewedImageReplacement,rights:unknown){
 if(artwork.revision!==input.artworkRevision||artwork.approved_revision!==input.artworkRevision||!validMetadata(artwork.metadata)||!isDeepStrictEqual(artwork.metadata.rights,rights)||!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
}

async function commitImageReplacement(c:PoolClient,s:Session,exhibitionId:string,input:ReviewedImageReplacement,match:string,studio:Studio,cms:Cms,artwork:Awaited<ReturnType<Cms['ownArtwork']>>,prior:Awaited<ReturnType<Cms['studioArtwork']>>['artwork'],next:typeof prior,now:Date,primary:{assetId:string;sha256:string;bytes:number;mime:string;rightsRevision:number}){
 const revision=artwork.revision+1;
 const updated=await c.query('UPDATE artworks SET revision=$3,approved_revision=$3,approved_asset_id=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND revision=$6 AND approved_revision=$6 RETURNING id',[s.tenantId,input.artworkId,revision,primary.assetId,now,input.artworkRevision]);
 if(!updated.rowCount)throw new ApiError(409,'REVISION_CONFLICT');
 await c.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,$3,$4)',[s.tenantId,input.artworkId,revision,artwork.metadata]);
 const asset={id:primary.assetId,sha256:primary.sha256,bytes:primary.bytes,mime:primary.mime,rightsRevision:primary.rightsRevision};
 await c.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,$3,$4,$5)',[s.tenantId,input.artworkId,revision,primary.assetId,{metadata:artwork.metadata,asset,importedArtwork:next}]);
 const verified=await cms.studioArtwork(c,s,input.artworkId);
 if(!isDeepStrictEqual(verified.artwork,next))throw new ApiError(409,'APPROVAL_INVALID');
 return studio.putArtworkReplacement(c,s,exhibitionId,prior,next,randomUUID(),match);
}

/** Use the already approved candidate as-is. CMS approval and original custody
 * belong to the candidate artwork and are independent of this placement save. */
async function replaceModelCandidate(c:PoolClient,s:Session,exhibitionId:string,input:ApprovedModelCandidateReplacement,match:string,candidate:Draft['candidate'],studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore):Promise<StudioResponse>{
 const placement=candidate.placements.find(p=>p.id.toLowerCase()===input.placementId.toLowerCase());
 const old=placement&&candidate.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
 if(!old||old.artworkType!=='sculpture'||old.id.toLowerCase()===input.artworkId.toLowerCase())throw new ApiError(409,'ARTWORK_REPLACEMENT_INVALID');
 // CMS approval and import retry lock artwork before job. Acquire both artwork
 // rows in stable order so the selected CMS snapshots remain current to commit.
 const candidateId=input.artworkId.toLowerCase();
 const locked=new Map<string,Awaited<ReturnType<Cms['ownArtwork']>>>();
 for(const id of [old.id.toLowerCase(),candidateId].sort())locked.set(id,await cms.ownArtwork(c,s,id));
 const {job,next,display}=await checkedModelCandidate(c,s,{...input,artworkId:candidateId},locked.get(candidateId),cms,imports);
 const {artwork:prior}=await cms.studioArtwork(c,s,old.id);
 await readReplacementAsset(blobs,job.approved_key,display.bytes,display.sha256);
 if(!allowedRights(job.rights,'display')||!allowedRights(job.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
 return studio.putArtworkReplacement(c,s,exhibitionId,prior,next,randomUUID(),match,input.placementId);
}

/** Resolve the retained product receipt from the current CMS selection. A
 * finished upload transfer is deliberately not an input to this lookup. */
export async function resolveApprovedModelCandidate(c:PoolClient,s:Session,artworkId:string,artworkRevision:number,cms:Cms,imports:Imports){
 uuid(artworkId);
 if(!Number.isSafeInteger(artworkRevision)||artworkRevision<1)throw new ApiError(400,'INVALID_INPUT');
 artworkId=artworkId.toLowerCase();
 await imports.requiredModelReady(c,s);
 await imports.coarseOwner(c,s.tenantId,s.userId);
 const artwork=await cms.ownArtwork(c,s,artworkId);
 if(artwork.revision!==artworkRevision||artwork.approved_revision!==artworkRevision||!artwork.approved_asset_id)throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
 const {rows}=await c.query(`SELECT id FROM import_jobs WHERE tenant_id=$1 AND user_id=$2 AND artwork_id=$3 AND asset_id=$4
  AND model_preparation->'request'->>'artworkRevision'=$5 AND model_preparation->'request'->>'profileId'=$6
  AND (model_preparation->'request'->'sourceFull') IS NULL LIMIT 2`,
 [s.tenantId,s.userId,artworkId,artwork.approved_asset_id,String(artworkRevision),COMPACT_MODEL_RECIPE.id]);
 if(rows.length!==1)throw new ApiError(409,'MODEL_CANDIDATE_NOT_READY');
 const {job}=await checkedModelCandidate(c,s,{artworkId,artworkRevision,importJobId:rows[0].id},artwork,cms,imports);
 return imports.view(job);
}

async function checkedModelCandidate(c:PoolClient,s:Session,input:Pick<ReviewedImageReplacement,'artworkId'|'artworkRevision'|'importJobId'>,artwork:Awaited<ReturnType<Cms['ownArtwork']>>,cms:Cms,imports:Imports){
 const job=await imports.access(c,s,input.importJobId),intent=storedModelPreparation(job);
 if(!intent||intent.sourceFull!==undefined||intent.profileId!==COMPACT_MODEL_RECIPE.id||job.user_id!==s.userId||job.artwork_id!==input.artworkId||intent.artworkRevision!==input.artworkRevision||job.state!=='approved'||!modelPreparationDrained(job))throw new ApiError(409,'MODEL_CANDIDATE_NOT_READY');
 // Imports.access also revalidates current rights, original/display asset rows,
 // object-key linkage and immutable producer lineage for required-model jobs.
 const {display}=modelPreparationReceipt(job);
 if(!artwork||artwork.revision!==input.artworkRevision||artwork.approved_revision!==input.artworkRevision||artwork.approved_asset_id!==display.assetId)throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
 if(!allowedRights(job.rights,'display')||!allowedRights(job.rights,'export'))throw new ApiError(403,'RIGHTS_DENIED');
 const {artwork:next}=await cms.studioArtwork(c,s,input.artworkId);
 const primary=next.assets.find(asset=>asset.id===next.primaryAssetId);
 if(next.artworkType!=='sculpture'||next.primaryAssetId!==display.assetId||next.assets.length!==1||!primary||primary.mime!==display.mime||primary.sha256!==display.sha256||primary.bytes!==display.bytes||!isDeepStrictEqual(next.rights,job.rights))throw new ApiError(409,'ASSET_INTEGRITY');
 return {job,next,display};
}

async function readReplacementAsset(blobs:BlobStore,key:string,size:number,expected:string):Promise<Buffer>{
 if(!blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
 let bytes:Buffer;
 try{bytes=Buffer.from(await blobs.getBounded(key,size));}
 catch(error){
  if(error instanceof Error&&(error.message==='object size mismatch'||'code' in error&&error.code==='ENOENT'))throw new ApiError(409,'ASSET_INTEGRITY');
  throw new ApiError(503,'STORAGE_UNAVAILABLE');
 }
 if(bytes.length!==size||sha256(bytes)!==expected)throw new ApiError(409,'ASSET_INTEGRITY');
 return bytes;
}
