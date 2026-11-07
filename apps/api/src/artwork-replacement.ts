// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {Cms,validMetadata} from './cms.ts';
import {Imports} from './imports.ts';
import {storedImageCoarse} from './image-coarse-intent.ts';
import {allowedRights} from './rights.ts';
import {artworkReplacementSnapshot} from './artwork-replacement-snapshot.ts';
import {Studio,etag,insertStudioReceipt,type StudioResponse} from './studio.ts';

export interface ArtworkReplacementInput {requestId:string;artworkId:string;artworkRevision:number;importJobId:string}
/** Must run inside the authenticated native request's single DB transaction.
 * No caller-supplied asset identifiers, keys, hashes or snapshots are trusted. */
export async function replaceApprovedArtwork(c:PoolClient,s:Session,exhibitionId:string,input:ArtworkReplacementInput,match:string,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore):Promise<StudioResponse>{
 if(!input||Object.keys(input).sort().join(',')!=='artworkId,artworkRevision,importJobId,requestId'||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1)throw new ApiError(400,'INVALID_INPUT');
 for(const id of [exhibitionId,input.artworkId,input.importJobId,input.requestId])uuid(id);
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 const row=await studio.access(c,s,exhibitionId);if(row.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 const requestHash=createHash('sha256').update(JSON.stringify(['replace-approved-artwork-v1',s.tenantId,s.userId,owner.workspaceId,exhibitionId,input.requestId,input.artworkId,input.artworkRevision,input.importJobId,match])).digest('hex');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${s.userId}:${input.requestId}`]);
 const receipt=await c.query('SELECT * FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId]);
 if(receipt.rowCount){if(receipt.rows[0].payload_sha256!==requestHash||receipt.rows[0].exhibition_id!==exhibitionId)throw new ApiError(409,'REQUEST_CONFLICT');return receipt.rows[0].response as StudioResponse;}
 if(etag(row.revision,row.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');
 const job=await imports.access(c,s,input.importJobId),coarse=storedImageCoarse(job);
 if(!coarse||job.user_id!==s.userId||job.artwork_id!==input.artworkId||coarse.intent.artworkRevision!==input.artworkRevision||job.state!=='approved'||job.lease_id!=null||job.png_drain_version!==1||!Array.isArray(job.png_worker_tokens)||job.png_worker_tokens.length!==0||!coarse.assetId||typeof job.asset_id!=='string'||typeof job.original_asset_id!=='string')throw new ApiError(409,'COARSE_JOB_NOT_READY');
 const artwork=await cms.ownArtwork(c,s,input.artworkId);
 if(artwork.revision!==input.artworkRevision||artwork.approved_revision!==input.artworkRevision||!validMetadata(artwork.metadata)||!isDeepStrictEqual(artwork.metadata.rights,job.rights)||!allowedRights(job.rights,'display')||!allowedRights(job.rights,'export'))throw new ApiError(409,'ARTWORK_REPLACEMENT_STALE');
 const {artwork:prior}=await cms.studioArtwork(c,s,input.artworkId);
 const rows=(await c.query("SELECT a.*,r.metadata AS rights,r.revision AS rights_revision FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,input.artworkId,[job.original_asset_id,job.asset_id,coarse.assetId]])).rows;
 const original=rows.find(x=>x.id===job.original_asset_id),primary=rows.find(x=>x.id===job.asset_id),low=rows.find(x=>x.id===coarse.assetId),derived=job.derived as {sha256:string;bytes:number;recipe:unknown};
 if(rows.length!==3||!original||!primary||!low||original.state!=='quarantine'||primary.state!=='approved'||low.state!=='approved'||original.sha256!==job.expected_hash||Number(original.bytes)!==Number(job.expected_bytes)||original.object_key!==job.object_key||original.mime!=='image/jpeg'||primary.sha256!==derived.sha256||Number(primary.bytes)!==derived.bytes||primary.mime!=='image/png'||primary.object_key!==job.approved_key||low.sha256!==coarse.sha256||Number(low.bytes)!==coarse.bytes||low.mime!=='image/png'||low.object_key!==coarse.stageKey||rows.some(x=>!isDeepStrictEqual(x.rights,job.rights)||!allowedRights(x.rights,'display')||!allowedRights(x.rights,'export')))throw new ApiError(409,'ASSET_INTEGRITY');
 const preparation=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='image-preparation'",[s.tenantId,job.original_asset_id])).rows;
 if(preparation.length!==1||!isDeepStrictEqual(preparation[0].metadata,{version:1,kind:'image-preparation',originalAssetId:job.original_asset_id,derivedAssetId:job.asset_id,original:{mime:job.mime,sha256:job.expected_hash,bytes:Number(job.expected_bytes)},derived:{mime:'image/png',sha256:derived.sha256,bytes:derived.bytes},recipe:derived.recipe,provenance:'client-declared'}))throw new ApiError(409,'COARSE_STATE_INVALID');
 const binding=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='viewer-image-coarse' AND metadata->>'sourceJobId'=$3",[s.tenantId,job.asset_id,input.importJobId])).rows;
 if(binding.length!==1||!isDeepStrictEqual(binding[0].metadata,{version:1,kind:'viewer-image-coarse',sourceJobId:job.id,primaryAssetId:job.asset_id,primarySha256:derived.sha256,coarseAssetId:coarse.assetId,objectKey:coarse.stageKey,sha256:coarse.sha256,bytes:coarse.bytes,width:512,height:408,profile:'viewer-png-box-512-v1',provenance:'server-generated'}))throw new ApiError(409,'COARSE_STATE_INVALID');
 if(!blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
 const read=async(key:string,size:number,expected:string)=>{let b:Buffer;try{b=Buffer.from(await blobs.getBounded!(key,size));}catch(error){if(error instanceof Error&&(error.message==='object size mismatch'||'code' in error&&error.code==='ENOENT'))throw new ApiError(409,'ASSET_INTEGRITY');throw new ApiError(503,'STORAGE_UNAVAILABLE');}if(b.length!==size||sha256(b)!==expected)throw new ApiError(409,'ASSET_INTEGRITY');return b;};
 await read(original.object_key,Number(original.bytes),original.sha256);const full=await read(primary.object_key,Number(primary.bytes),primary.sha256),reduced=await read(low.object_key,Number(low.bytes),low.sha256);
 const now=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at as Date,revision=artwork.revision+1;
 const next=artworkReplacementSnapshot(prior,{tenantId:s.tenantId,revisionId:randomUUID(),at:now.toISOString(),primaryId:job.asset_id,coarseId:coarse.assetId,intent:coarse.intent,originalSha256:job.expected_hash,primary:full,coarse:reduced});
 const updated=await c.query('UPDATE artworks SET revision=$3,approved_revision=$3,approved_asset_id=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND revision=$6 AND approved_revision=$6 RETURNING id',[s.tenantId,input.artworkId,revision,job.asset_id,now,input.artworkRevision]);if(!updated.rowCount)throw new ApiError(409,'REVISION_CONFLICT');
 await c.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,$3,$4)',[s.tenantId,input.artworkId,revision,artwork.metadata]);
 await c.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,$3,$4,$5)',[s.tenantId,input.artworkId,revision,job.asset_id,{metadata:artwork.metadata,asset:{id:job.asset_id,sha256:primary.sha256,bytes:Number(primary.bytes),mime:primary.mime,rightsRevision:primary.rights_revision},importedArtwork:next}]);
 const verified=await cms.studioArtwork(c,s,input.artworkId);if(!isDeepStrictEqual(verified.artwork,next))throw new ApiError(409,'APPROVAL_INVALID');
 const response=await studio.putArtworkReplacement(c,s,exhibitionId,prior,next,randomUUID(),match);
 await insertStudioReceipt(c,[s.tenantId,s.userId,input.requestId,requestHash,exhibitionId,response]);
 return response;
}
