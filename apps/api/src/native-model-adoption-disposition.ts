// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {ApiError} from './api-error.ts';
import type {Session} from './auth.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {insertStudioReceipt,type Studio,type StudioResponse} from './studio.ts';

export type NativeModelAdoptionDisposition=
 |{outcome:'unresolved'}
 |{outcome:'cancelled'}
 |{outcome:'committed';response:StudioResponse};
const cancelledKind='native-model-adoption-cancelled-v1';

/** Commit and terminal disposition must take this exact transaction lock before
 * reading or creating the operation receipt. Native mutations use READ COMMITTED. */
export async function lockNativeModelAdoptionOperation(c:PoolClient,s:Session,operationId:string){
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:${s.userId}:${operationId}`]);
}

/** Absence remains unresolved; a durable cancellation is an explicit fence. */
export async function readNativeModelAdoptionDisposition(c:PoolClient,s:Session,operationId:string,grantSha256:string,exhibitionId?:string):Promise<NativeModelAdoptionDisposition>{
 const receipt=await c.query('SELECT payload_sha256,exhibition_id,response FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,operationId]);
 if(!receipt.rowCount)return {outcome:'unresolved'};
 const row=receipt.rows[0];
 if(row.payload_sha256!==modelReceiptDigest(['native-model-adoption-v1',grantSha256])||
    exhibitionId!==undefined&&row.exhibition_id!==exhibitionId)throw new ApiError(409,'REQUEST_CONFLICT');
 const response=row.response;
 if(response?.kind===cancelledKind){
  if(response.grantSha256!==grantSha256||response.exhibitionId!==row.exhibition_id)throw new ApiError(409,'REQUEST_CONFLICT');
  return {outcome:'cancelled'};
 }
 return {outcome:'committed',response:response as StudioResponse};
}

/** Establish a terminal outcome without recovering a grant or touching staging.
 * The authenticated target owner can fence an unused operation key; a matching
 * committed receipt wins and can never be replaced by cancellation. */
export async function disposeNativeModelAdoptionTarget(c:PoolClient,s:Session,input:{operationId:string;grantSha256:string;exhibitionId:string},studio:Studio){
 const {operationId,grantSha256,exhibitionId}=input;
 await lockNativeModelAdoptionOperation(c,s,operationId);
 const prior=await readNativeModelAdoptionDisposition(c,s,operationId,grantSha256,exhibitionId);
 if(prior.outcome!=='unresolved')return prior;
 const exhibition=await studio.access(c,s,exhibitionId);
 if(exhibition.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
 await insertStudioReceipt(c,[s.tenantId,s.userId,operationId,modelReceiptDigest(['native-model-adoption-v1',grantSha256]),exhibitionId,
  {kind:cancelledKind,grantSha256,exhibitionId}]);
 return {outcome:'cancelled'} as const;
}
