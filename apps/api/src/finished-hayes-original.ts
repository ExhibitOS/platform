// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {confirmedHayesReleaseBindings,sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {isHayesReleaseContext} from './hayes-original-attempt.ts';
import {matchHayesDispositionReceipt,parseHayesDispositionReceipt} from './hayes-disposition-receipt.ts';
import {allowedRights} from './rights.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {inspectAdoptedModelDetail} from './adopted-model-detail-report.ts';
import {NativeDetailDrainUncertain} from './native-detail-drain.ts';
import {isIssuedNativeDetailContext,type NativeDetailContext} from './native-detail-context.ts';
import {etag,type Studio} from './studio.ts';

export const FINISHED_HAYES_ORIGINAL_PROFILE='finished-hayes-custody-v1';
export const finishedHayesOriginalGrantKind='finished-hayes-original-static-grant';
export interface FinishedHayesOriginalApproval {
 kind:typeof FINISHED_HAYES_ORIGINAL_PROFILE;
 artworkId:string;
 artworkRevision:number;
 importJobId:string;
 attemptId:string;
 receiptId:string;
 receiptSha256:string;
 completionFrameSha256:string;
}
const unavailable=():never=>{throw new ApiError(409,'FINISHED_HAYES_ORIGINAL_UNAVAILABLE');};
// The occupied r215 export may read this one existing owner/exhibition/release binding.
const occupiedSelectedBinding='4c98b2cf37830d9bd9629e360a388fc24a7c0fca25db14153258a11f4b6e17cd';
export function matchesOccupiedFinishedHayesBinding(context:NativeDetailContext,s:Session,exhibitionId:string,input:unknown){
 const {workspaceId,tenantId,principalId}=context.owner;
 return isIssuedNativeDetailContext(context)&&!!context.selectedHead&&context.live()&&tenantId===s.tenantId&&principalId===s.userId&&
  !!input&&typeof input==='object'&&modelReceiptDigest({workspaceId,tenantId,principalId,exhibitionId,input})===occupiedSelectedBinding;
}
const digest=/^[a-f0-9]{64}$/;
const mime='model/gltf-binary' as const;
const inputKeys=['kind','artworkId','artworkRevision','importJobId','attemptId','receiptId','receiptSha256','completionFrameSha256'];
function checkedInput(input:FinishedHayesOriginalApproval){
 if(!input||Object.keys(input).length!==inputKeys.length||!inputKeys.every(key=>Object.hasOwn(input,key))||
    input.kind!==FINISHED_HAYES_ORIGINAL_PROFILE||!Number.isSafeInteger(input.artworkRevision)||input.artworkRevision<1||
    input.artworkRevision>2147483647||!digest.test(input.receiptSha256)||!digest.test(input.completionFrameSha256))throw new ApiError(400,'INVALID_INPUT');
 for(const id of [input.artworkId,input.importJobId,input.attemptId,input.receiptId])uuid(id);
}

/** Classify from the current approved primary before choosing a source lane.
 * A failed Hayes verification never falls through to another custody source. */
export async function resolveFinishedHayesCandidate(c:PoolClient,s:Session,artworkId:string,revision:number,cms:Cms,imports:Imports){
 uuid(artworkId);
 if(!Number.isSafeInteger(revision)||revision<1||revision>2147483647)throw new ApiError(400,'INVALID_INPUT');
 const current=await cms.ownArtwork(c,s,artworkId);
 if(current.revision!==revision||current.approved_revision!==revision||!current.approved_asset_id)return unavailable();
 if(!isHayesReleaseContext(imports.nativeWorkspace))return null;
 const candidates=(await c.query(`SELECT id FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND asset_id=$3
   AND hayes_attempt_id IS NOT NULL LIMIT 2`,[s.tenantId,artworkId,current.approved_asset_id])).rows;
 if(!candidates.length)return null;
 if(candidates.length!==1)return unavailable();
 const source=await resolveFinishedHayesSource(c,s,artworkId,revision,String(candidates[0].id),cms,imports);
 return {...imports.view(source.job),finishedHayesCustody:source.custody};
}

