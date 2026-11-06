// SPDX-License-Identifier: AGPL-3.0-or-later
// Private startup reconciliation. A previously issued authenticated lease is
// required; neither an HTTP request nor an available DB lock can issue one.
import {assertIssuedFurnishingWriterLease} from './native-workspace-furnishing-admission.mjs';
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
