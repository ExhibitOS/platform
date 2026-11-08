// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {Auth,ApiError} from './auth.ts';
import {allowedRights} from './rights.ts';
import {decodeHayesReleaseCompletion} from './hayes-release-completion-frame.ts';
import {resolveHayesReady} from './hayes-ready-authority.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

/** Called only by the original selected caller after reading its authenticated
 * channel. A canonical frame or a DB row alone is not an issuer capability. */
export async function recordHayesReleaseCompletion(input:{admission:unknown;auth:Auth;owner:NativeOexWorkspaceContext;blobs:BlobStore;token:string|undefined;csrf:string|undefined;frame:Uint8Array}){
 const {admission,auth,owner,blobs,token,csrf}=input;if(!(auth instanceof Auth))throw new ApiError(403,'FORBIDDEN');
 const scope=resolveHayesReady(admission,owner,blobs),release=scope.release;if(scope.phase!=='committed'||!release)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
 const frame=decodeHayesReleaseCompletion(input.frame,{binding:scope.binding,nativeOwnerId:scope.nativeOwnerId,runtimeManifestSha256:scope.runtimeManifestSha256,workerManifestSha256:scope.workerManifestSha256,nativeEvidenceSha256:scope.nativeEvidenceSha256,readyFrameSha256:release.readyFrameSha256,dbStageId:scope.dbStageId,database:scope.database,challenge:release.challenge,receiptId:release.receiptId,receiptSha256:release.receiptSha256});
 const canonical=Buffer.from(frame.canonical),frameSha=sha256(canonical),b=scope.binding,{signal,deadlineMs}=scope;
 const live=async()=>{signal.throwIfAborted();await scope.assertLive();signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==scope)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
 return auth.requestForHayesNativeMutation(token,b.tenantId,csrf,{signal,deadlineMs},async(c,s)=>{
  if(s.userId!==b.principalId||owner.tenantId!==b.tenantId||owner.workspaceId!==b.workspaceId||owner.principalId!==b.principalId)throw new ApiError(403,'FORBIDDEN');
  await owner.assertDatabase(c);await live();
  const current=await c.query("SELECT j.rights,w.metadata AS artwork_metadata FROM import_jobs j JOIN artworks w ON (w.tenant_id,w.id)=(j.tenant_id,j.artwork_id) JOIN hayes_original_dispositions d ON (d.tenant_id,d.id,d.attempt_id,d.job_id)=(j.tenant_id,j.hayes_disposition_id,j.hayes_attempt_id,j.id) WHERE j.tenant_id=$1 AND j.id=$2 AND j.state='approved' AND j.lease_id=$3 AND j.lease_until>clock_timestamp() AND d.id=$4 AND d.stage_id=$5 AND w.deleted_at IS NULL AND w.revision=$6 FOR SHARE OF j,w",[b.tenantId,b.jobId,b.leaseId,release.receiptId,scope.dbStageId,b.artworkRevision]);
  if(current.rowCount!==1||!isDeepStrictEqual(current.rows[0].rights,current.rows[0].artwork_metadata?.rights)||!allowedRights(current.rows[0].rights,'display')||!allowedRights(current.rows[0].rights,'export')||!allowedRights(current.rows[0].artwork_metadata?.rights,'display')||!allowedRights(current.rows[0].artwork_metadata?.rights,'export'))throw new ApiError(409,'HAYES_SOURCE_CHANGED');
  const existing=await c.query('SELECT completion_canonical,completion_frame_sha256 FROM hayes_native_releases WHERE tenant_id=$1 AND attempt_id=$2 FOR SHARE',[b.tenantId,b.attemptId]);
  if(existing.rowCount){if(existing.rowCount!==1||existing.rows[0].completion_frame_sha256!==frameSha||!Buffer.from(existing.rows[0].completion_canonical).equals(canonical))throw new ApiError(409,'HAYES_RELEASE_CONFLICT');}
  else await c.query('INSERT INTO hayes_native_releases(tenant_id,attempt_id,job_id,disposition_id,stage_id,native_owner_id,runtime_manifest_sha256,worker_manifest_sha256,native_evidence_sha256,ready_frame_sha256,database_system_identifier,database_oid,challenge,receipt_sha256,intent_sha256,completion_sha256,completion_canonical,completion_frame_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',[b.tenantId,b.attemptId,b.jobId,release.receiptId,scope.dbStageId,scope.nativeOwnerId,scope.runtimeManifestSha256,scope.workerManifestSha256,scope.nativeEvidenceSha256,release.readyFrameSha256,scope.database.systemIdentifier,scope.database.databaseOid,release.challenge,release.receiptSha256,frame.intentSha256,frame.completionSha256,canonical,frameSha]);
  await owner.assertDatabase(c);await live();signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==scope)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  return {attemptId:b.attemptId,completionFrameSha256:frameSha};
 });
}
