// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {Cms} from './cms.ts';
import {Imports} from './imports.ts';
import {storedImageCoarse} from './image-coarse-intent.ts';
import {Studio} from './studio.ts';
import {originalStaticGrant} from './original-static-grant.ts';

export interface OriginalStaticApprovalInput {artworkId:string;artworkRevision:number;importJobId:string}

/** A new private record for an existing current revision; never rewrites an
 * approval, changes an artwork, exposes quarantine or qualifies a decoder. */
export async function approveOriginalStaticSource(c:PoolClient,s:Session,exhibitionId:string,input:OriginalStaticApprovalInput,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore){
 if(!input||Object.keys(input).sort().join(',')!=='artworkId,artworkRevision,importJobId'||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1)throw new ApiError(400,'INVALID_INPUT');
 for(const id of [exhibitionId,input.artworkId,input.importJobId])uuid(id);
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId),exhibition=await studio.access(c,s,exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 const candidate=exhibition.metadata?.candidate;
 if(!candidate||!Array.isArray(candidate.artworks)||!candidate.artworks.some((a:{id?:string;revision?:number})=>a.id===input.artworkId&&a.revision===input.artworkRevision))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
 const artwork=await cms.ownArtwork(c,s,input.artworkId),approved=await cms.studioArtwork(c,s,input.artworkId);
 if(artwork.revision!==input.artworkRevision||artwork.approved_revision!==input.artworkRevision||approved.artwork.revision!==input.artworkRevision||!candidate.artworks.some((item:unknown)=>isDeepStrictEqual(item,approved.artwork)))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
 const job=await imports.access(c,s,input.importJobId),coarse=storedImageCoarse(job);
 if(!coarse||job.user_id!==s.userId||job.artwork_id!==input.artworkId||job.state!=='approved'||job.lease_id!=null||job.png_drain_version!==1||!Array.isArray(job.png_worker_tokens)||job.png_worker_tokens.length!==0||typeof job.original_asset_id!=='string'||typeof job.asset_id!=='string'||approved.artwork.primaryAssetId!==job.asset_id||!isDeepStrictEqual(approved.artwork.rights,job.rights))throw new ApiError(409,'ORIGINAL_SOURCE_UNAVAILABLE');
 const rows=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,input.artworkId,[job.original_asset_id,job.asset_id]])).rows;
 const original=rows.find(x=>x.id===job.original_asset_id),primary=rows.find(x=>x.id===job.asset_id),derived=job.derived as {sha256:string;bytes:number;recipe:unknown};
 if(rows.length!==2||!original||!primary||!derived||original.state!=='quarantine'||primary.state!=='approved'||original.sha256!==job.expected_hash||Number(original.bytes)!==Number(job.expected_bytes)||original.object_key!==job.object_key||original.mime!==job.mime||primary.sha256!==derived.sha256||Number(primary.bytes)!==derived.bytes||primary.object_key!==job.approved_key||primary.mime!=='image/png'||rows.some(x=>!isDeepStrictEqual(x.rights,job.rights)))throw new ApiError(409,'ORIGINAL_SOURCE_UNAVAILABLE');
 const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='image-preparation'",[s.tenantId,job.original_asset_id])).rows;
 if(lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:'image-preparation',originalAssetId:job.original_asset_id,derivedAssetId:job.asset_id,original:{mime:job.mime,sha256:job.expected_hash,bytes:Number(job.expected_bytes)},derived:{mime:'image/png',sha256:derived.sha256,bytes:derived.bytes},recipe:derived.recipe,provenance:'client-declared'}))throw new ApiError(409,'ORIGINAL_SOURCE_UNAVAILABLE');
 const grantInput={approvalId:coarse.intent.approvalId,workspaceId:owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,artworkId:input.artworkId,artworkRevision:input.artworkRevision,artworkRevisionId:approved.artwork.revisionId,jobId:job.id,originalAssetId:job.original_asset_id,primaryAssetId:job.asset_id,sha256:original.sha256,bytes:Number(original.bytes),mime:original.mime,rights:original.rights};
 if(!originalStaticGrant(grantInput))throw new ApiError(403,'ORIGINAL_STATIC_RIGHTS_DENIED');
 if(!blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
 const bytes=Buffer.from(await blobs.getBounded(original.object_key,Number(original.bytes)));
 if(bytes.length!==Number(original.bytes)||sha256(bytes)!==original.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 const grant=originalStaticGrant(grantInput);
 if(!grant)throw new ApiError(403,'ORIGINAL_STATIC_RIGHTS_DENIED');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`original-static:${s.tenantId}:${input.artworkId}:${input.artworkRevision}:${job.id}`]);
 const prior=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='exact-original-static-grant' AND metadata->>'artworkRevisionId'=$3",[s.tenantId,job.original_asset_id,approved.artwork.revisionId])).rows;
 if(prior.length>1||prior.length===1&&!isDeepStrictEqual(prior[0].metadata,grant))throw new ApiError(409,'ORIGINAL_STATIC_APPROVAL_CONFLICT');
 if(!prior.length)await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,randomUUID(),job.original_asset_id,grant]);
 return {approved:true,artworkId:input.artworkId,artworkRevision:input.artworkRevision};
}