async function resolveFinishedHayesSource(c:PoolClient,s:Session,artworkId:string,revision:number,jobId:string,cms:Cms,imports:Imports,
 historical?:NativeDetailContext){
 const owner=await imports.coarseOwner(c,s.tenantId,s.userId);
 if(historical ? owner.workspaceId!==historical.owner.workspaceId : !isHayesReleaseContext(owner))return unavailable();
 await owner.assertDatabase(c);
 const current=await cms.ownArtwork(c,s,artworkId),{artwork}=await cms.studioArtwork(c,s,artworkId);
 // The selected historical reader has no intake capability. Read only the existing approved row for this owner and artwork.
 const job=historical?(await c.query(`SELECT * FROM import_jobs
  WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND artwork_id=$4 AND state='approved' FOR SHARE`,
  [s.tenantId,jobId,s.userId,artworkId])).rows[0]:await imports.access(c,s,jobId);
 if(!job||job.gpu_preparation!=null||current.revision!==revision||current.approved_revision!==revision||artwork.revision!==revision||artwork.artworkType!=='sculpture'||
    current.approved_asset_id!==artwork.primaryAssetId||job.user_id!==s.userId||job.artwork_id!==artworkId||
    job.state!=='approved'||job.asset_id!==artwork.primaryAssetId||!job.hayes_attempt_id||!job.hayes_disposition_id||
    !isDeepStrictEqual(job.rights,artwork.rights))return unavailable();
 if(artwork.rights.expiresAt!==undefined||!(['display','export','download'] as const).every(permission=>allowedRights(artwork.rights,permission)))throw new ApiError(403,'ORIGINAL_STATIC_RIGHTS_DENIED');
 const releases=(await c.query(`SELECT r.*,d.receipt_canonical,d.original_asset_id,d.display_asset_id,d.derivative_id,d.attestation,
   a.artwork_id AS source_artwork_id,a.artwork_revision AS source_artwork_revision,a.source_sha256,a.source_bytes,
   st.object_key AS output_key,st.output_sha256,st.output_bytes
   FROM hayes_native_releases r
   JOIN hayes_original_dispositions d ON (d.tenant_id,d.id,d.attempt_id,d.job_id,d.stage_id)=(r.tenant_id,r.disposition_id,r.attempt_id,r.job_id,r.stage_id)
   JOIN hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(r.tenant_id,r.attempt_id,r.job_id)
   JOIN hayes_output_stages st ON (st.tenant_id,st.id,st.attempt_id,st.job_id)=(r.tenant_id,r.stage_id,r.attempt_id,r.job_id)
   WHERE r.tenant_id=$1 AND r.job_id=$2 FOR SHARE OF r,d,a,st`,[s.tenantId,jobId])).rows;
 if(releases.length!==1)return unavailable();
 const release=releases[0];
 if(release.attempt_id!==job.hayes_attempt_id||release.disposition_id!==job.hayes_disposition_id||
    release.source_artwork_id!==artworkId||release.source_artwork_revision!==revision||
    release.display_asset_id!==job.asset_id||release.output_key!==job.approved_key||
    release.source_sha256!==job.expected_hash||Number(release.source_bytes)!==Number(job.expected_bytes)||
    !digest.test(release.receipt_sha256)||!digest.test(release.completion_frame_sha256))return unavailable();
 const bindings=await confirmedHayesReleaseBindings(c,s.tenantId,{workspaceId:owner.workspaceId,principalId:s.userId,
  jobId,completionFrameSha256:release.completion_frame_sha256});
 if(!bindings.has(`import_jobs:${s.tenantId}:${jobId}`)||!bindings.has(`hayes_output_stages:${s.tenantId}:${release.stage_id}`))return unavailable();
 const canonical=Buffer.from(release.receipt_canonical);
 let parsed:ReturnType<typeof parseHayesDispositionReceipt>;
 try{parsed=parseHayesDispositionReceipt(canonical);}catch{return unavailable();}
 const binding=parsed.value.binding as {workspaceId:string;principalId:string;artworkId:string;artworkRevision:number;jobId:string;attemptId:string;tenantId:string};
 if(binding.workspaceId!==owner.workspaceId||binding.principalId!==s.userId||binding.tenantId!==s.tenantId||
    binding.artworkId!==artworkId||binding.artworkRevision!==revision||binding.jobId!==jobId||binding.attemptId!==release.attempt_id)return unavailable();
 try{matchHayesDispositionReceipt(canonical,{receiptId:release.disposition_id,binding:parsed.value.binding,nativeOwnerId:release.native_owner_id,
  runtimeManifestSha256:release.runtime_manifest_sha256,workerManifestSha256:release.worker_manifest_sha256,
  nativeEvidenceSha256:release.native_evidence_sha256,attestation:release.attestation,dbStageId:release.stage_id,
  originalAssetId:release.original_asset_id,displayAssetId:release.display_asset_id,derivativeId:release.derivative_id,
  database:{systemIdentifier:release.database_system_identifier,databaseOid:release.database_oid},
  output:{sha256:release.output_sha256,bytes:Number(release.output_bytes)},receiptSha256:release.receipt_sha256});}catch{return unavailable();}
 const assets=(await c.query(`SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id)
   WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND r.deleted_at IS NULL
   FOR SHARE OF a,r`,[s.tenantId,artworkId,[release.original_asset_id,release.display_asset_id]])).rows;
 const original=assets.find(asset=>asset.id===release.original_asset_id),display=assets.find(asset=>asset.id===release.display_asset_id);
 const primary=artwork.assets.find(asset=>asset.id===artwork.primaryAssetId);
 if(assets.length!==2||!original||!display||!primary||original.id===display.id||original.state!=='quarantine'||display.state!=='approved'||
    assets.some(asset=>asset.mime!==mime||asset.object_key!==asset.target_key||!isDeepStrictEqual(asset.rights,artwork.rights))||
    original.object_key!==job.object_key||original.sha256!==release.source_sha256||Number(original.bytes)!==Number(release.source_bytes)||
    display.object_key!==job.approved_key||display.sha256!==release.output_sha256||Number(display.bytes)!==Number(release.output_bytes)||
    primary.sha256!==display.sha256||primary.bytes!==Number(display.bytes))return unavailable();
 const derivative=(await c.query('SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 AND deleted_at IS NULL FOR SHARE',
  [s.tenantId,release.derivative_id,original.id])).rows;
 const expected={version:1,kind:'hayes-original-display-v1',originalAssetId:original.id,displayAssetId:display.id,attemptId:release.attempt_id,
  sourceSha256:original.sha256,sourceBytes:Number(original.bytes),outputSha256:display.sha256,outputBytes:Number(display.bytes),
  recipe:{kind:'native-hayes-generate-validate-v1',workerManifestSha256:release.worker_manifest_sha256},receiptSha256:release.receipt_sha256};
 if(derivative.length!==1||!isDeepStrictEqual(derivative[0].metadata,expected))return unavailable();
 const describe=(asset:typeof original)=>({assetId:String(asset.id),sha256:String(asset.sha256),bytes:Number(asset.bytes),mime});
 const custody={version:1 as const,kind:FINISHED_HAYES_ORIGINAL_PROFILE,workspaceId:owner.workspaceId,tenantId:s.tenantId,principalId:s.userId,
  artworkId,artworkRevision:revision,artworkRevisionId:artwork.revisionId,importJobId:jobId,
  release:{attemptId:String(release.attempt_id),receiptId:String(release.disposition_id),receiptSha256:String(release.receipt_sha256),completionFrameSha256:String(release.completion_frame_sha256)},
  original:describe(original),display:describe(display),rightsSha256:modelReceiptDigest(artwork.rights)};
 for(const asset of [custody.original,custody.display])if(!digest.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<28||asset.bytes>25*1024*1024)return unavailable();
 await owner.assertDatabase(c);
 return {owner,job,artwork,custody};
}

