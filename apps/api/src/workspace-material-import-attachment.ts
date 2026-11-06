// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {planWorkspaceMaterialImportSource} from './workspace-material-import-source.ts';

type Stage=ReturnType<typeof planWorkspaceMaterialImportSource>;
/** Inactive draft.12 attachment building block. Caller must hold the exact
 * owner/session/claim/lease/maintenance fences, have confirmed the committed
 * stage inventory, qualified and durably written every blob, and drained all
 * children. Use the same dedicated READ COMMITTED transaction for these rows,
 * the saved exhibition and complete job/provenance; rollback or discard on any
 * error. Deferred database constraints validate their relationship at commit.
 * This function cannot establish archive authority, bytes, drain or commit. */
export async function attachWorkspaceMaterialImportVersions(c:PoolClient,s:Session,input:{workspaceId:string;jobId:string;attemptId:string;leaseId:string;scene:{extensions?:Record<string,unknown>;surfaces?:unknown};idMap:Readonly<Record<string,string>>;stage:Stage}){
 s=structuredClone(s);input=structuredClone(input);
 if(!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
 for(const id of [s.tenantId,s.userId,input.workspaceId,input.jobId,input.attemptId,input.leaseId]){uuid(id);if(id!==id.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 const resources=workspaceMaterialOutputInventory(input.scene),bindings=input.scene.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings|undefined;
 if(!bindings||!Array.isArray(input.stage)||!input.stage.length||input.stage.length!==resources.length||input.stage.length!==bindings.materials.length||!input.idMap||typeof input.idMap!=='object')throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');
 const mappedIds=Object.values(input.idMap);if(new Set(mappedIds).size!==mappedIds.length)throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');
 for(const [from,to] of Object.entries(input.idMap)){try{uuid(from);uuid(to);}catch{throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');}if(from!==from.toLowerCase()||to!==to.toLowerCase())throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');}
 const allSourceIds=new Set(input.stage.map(item=>item.sourceMaterialId));
 const sourceIds=new Set<string>(),destinations=new Set<string>(),planned=input.stage.map(item=>{
  const source=`${item.sourceMaterialId}:${item.sourceMaterialVersion}`,destination=input.idMap[item.sourceMaterialId],material=bindings.materials.find(m=>m.id===destination&&m.version===item.sourceMaterialVersion);
  if(sourceIds.has(source)||typeof destination!=='string'||!material||item.role!=='color'||!isDeepStrictEqual(material.maps.color,item.descriptor)||item.sha256!==item.descriptor.sha256||item.bytes!==item.descriptor.bytes||!allowedRights(material.rights,'display')||!allowedRights(material.rights,'export'))throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');
  try{uuid(item.sourceMaterialId);uuid(destination);}catch{throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');}
  if(item.sourceMaterialId!==item.sourceMaterialId.toLowerCase()||destination!==destination.toLowerCase()||allSourceIds.has(destination)||destinations.has(`${destination}:${item.sourceMaterialVersion}`))throw new ApiError(422,'OEX_WORKSPACE_ATTACHMENT_INVALID');
  sourceIds.add(source);destinations.add(`${destination}:${item.sourceMaterialVersion}`);return {source:item,material};
 });
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.workspace_attach_probe',$1,true)",[probe]);
 const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.workspace_attach_probe',true) AS probe")).rows[0];
 if(tx?.isolation!=='read committed'||tx.probe!==probe)throw new ApiError(409,'OEX_TRANSACTION_UNSUPPORTED');
 const job=await c.query("SELECT id FROM oex_import_jobs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND lease_id=$4 AND lease_until>clock_timestamp() AND state='processing' AND archive_profile='bounded-file-v1' AND oex_format='1.0.0-draft.12' AND NOT cleanup_pending FOR UPDATE",[s.tenantId,input.jobId,s.userId,input.leaseId]);
 if(job.rowCount!==1||job.rows[0]?.id!==input.jobId)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 const rows=await c.query("SELECT source_material_id,source_material_version,role,source_path,sha256,bytes,object_key FROM workspace_material_import_stage WHERE tenant_id=$1 AND user_id=$2 AND import_job_id=$3 AND attempt_id=$4 AND lease_id=$5 AND stage_txid<>pg_current_xact_id() ORDER BY source_material_id,source_material_version,role",[s.tenantId,s.userId,input.jobId,input.attemptId,input.leaseId]);
 if(rows.rowCount!==planned.length)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');
 for(const {source} of planned){const row=rows.rows.find(r=>r.source_material_id===source.sourceMaterialId&&r.source_material_version===source.sourceMaterialVersion&&r.role===source.role);if(!row||row.source_path!==source.sourcePath||row.sha256!==source.sha256||row.bytes!==source.bytes||row.object_key!==source.objectKey)throw new ApiError(409,'OEX_INVENTORY_UNAVAILABLE');}
 for(const {source,material} of planned){
  await c.query('INSERT INTO workspace_material_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_keys) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.workspaceId,s.tenantId,s.userId,material.id,material.version,material,{color:source.objectKey}]);
  await c.query('INSERT INTO workspace_material_import_provenance(workspace_id,tenant_id,user_id,material_id,material_version,source_material_id,source_material_version,import_job_id,attempt_id,lease_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[input.workspaceId,s.tenantId,s.userId,material.id,material.version,source.sourceMaterialId,source.sourceMaterialVersion,input.jobId,input.attemptId,input.leaseId]);
 }
 if(planned.some(({material})=>!allowedRights(material.rights,'display')||!allowedRights(material.rights,'export')))throw new ApiError(403,'RIGHTS_DENIED');
}
