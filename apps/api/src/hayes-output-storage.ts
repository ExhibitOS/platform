// SPDX-License-Identifier: AGPL-3.0-or-later
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {Auth,ApiError} from './auth.ts';
import {revalidateHayesOriginalAttempt} from './hayes-original-attempt.ts';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
import {resolveHayesReady} from './hayes-ready-authority.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

/** Call only after an independently committed reservation and the
 * private reservation-ready exchange. Failure retains that reservation and
 * any durable bytes; neither rollback nor EOF proves disposal. */
export async function storeHayesOutput(input:{admission:unknown;auth:Auth;owner:NativeOexWorkspaceContext;blobs:FileBlobStore;token:string|undefined;csrf:string|undefined;bytes:Uint8Array}){
 const {admission,auth,owner,blobs,token,csrf}=input;
 if(!(auth instanceof Auth)||!(blobs instanceof FileBlobStore)||!(input.bytes instanceof Uint8Array)||input.bytes.byteLength<1||input.bytes.byteLength>16777216)throw new ApiError(403,'FORBIDDEN');
 const ready=resolveHayesReady(admission,owner,blobs),binding=parseHayesOperationBinding(ready.binding),{signal,deadlineMs,dbStageId}=ready;
 if(ready.phase!=='reserved')throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
 const output=ready.attestation.output as {sha256?:unknown;bytes?:unknown}|undefined;
 if(!output||typeof output.sha256!=='string'||!/^[a-f0-9]{64}$/.test(output.sha256)||!Number.isSafeInteger(output.bytes)||Number(output.bytes)<1||Number(output.bytes)>16777216)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');
 const expectedSha=output.sha256,expectedBytes=Number(output.bytes),objectKey=`${binding.tenantId}/hayes-output/${binding.attemptId}/${expectedSha}`,bytes=Buffer.from(input.bytes);
 try{
  if(bytes.length!==expectedBytes||sha256(bytes)!==expectedSha)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');
  const live=async()=>{signal.throwIfAborted();await ready.assertLive();signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');};
  return await auth.requestForHayesNativeMutation(token,binding.tenantId,csrf,{signal,deadlineMs},async(c,s)=>{
   if(s.userId!==binding.principalId)throw new ApiError(403,'FORBIDDEN');
   await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
   const physical=(await c.query("SELECT (pg_control_system()).system_identifier::text AS system_identifier,oid::text AS database_oid FROM pg_database WHERE datname=current_database()")).rows;
   if(physical.length!==1||physical[0].system_identifier!==ready.database.systemIdentifier||physical[0].database_oid!==ready.database.databaseOid)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
   const found=await c.query('SELECT id,job_id,output_sha256,output_bytes,object_key FROM hayes_output_stages WHERE tenant_id=$1 AND attempt_id=$2 FOR SHARE',[binding.tenantId,binding.attemptId]),row=found.rows[0];
   if(found.rowCount!==1||row.id!==dbStageId||row.job_id!==binding.jobId||row.output_sha256!==expectedSha||Number(row.output_bytes)!==expectedBytes||row.object_key!==objectKey)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');
   // putDurable cannot be aborted; cancellation during a write retains both
   // the reservation and any linked bytes and must not acknowledge success.
   await live();await blobs.putDurable(objectKey,bytes);
   const stored=await blobs.getBounded(objectKey,expectedBytes,signal);try{if(stored.length!==expectedBytes||sha256(stored)!==expectedSha)throw new ApiError(409,'HAYES_OUTPUT_CHANGED');}finally{stored.fill(0);}
   await revalidateHayesOriginalAttempt(c,s,owner,blobs,binding,live);
   signal.throwIfAborted();if(resolveHayesReady(admission,owner,blobs)!==ready)throw new ApiError(409,'HAYES_OWNER_UNAVAILABLE');
   return {stageId:dbStageId,sha256:expectedSha,bytes:expectedBytes};
  });
 }finally{bytes.fill(0);}
}
