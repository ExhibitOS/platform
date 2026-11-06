// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {ApiError,uuid,type Session} from './auth.ts';
import {planWorkspaceMaterialImportSource} from './workspace-material-import-source.ts';

/** Inactive draft.12 inventory writer. The caller must bind manifest, scene
 * and packedPaths to the verified archive and exact owned worker ACK, hold the
 * Session/claim/lease/fence throughout, use its dedicated transaction, commit
 * this result before any blob write, and retain evidence on uncertain commits.
 * This function is not an owner claim, byte validation, drain or attachment. */
export async function recordWorkspaceMaterialImportInventory(c:PoolClient,s:Session,input:{jobId:string;leaseId:string;attemptId:string;manifest:OexWorkspaceMaterialManifest;scene:{extensions?:Record<string,unknown>;surfaces?:unknown};packedPaths:readonly string[]}){
 s=structuredClone(s);input=structuredClone(input);
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
 for(const id of [s.tenantId,s.userId,input.jobId,input.leaseId,input.attemptId]){uuid(id);if(id!==id.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 const paths=input.packedPaths;
 if(!Array.isArray(paths)||paths.length<1||paths.length>254||paths.some(path=>typeof path!=='string'||path.length<1||Buffer.byteLength(path)>1024)||new Set(paths).size!==paths.length)throw new ApiError(400,'INVALID_INPUT');
 const keys=paths.map(()=>`${s.tenantId}/oex-import/${input.jobId}/${input.attemptId}/${randomUUID()}`);
 if(new Set(keys).size!==keys.length)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 const sourceKeys=new Map(paths.map((path,index)=>[path,keys[index]!]));
 const stage=planWorkspaceMaterialImportSource({tenantId:s.tenantId,jobId:input.jobId,attemptId:input.attemptId,manifest:input.manifest,scene:input.scene,sourceKeys});
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.oex_inventory_probe',$1,true)",[probe]);
 const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.oex_inventory_probe',true) AS probe")).rows[0];
 if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
 const updated=await c.query("UPDATE oex_import_jobs SET cleanup_keys=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND lease_id=$4 AND lease_until>clock_timestamp() AND state='processing' AND archive_profile='bounded-file-v1' AND oex_format='1.0.0-draft.12' AND cleanup_keys='[]'::jsonb AND NOT cleanup_pending RETURNING id",[s.tenantId,input.jobId,s.userId,input.leaseId,JSON.stringify(keys)]);
 if(updated.rowCount!==1||updated.rows[0]?.id!==input.jobId)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 for(const entry of stage)await c.query('INSERT INTO workspace_material_import_stage (tenant_id,user_id,import_job_id,attempt_id,lease_id,source_material_id,source_material_version,role,source_path,sha256,bytes,object_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[s.tenantId,s.userId,input.jobId,input.attemptId,input.leaseId,entry.sourceMaterialId,entry.sourceMaterialVersion,entry.role,entry.sourcePath,entry.sha256,entry.bytes,entry.objectKey]);
 return {sourceKeys,stage};
}
