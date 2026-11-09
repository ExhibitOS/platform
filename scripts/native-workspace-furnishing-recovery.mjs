// SPDX-License-Identifier: AGPL-3.0-or-later
// Private startup reconciliation. A previously issued authenticated lease is
// required; neither an HTTP request nor an available DB lock can issue one.
import {assertIssuedFurnishingWriterLease,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function recoverFurnishingWriterClaims(pool,owner,guard){
 assertIssuedFurnishingWriterLease(guard);const identity=guard.identity;
 if(!owner||owner.workspaceId!==identity.workspaceId||owner.tenantId!==identity.tenantId||owner.principalId!==identity.principalId||typeof owner.assertDatabase!=='function')throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('BEGIN');await guard.assertLive();const lock=await c.query('SELECT pg_try_advisory_xact_lock(82002) AS locked');if(lock.rows[0]?.locked!==true)throw Error('FURNISHING_RECOVERY_BUSY');
  await owner.assertDatabase(c);
  const rows=(await c.query("SELECT id,worker_token,worker_generation,worker_root_device::text,worker_root_inode::text,worker_lock_device::text,worker_lock_inode::text,phase FROM workspace_furnishing_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND worker_token IS NOT NULL ORDER BY id FOR UPDATE",[identity.workspaceId,identity.tenantId,identity.principalId])).rows;
  for(const row of rows){
   if(!uuid.test(row.id??'')||!uuid.test(row.worker_token??'')||!uuid.test(row.worker_generation??'')||row.worker_generation===identity.runtimeGeneration||!['validating','cancelling'].includes(row.phase)||row.worker_root_device!==identity.rootDevice||row.worker_root_inode!==identity.rootInode||row.worker_lock_device!==identity.lockDevice||row.worker_lock_inode!==identity.lockInode)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
  }
  for(const row of rows){const updated=await c.query('UPDATE workspace_furnishing_intakes SET worker_token=NULL,worker_generation=NULL,worker_root_device=NULL,worker_root_inode=NULL,worker_lock_device=NULL,worker_lock_inode=NULL,updated_at=now() WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND worker_token=$5 AND worker_generation=$6 RETURNING id',[identity.workspaceId,identity.tenantId,identity.principalId,row.id,row.worker_token,row.worker_generation]);if(updated.rowCount!==1)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');}
  await guard.assertLive();await c.query('COMMIT');return rows.length;
 }catch(error){try{await c.query('ROLLBACK');}catch{broken=true;}throw error;}finally{c.release(broken);}
}

/** Reconcile only fresh-image work from an earlier, drained owner generation.
 * The caller supplies the explicit interrupted-reopen admission after Manager has proved
 * the previous owned processes stopped and reacquired the inherited lock. */
export async function recoverFreshImageClaims(pool,owner,guard,admission){
 assertIssuedFurnishingOrdinaryAdmission(admission);
 const identity=guard.identity;
 if(admission.writer!==guard||admission.fields.admissionKind!=='interrupted-reopen'||
    !owner||owner.workspaceId!==identity.workspaceId||owner.tenantId!==identity.tenantId||owner.principalId!==identity.principalId)
  throw Error('FRESH_IMAGE_RECOVERY_UNAVAILABLE');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('BEGIN');await guard.assertLive();
  const lock=await c.query('SELECT pg_try_advisory_xact_lock(82002) AS locked');
  if(lock.rows[0]?.locked!==true)throw Error('FURNISHING_RECOVERY_BUSY');
  await owner.assertDatabase(c);
  const rows=(await c.query(`SELECT id,state,lease_id,png_worker_tokens,derived->'claim' AS claim FROM import_jobs
   WHERE tenant_id=$1 AND user_id=$2 AND derived->>'kind'='fresh-product-image' AND derived->>'workspaceId'=$3
   AND (cardinality(png_worker_tokens)>0 OR derived ? 'claim') ORDER BY id FOR UPDATE`,
   [identity.tenantId,identity.principalId,identity.workspaceId])).rows;
  for(const {id,state,lease_id:lease,png_worker_tokens:tokens,claim} of rows){
   if(!uuid.test(id)||!claim||!uuid.test(claim.token)||!uuid.test(claim.runtimeGeneration)||
      claim.runtimeGeneration!==admission.fields.previousRuntimeGeneration||tokens.length!==1||tokens[0]!==claim.token||
      !['processing','failed','cancelled'].includes(state)||(state==='processing'?lease!==claim.token:lease!==null&&lease!==claim.token)||
      ['workspaceId','tenantId','principalId','rootDevice','rootInode','lockDevice','lockInode'].some(key=>claim[key]!==identity[key]))
    throw Error('FRESH_IMAGE_RECOVERY_UNAVAILABLE');
   const updated=await c.query(`UPDATE import_jobs SET derived=derived-'claim',png_worker_tokens='{}',
    lease_id=NULL,lease_until=NULL,state=CASE WHEN state='processing' THEN 'failed' ELSE state END,
    error_code=CASE WHEN state='processing' THEN 'IMAGE_PREPARATION_INTERRUPTED' ELSE error_code END,
    available_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND derived#>>'{claim,token}'=$3 RETURNING id`,
    [identity.tenantId,id,claim.token]);
   if(updated.rowCount!==1)throw Error('FRESH_IMAGE_RECOVERY_UNAVAILABLE');
  }
  await guard.assertLive();await c.query('COMMIT');return rows.length;
 }catch(error){try{await c.query('ROLLBACK');}catch{broken=true;}throw error;}finally{c.release(broken);}
}

