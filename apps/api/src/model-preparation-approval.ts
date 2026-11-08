// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import {modelPreparationSupported,assertModelPreparationContext} from './model-preparation-import.ts';
import {modelPreparationDrained,modelPreparationReceipt} from './model-preparation-intent.ts';
/** Only this required-profile asset gets the additional existing-job guard. */
export async function assertRequiredModelApproval(c:PoolClient,s:Session,artworkId:string,assetId:string){
 if(!await modelPreparationSupported(c))return;
 // Cms.approve already holds the artwork row lock. A different asset cannot
 // bypass its current required intake while preparation or review is pending.
 const competing=await c.query("SELECT j.id FROM import_jobs j JOIN artworks a ON (a.tenant_id,a.id)=(j.tenant_id,j.artwork_id) WHERE j.tenant_id=$1 AND j.artwork_id=$2 AND j.model_preparation->'request'->>'artworkRevision'=a.revision::text AND j.asset_id IS DISTINCT FROM $3::uuid AND (j.state NOT IN ('failed','cancelled') OR j.lease_id IS NOT NULL OR cardinality(j.png_worker_tokens)>0) LIMIT 1",[s.tenantId,artworkId,assetId]);
 if(competing.rowCount)throw new ApiError(409,'MODEL_PREPARATION_ACTIVE_IMPORT');
 const jobs=(await c.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND asset_id=$3 AND model_preparation IS NOT NULL FOR SHARE',[s.tenantId,artworkId,assetId])).rows;
 if(!jobs.length)return;if(jobs.length!==1)throw new ApiError(409,'MODEL_PREPARATION_RECEIPT_INVALID');const row=jobs[0];
 if(row.user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');if(row.state!=='approved'||!modelPreparationDrained(row))throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');
 await assertModelPreparationContext(c,row);modelPreparationReceipt(row);
}