async function checkedSource(c:PoolClient,s:Session,exhibitionId:string,input:FinishedHayesOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal?:AbortSignal,match?:string,
 historical?:NativeDetailContext){
 checkedInput(input);uuid(exhibitionId);signal?.throwIfAborted();
 if(historical&&!matchesOccupiedFinishedHayesBinding(historical,s,exhibitionId,input))return unavailable();
 const exhibition=await studio.access(c,s,exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 const head={revision:exhibition.revision,etag:etag(exhibition.revision,exhibition.metadata)};
 if(match!==undefined&&match!==head.etag)throw new ApiError(412,'REMOTE_CONFLICT');
 if(historical&&(head.revision!==historical.selectedHead?.revision||head.etag!==historical.selectedHead?.etag))return unavailable();
 const source=await resolveFinishedHayesSource(c,s,input.artworkId,input.artworkRevision,input.importJobId,cms,imports,historical);
 const {custody}=source;
 if(!isDeepStrictEqual(custody.release,{attemptId:input.attemptId,receiptId:input.receiptId,receiptSha256:input.receiptSha256,completionFrameSha256:input.completionFrameSha256})||
    !exhibition.metadata.candidate.artworks.some((artwork:unknown)=>isDeepStrictEqual(artwork,source.artwork)))return unavailable();
 if(!blobs.getBounded)return unavailable();
 const grant={version:1 as const,kind:finishedHayesOriginalGrantKind,workspaceId:custody.workspaceId,tenantId:s.tenantId,principalId:s.userId,
  exhibitionId,input:structuredClone(input),artworkRevisionId:custody.artworkRevisionId,originalAssetId:custody.original.assetId,
  displayAssetId:custody.display.assetId,original:{sha256:custody.original.sha256,bytes:custody.original.bytes},
  display:{sha256:custody.display.sha256,bytes:custody.display.bytes},rightsSha256:custody.rightsSha256,release:custody.release};
 let bytes:Buffer|undefined,display:Buffer|undefined,returned=false;
 try{
  bytes=Buffer.from(await blobs.getBounded(source.job.object_key,custody.original.bytes,signal));
  display=Buffer.from(await blobs.getBounded(source.job.approved_key,custody.display.bytes,signal));
  if(bytes.length!==custody.original.bytes||sha256(bytes)!==custody.original.sha256||display.length!==custody.display.bytes||sha256(display)!==custody.display.sha256)return unavailable();
  signal?.throwIfAborted();await source.owner.assertDatabase(c);
  if(historical&&!historical.live())return unavailable();
  returned=true;return {grant,bytes,head,custody};
 }catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='BLOB_CLEANUP_UNCERTAIN')throw new NativeDetailDrainUncertain();
  throw error;
 }finally{display?.fill(0);if(!returned)bytes?.fill(0);}
}
type Grant=Awaited<ReturnType<typeof checkedSource>>['grant']&{featureReport:Awaited<ReturnType<typeof inspectAdoptedModelDetail>>};
const lockKey=(s:Session,input:FinishedHayesOriginalApproval)=>`finished-hayes-original:${s.tenantId}:${input.artworkId}:${input.artworkRevision}:${input.importJobId}`;
async function storedGrants(c:PoolClient,s:Session,grant:Awaited<ReturnType<typeof checkedSource>>['grant']){
 return (await c.query(`SELECT asset_id,metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL AND metadata->>'kind'=$2
  AND metadata->>'exhibitionId'=$3 AND metadata->>'artworkRevisionId'=$4 LIMIT 2 FOR SHARE`,
 [s.tenantId,finishedHayesOriginalGrantKind,grant.exhibitionId,grant.artworkRevisionId])).rows;
}
function verifiedGrant(rows:{asset_id:string;metadata:Grant}[],grant:Awaited<ReturnType<typeof checkedSource>>['grant']){
 const row=rows[0];if(rows.length!==1||!row||row.asset_id!==grant.originalAssetId)return unavailable();
 const {featureReport,...stored}=row.metadata;
 if(!isDeepStrictEqual(stored,grant)||!featureReport||featureReport.assetSha256!==grant.original.sha256||featureReport.assetBytes!==grant.original.bytes||featureReport.media?.kind!=='glb')return unavailable();
 return row.metadata;
}
export async function approveFinishedHayesOriginal(c:PoolClient,s:Session,exhibitionId:string,input:FinishedHayesOriginalApproval,match:string,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs,undefined,match);
 try{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey(s,input)]);
  const prior=await storedGrants(c,s,source.grant);
  const approved=prior.length?verifiedGrant(prior,source.grant):{...source.grant,featureReport:await inspectAdoptedModelDetail(source.bytes,source.grant.original)};
  if(!prior.length)await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[s.tenantId,randomUUID(),approved.originalAssetId,approved]);
  return {version:1,approved:true,exhibitionId,...source.head,custody:source.custody,approvalSha256:modelReceiptDigest(approved)};
 }finally{source.bytes.fill(0);}
}
export async function readFinishedHayesOriginalApproval(c:PoolClient,s:Session,exhibitionId:string,input:FinishedHayesOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs);
 try{
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lockKey(s,input)]);
  const rows=await storedGrants(c,s,source.grant),grant=rows.length?verifiedGrant(rows,source.grant):undefined;
  return {version:1,approved:!!grant,exhibitionId,...source.head,custody:source.custody,approvalSha256:grant?modelReceiptDigest(grant):null};
 }finally{source.bytes.fill(0);}
}
export async function readApprovedFinishedHayesOriginal(c:PoolClient,s:Session,exhibitionId:string,input:FinishedHayesOriginalApproval,studio:Studio,cms:Cms,imports:Imports,blobs:BlobStore,signal:AbortSignal,context?:NativeDetailContext){
 const source=await checkedSource(c,s,exhibitionId,input,studio,cms,imports,blobs,signal,undefined,context?.selectedHead?context:undefined);let returned=false;
 try{
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lockKey(s,input)]);
  const grant=verifiedGrant(await storedGrants(c,s,source.grant),source.grant);signal.throwIfAborted();returned=true;return {grant,bytes:source.bytes};
 }finally{if(!returned)source.bytes.fill(0);}
}