/** Exact 046 recovery. The v3 assertion binds the prior generation selected by
 * Manager after its verified owner drain. No 047 or ordinary-model rows match. */
export async function recoverLargeModelClaims(pool,store,owner,guard,admission){
 assertIssuedFurnishingOrdinaryAdmission(admission);
 const identity=guard.identity;
 if(admission.writer!==guard||admission.fields.admissionKind!=='interrupted-reopen'||
    !owner||owner.workspaceId!==identity.workspaceId||owner.tenantId!==identity.tenantId||owner.principalId!==identity.principalId||
    typeof store?.getLargeModelSource!=='function')throw Error('LARGE_MODEL_RECOVERY_UNAVAILABLE');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('BEGIN');await guard.assertLive();
  const lock=await c.query('SELECT pg_try_advisory_xact_lock(82002) AS locked');
  if(lock.rows[0]?.locked!==true)throw Error('FURNISHING_RECOVERY_BUSY');
  await owner.assertDatabase(c);
  const rows=(await c.query(`SELECT id,state,mime,lease_id,png_worker_tokens,object_key,expected_hash,expected_bytes,
   asset_id,original_asset_id,model_preparation AS preparation FROM import_jobs
   WHERE tenant_id=$1 AND user_id=$2 AND model_preparation#>>'{request,profileId}'='embedded-model-compact-large-20k-512-v2'
   AND (cardinality(png_worker_tokens)>0 OR model_preparation ? 'claim') ORDER BY id FOR UPDATE`,
   [identity.tenantId,identity.principalId])).rows;
  for(const row of rows){
   const {id,state,lease_id:lease,png_worker_tokens:tokens,preparation}=row,claim=preparation?.claim;
   if(!uuid.test(id)||preparation?.kind!=='required-model-compact'||Object.hasOwn(preparation.request,'sourceFull')||
      Object.hasOwn(preparation,'result')||row.mime!=='model/gltf-binary'||row.asset_id!==null||row.original_asset_id!==null||
      !claim||!uuid.test(claim.token)||claim.runtimeGeneration!==admission.fields.previousRuntimeGeneration||tokens.length!==1||tokens[0]!==claim.token||
      !['processing','failed','cancelled'].includes(state)||(state==='processing'?lease!==claim.token:lease!==null&&lease!==claim.token)||
      row.object_key!==`${identity.tenantId}/quarantine/import-${id}/${row.expected_hash}`||
      ['workspaceId','tenantId','principalId','rootDevice','rootInode','lockDevice','lockInode'].some(key=>claim[key]!==identity[key]))
    throw Error('LARGE_MODEL_RECOVERY_UNAVAILABLE');
   await store.getLargeModelSource(row.object_key,Number(row.expected_bytes));
   const updated=await c.query(`UPDATE import_jobs SET model_preparation=model_preparation-'claim',png_worker_tokens='{}',
    lease_id=NULL,lease_until=NULL,state=CASE WHEN state='processing' THEN 'failed' ELSE state END,
    error_code=CASE WHEN state='processing' THEN 'MODEL_PREPARATION_INTERRUPTED' ELSE error_code END,
    available_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND model_preparation#>>'{claim,token}'=$3 RETURNING id`,
    [identity.tenantId,id,claim.token]);
   if(updated.rowCount!==1)throw Error('LARGE_MODEL_RECOVERY_UNAVAILABLE');
  }
  await guard.assertLive();await c.query('COMMIT');return rows.length;
 }catch(error){try{await c.query('ROLLBACK');}catch{broken=true;}throw error;}finally{c.release(broken);}
}
