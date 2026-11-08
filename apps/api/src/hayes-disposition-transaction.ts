// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,Auth,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import {revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
import {matchHayesDispositionReceipt} from './hayes-disposition-receipt.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {resolveHayesReady} from './hayes-ready-authority.ts';

/** Private selected settlement only; commit is not a native custody release. */
export async function commitHayesDisposition(input:{admission:unknown;auth:Auth;owner:NativeOexWorkspaceContext;blobs:BlobStore;token:string|undefined;csrf:string|undefined;receiptId:string;originalAssetId:string;displayAssetId:string;derivativeId:string;rightsId:string}){
 const {admission,auth,owner,blobs,token,csrf,receiptId,originalAssetId,displayAssetId,derivativeId,rightsId}=input;
 if(!(auth instanceof Auth)||!blobs.getBounded)throw new ApiError(403,'FORBIDDEN');
 const ready=resolveHayesReady(admission,owner,blobs),b=parseHayesOperationBinding(ready.binding);
 if(ready.phase!=='copied')throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
 const {signal,deadlineMs,nativeOwnerId,runtimeManifestSha256,workerManifestSha256,nativeEvidenceSha256,attestation,dbStageId}=ready;
 if(owner.workspaceId!==b.workspaceId||owner.tenantId!==b.tenantId||owner.principalId!==b.principalId)throw new ApiError(403,'FORBIDDEN'); return auth.requestForHayesNativeMutation(token,b.tenantId,csrf,{signal,deadlineMs},async(c,s:Session)=>{
  if(s.userId!==b.principalId)throw new ApiError(403,'FORBIDDEN');
  const live=async()=>{signal.throwIfAborted();await ready.assertLive();signal.throwIfAborted();};
  await revalidateHayesOriginalAttempt(c,s,owner,blobs,b,live);
  const rows=await c.query("SELECT j.*,st.id AS stage_id,st.output_sha256,st.output_bytes,st.object_key AS output_key FROM import_jobs j JOIN hayes_output_stages st ON (st.tenant_id,st.attempt_id,st.job_id)=(j.tenant_id,j.hayes_attempt_id,j.id) WHERE j.tenant_id=$1 AND j.id=$2 AND st.id=$3 AND j.state='processing' AND j.lease_id=$4 AND j.lease_until>clock_timestamp() FOR UPDATE OF j,st",[b.tenantId,b.jobId,dbStageId,b.leaseId]);
  if(rows.rowCount!==1)throw new ApiError(409,'HAYES_SOURCE_CHANGED');const row=rows.rows[0];
  const artwork=(await c.query('SELECT revision,metadata FROM artworks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[b.tenantId,b.artworkId])).rows[0];
  const rights=row.rights,output={sha256:String(row.output_sha256),bytes:Number(row.output_bytes)};
  if(!artwork||artwork.revision!==b.artworkRevision||!isDeepStrictEqual(artwork.metadata?.rights,rights)||artwork.metadata?.displayReference?.status!=='provisional-uncalibrated'||artwork.metadata?.displayReference?.assetSha256!==output.sha256||!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
  let outputBytes:Uint8Array|undefined;try{outputBytes=await blobs.getBounded!(row.output_key,output.bytes,signal);if(outputBytes.length!==output.bytes||sha256(outputBytes)!==output.sha256)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');}finally{outputBytes?.fill(0);}
  const physical=(await c.query("SELECT (pg_control_system()).system_identifier::text AS system_identifier, oid::text AS database_oid FROM pg_database WHERE datname=current_database()")).rows;
  if(physical.length!==1)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  const database={systemIdentifier:physical[0].system_identifier,databaseOid:physical[0].database_oid};
  if(!isDeepStrictEqual(database,ready.database))throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  const receipt=Buffer.from(JSON.stringify({version:1,outcome:'committed',receiptId:receiptId,binding:b,nativeOwnerId:nativeOwnerId,runtimeManifestSha256:runtimeManifestSha256,workerManifestSha256:workerManifestSha256,nativeEvidenceSha256:nativeEvidenceSha256,attestation:attestation,dbStageId:dbStageId,originalAssetId:originalAssetId,displayAssetId:displayAssetId,derivativeId:derivativeId,database})),receiptSha256=sha256(receipt);
  matchHayesDispositionReceipt(receipt,{receiptId:receiptId,binding:b,nativeOwnerId:nativeOwnerId,runtimeManifestSha256:runtimeManifestSha256,workerManifestSha256:workerManifestSha256,nativeEvidenceSha256:nativeEvidenceSha256,attestation:attestation,dbStageId:dbStageId,originalAssetId:originalAssetId,displayAssetId:displayAssetId,derivativeId:derivativeId,database,output,receiptSha256});
  await owner.assertDatabase(c);await live();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  if(!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
  await c.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[b.tenantId,rightsId,rights]);
  await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'quarantine')",[b.tenantId,originalAssetId,b.artworkId,rightsId,row.object_key,b.sourceSha256,b.sourceBytes]);
  await c.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'model/gltf-binary',1,'approved')",[b.tenantId,displayAssetId,b.artworkId,rightsId,row.output_key,output.sha256,output.bytes]);
  await c.query('INSERT INTO asset_derivatives(tenant_id,id,asset_id,metadata) VALUES($1,$2,$3,$4)',[b.tenantId,derivativeId,originalAssetId,{version:1,kind:'hayes-original-display-v1',originalAssetId:originalAssetId,displayAssetId:displayAssetId,attemptId:b.attemptId,sourceSha256:b.sourceSha256,sourceBytes:b.sourceBytes,outputSha256:output.sha256,outputBytes:output.bytes,recipe:{kind:'native-hayes-generate-validate-v1',workerManifestSha256},receiptSha256}]);
  await c.query('INSERT INTO hayes_original_dispositions(tenant_id,id,attempt_id,job_id,stage_id,native_owner_id,database_system_identifier,database_oid,runtime_manifest_sha256,worker_manifest_sha256,native_evidence_sha256,attestation,receipt_canonical,receipt_sha256,original_asset_id,display_asset_id,derivative_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[b.tenantId,receiptId,b.attemptId,b.jobId,dbStageId,nativeOwnerId,database.systemIdentifier,database.databaseOid,runtimeManifestSha256,workerManifestSha256,nativeEvidenceSha256,attestation,receipt,receiptSha256,originalAssetId,displayAssetId,derivativeId]);
  const updated=await c.query("UPDATE import_jobs SET state='approved',progress=100,asset_id=$3,approved_key=$4,hayes_disposition_id=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='processing' AND lease_id=$6 AND hayes_attempt_id=$7 AND lease_until>clock_timestamp() RETURNING id",[b.tenantId,b.jobId,displayAssetId,row.output_key,receiptId,b.leaseId,b.attemptId]);
  if(updated.rowCount!==1||!allowedRights(rights,'display')||!allowedRights(rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
  signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  // No await or further SQL after the final mutation; Auth immediately fences
  // and commits its exclusively held client. COMMIT ambiguity retains custody.
  return {receiptId:receiptId,receiptSha256};
 });
}
