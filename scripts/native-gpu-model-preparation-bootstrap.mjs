// SPDX-License-Identifier: AGPL-3.0-or-later
// Sealed schema-only 045→049 transition; never opens API/session/encoder services.
import {pathToFileURL} from 'node:url';
import {assertIssuedFurnishingOrdinaryAdmission,assertIssuedFurnishingWriterLease} from './native-workspace-furnishing-admission.mjs';
import {GPU_MODEL_PREPARATION_MIGRATION,GPU_MODEL_PREPARATION_SHA256,verifyGpuModelPreparationMigration,assertExactGpuModelPreparationCatalog,assertExactModelPreparationCatalog,recognizeNormalOexCatalog} from './native-oex-normal-catalog.mjs';
export async function upgradeGpuModelPreparationCatalog(c,{mode,ownerUid,writer,ordinaryAdmission,channel,isStopped,catalog}){
 const upgrade='workspace-furnishing-045-to-049-upgrade-v1';
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);assertIssuedFurnishingWriterLease(writer);
 if(mode!==upgrade||writer.identity.mode!==upgrade||ordinaryAdmission.writer!==writer||ordinaryAdmission.fields.admissionKind!=='catalog-upgrade-045-to-049'||!Number.isSafeInteger(ownerUid)||ownerUid<0||typeof isStopped!=='function')throw Error('FURNISHING_ADMISSION_INVALID');
 const live=async()=>{await writer.assertLive();if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');};
 const {base,normal,...options}=catalog;
 if(!options.modelPreparationDirectory||!options.gpuModelPreparationDirectory||options.infoStandPreparationDirectory||options.largeModelDirectory||options.freshImageDirectory||options.workspaceFurnishingThumbnailDirectory)throw Error('NATIVE_OEX_CATALOG');
 const sql=await verifyGpuModelPreparationMigration(options.gpuModelPreparationDirectory);await live();
 // Same lock order as ordinary exclusive furnishing open, without its writes.
 await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
 await c.query('SELECT pg_advisory_xact_lock(82003)');await c.query('SELECT pg_advisory_xact_lock(82002)');await c.query('SELECT pg_advisory_xact_lock(82001)');
 const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows,apply=rows.length===45;
 if(rows.length===45)await assertExactModelPreparationCatalog(c);else if(rows.length===46)await assertExactGpuModelPreparationCatalog(c);else throw Error('NATIVE_OEX_CATALOG');
 if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');
 const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR SHARE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
 if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
 // 049 does not exist on the exact 45 first-apply path. On retry, retained
 // GPU lease/tokens are uncertainty, never evidence of a drained invocation.
 if(!apply){const gpu=await c.query("SELECT EXISTS (SELECT 1 FROM import_jobs WHERE gpu_preparation IS NOT NULL AND (lease_id IS NOT NULL OR lease_until IS NOT NULL OR cardinality(png_worker_tokens)>0)) AS pending");if(gpu.rows[0]?.pending!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');}
 const pending=await c.query('SELECT EXISTS (SELECT 1 FROM workspace_furnishing_intakes WHERE worker_token IS NOT NULL) AS pending');if(pending.rows[0]?.pending!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
 await live();
 if(apply){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[GPU_MODEL_PREPARATION_MIGRATION,GPU_MODEL_PREPARATION_SHA256]);}
 await assertExactGpuModelPreparationCatalog(c);if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');await live();
 return {state:apply?'applied':'already-applied'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let runtime;
 try{
  const {readNativeWorkspaceChannel}=await import('./native-workspace-channel.mjs');
  const {unpackNativeOwnerInput}=await import('./native-owner-channel.mjs');
  const input=await readNativeWorkspaceChannel();
  if(!input||Object.keys(input).sort().join(',')!=='ownerChannel,workspace')throw Error('NATIVE_OWNER_INPUT');
  const received=unpackNativeOwnerInput(input);
  if(received.ownerChannel?.mode!=='workspace-furnishing-045-to-049-upgrade-v1')throw Error('NATIVE_OWNER_INPUT');
  const {startLocalRuntime}=await import('./local-runtime.mjs');
  runtime=await startLocalRuntime(process.env,received.workspace,received.ownerChannel);
  if(runtime.helperCompleted!==true||runtime.result?.mode!=='workspace-furnishing-045-to-049-upgrade-v1')throw Error('GPU_MODEL_UPGRADE_INCOMPLETE');
  console.info('EXHIBITOS_NATIVE_GPU_MODEL_PREPARATION_UPGRADE_RESULT '+JSON.stringify(runtime.result));
 }catch{process.exitCode=1;console.error('GPU_MODEL_PREPARATION_UPGRADE_FAILED');}
 finally{try{await runtime?.close();}catch{process.exitCode=1;console.error('GPU_MODEL_PREPARATION_UPGRADE_FAILED');}}
}
