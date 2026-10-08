// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Pool} from 'pg';
/** Live tenant/session/owner authority, never a role submitted over a public socket. */
export function openingHostAuthority(pool:Pool){
 return async(subject:{userId:string;tenantId:string;sessionId:string},publicationId:string):Promise<boolean>=>{
  const result=await pool.query(`SELECT 1 FROM studio_publications p
   JOIN publication_states ps ON ps.publication_id=p.id
   JOIN exhibitions e ON (e.tenant_id,e.id)=(p.tenant_id,p.exhibition_id)
   JOIN tenants t ON t.id=p.tenant_id
   JOIN memberships m ON m.tenant_id=p.tenant_id AND m.user_id=$3
   JOIN users u ON u.id=m.user_id
   JOIN auth_sessions s ON s.id=$4 AND s.user_id=u.id AND s.tenant_id=p.tenant_id
   WHERE p.id=$1 AND p.tenant_id=$2 AND ps.status='published'
    AND e.deleted_at IS NULL AND t.deleted_at IS NULL AND NOT u.disabled
    AND NOT s.revoked AND s.expires_at>now()
    AND (m.role='admin' OR (m.role IN ('artist','curator') AND e.studio_owner_user_id=u.id))`,
   [publicationId,subject.tenantId,subject.userId,subject.sessionId]);
  return result.rowCount===1;
 };
}
