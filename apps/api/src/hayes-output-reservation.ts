// SPDX-License-Identifier: AGPL-3.0-or-later
import {Auth,ApiError} from './auth.ts';
import type {BlobStore} from '@exhibitos/storage';
import {revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
import {resolveHayesReady} from './hayes-ready-authority.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

/** Reserve and commit the attempt-scoped destination before requesting any
 * output bytes. Admission is limited to the authenticated private caller. */
export async function reserveHayesOutput(input:{admission:unknown;auth:Auth;owner:NativeOexWorkspaceContext;blobs:BlobStore;token:string|undefined;csrf:string|undefined}){
 const {admission,auth,owner,blobs,token,csrf}=input;
 if(!(auth instanceof Auth)||!blobs.getBounded)throw new ApiError(403,'FORBIDDEN');
 const ready=resolveHayesReady(admission,owner,blobs),binding=parseHayesOperationBinding(ready.binding),{signal,deadlineMs,dbStageId}=ready;
 if(ready.phase!=='ready')throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
 const output=ready.attestation.output as {sha256?:unknown;bytes?:unknown}|undefined;
 if(!output||typeof output.sha256!=='string'||!/^[a-f0-9]{64}$/.test(output.sha256)||!Number.isSafeInteger(output.bytes)||Number(output.bytes)<1||Number(output.bytes)>16777216)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');
 const outputSha=output.sha256,outputBytes=Number(output.bytes),objectKey=`${binding.tenantId}/hayes-output/${binding.attemptId}/${outputSha}`;
 const live=async()=>{signal.throwIfAborted();await ready.assertLive();signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
 return auth.requestForHayesNativeMutation(token,binding.tenantId,csrf,{signal,deadlineMs},async(c,s)=>{
  if(s.userId!==binding.principalId)throw new ApiError(403,'FORBIDDEN');
  await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
  const physical=(await c.query("SELECT (pg_control_system()).system_identifier::text AS system_identifier,oid::text AS database_oid FROM pg_database WHERE datname=current_database()")).rows;
  if(physical.length!==1||physical[0].system_identifier!==ready.database.systemIdentifier||physical[0].database_oid!==ready.database.databaseOid)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  await c.query('INSERT INTO hayes_output_stages(tenant_id,id,attempt_id,job_id,output_sha256,output_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[binding.tenantId,dbStageId,binding.attemptId,binding.jobId,outputSha,outputBytes,objectKey]);
  const found=await c.query('SELECT id,attempt_id,job_id,output_sha256,output_bytes,object_key FROM hayes_output_stages WHERE tenant_id=$1 AND attempt_id=$2 FOR SHARE',[binding.tenantId,binding.attemptId]);const row=found.rows[0];
  if(found.rowCount!==1||row.id!==dbStageId||row.job_id!==binding.jobId||row.output_sha256!==outputSha||Number(row.output_bytes)!==outputBytes||row.object_key!==objectKey)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');
  await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
  signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
  return {stageId:dbStageId,sha256:outputSha,bytes:outputBytes};
 });
}
