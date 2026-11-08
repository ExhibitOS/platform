// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {verifiedParsedDetailQuality,type DetailCandidate} from '@exhibitos/studio-contract';
import {ApiError,type Session} from './auth.ts';
import {readApprovedOriginalStaticSource} from './artwork-original-static-approval.ts';
import {detailSourceCommitment} from './detail-source-commitment.ts';
import type {Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';

const id=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,digest=/^[a-f0-9]{64}$/;
const keys=['version','kind','workspaceId','tenantId','principalId','publicationId','revisionSha256','artworkId','artworkRevision','importJobId','candidate','nonce','grant'];
const unavailable=():never=>{throw new ApiError(409,'NATIVE_DETAIL_UNAVAILABLE');};
type Scope={workspaceId:string;publicationId:string;revisionSha256:string;exhibitionId:string;artworkId:string;artworkRevision:number;importJobId:string;candidate:DetailCandidate};

/** Private source-binding verification, not a publication or decoder authority.
 * The caller must hold the live native owner/session and READ COMMITTED policy
 * locks, verify publication state and derive the candidate from its immutable
 * revision. Writers must hold the matching exclusive advisory lock below. A
 * separate registered inspector/device model must admit the bytes.
 * No route or producer invokes this primitive yet. */
export async function readBoundOriginalDetail(c:PoolClient,s:Session,scope:Scope,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal:AbortSignal){
 signal.throwIfAborted();try{scope=structuredClone(scope);s={...s};}catch{return unavailable();}
 if(!scope||![scope.workspaceId,scope.publicationId,scope.exhibitionId,scope.artworkId,scope.importJobId,s.tenantId,s.userId].every(v=>typeof v==='string'&&id.test(v))||!digest.test(scope.revisionSha256)||!Number.isSafeInteger(scope.artworkRevision)||scope.artworkRevision<1)unavailable();
 const relation=await verifiedParsedDetailQuality({version:1,candidates:[scope.candidate]},'image');signal.throwIfAborted();if(!relation||relation.candidates.length!==1||relation.candidates[0]!.tier!=='acquired-original')return unavailable();
 const candidate=relation.candidates[0]!,source=await readApprovedOriginalStaticSource(c,s,scope.exhibitionId,{artworkId:scope.artworkId,artworkRevision:scope.artworkRevision,importJobId:scope.importJobId},studio,cms,imports,blobs,signal);
 let returned=false;try{const grant=source.grant;if(grant.workspaceId!==scope.workspaceId||grant.source.sha256!==candidate.sha256||grant.source.bytes!==candidate.bytes||grant.source.mime!==candidate.mime)unavailable();
 await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[`native-detail-binding:${s.tenantId}:${scope.publicationId}:${candidate.assetId}`]);signal.throwIfAborted();
 const rows=(await c.query("SELECT asset_id,metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'='native-original-detail-binding' AND metadata->>'publicationId'=$2 AND metadata->'candidate'->>'assetId'=$3 LIMIT 2 FOR SHARE",[s.tenantId,scope.publicationId,candidate.assetId])).rows;
 signal.throwIfAborted();if(rows.length!==1||rows[0].asset_id!==grant.originalAssetId)unavailable();const record=rows[0].metadata as Record<string,unknown>;
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==keys.length||!keys.every(k=>Object.hasOwn(record,k))||record.version!==1||record.kind!=='native-original-detail-binding'||record.workspaceId!==scope.workspaceId||record.tenantId!==s.tenantId||record.principalId!==s.userId||record.publicationId!==scope.publicationId||record.revisionSha256!==scope.revisionSha256||record.artworkId!==scope.artworkId||record.artworkRevision!==scope.artworkRevision||record.importJobId!==scope.importJobId||!isDeepStrictEqual(record.candidate,candidate)||!isDeepStrictEqual(record.grant,grant)||typeof record.nonce!=='string')unavailable();
 let binding:string;try{binding=detailSourceCommitment({version:1,artworkRevisionId:grant.artworkRevisionId,candidateId:candidate.candidateId,assetId:candidate.assetId,tier:candidate.tier,sha256:candidate.sha256,bytes:candidate.bytes,mime:candidate.mime,featureReportSha256:candidate.featureReportSha256,rightsEvidenceSha256:grant.rightsEvidenceSha256,nonce:record.nonce as string});}catch{return unavailable();}
 if(binding!==candidate.sourceBindingSha256)unavailable();signal.throwIfAborted();returned=true;return {bytes:source.bytes,grant};}finally{if(!returned)source.bytes.fill(0);}
}
