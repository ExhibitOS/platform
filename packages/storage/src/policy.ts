import type { PoolClient } from 'pg';
import type { Actor } from './index.js';
export class AccessDenied extends Error { constructor() { super('resource denied'); } }
// All application auth/session/assignment mutations take the exclusive version.
// A checked request retains this shared lock through its resource transaction.
export async function membership(client: PoolClient, actor: Actor, write = false) {
  await client.query('SELECT pg_advisory_xact_lock_shared(82003)');
  const result = await client.query("SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND NOT u.disabled AND t.deleted_at IS NULL", [actor.tenantId, actor.userId]);
  const role = result.rows[0]?.role as string | undefined;
  if (!role || (write && role === 'viewer')) throw new AccessDenied();
  return role;
}
export async function artworkAccess(client: PoolClient, actor: Actor, id: string, write = false) {
 const role = await membership(client, actor, write);
 const result = await client.query('SELECT a.*,r.user_id AS owner_user_id FROM artworks a JOIN artists r ON (r.tenant_id,r.id)=(a.tenant_id,a.artist_id) WHERE a.tenant_id=$1 AND a.id=$2 AND a.deleted_at IS NULL AND r.deleted_at IS NULL', [actor.tenantId,id]);
 const row = result.rows[0];
 if (!row) throw new AccessDenied();
 if (role === 'admin' || (role === 'artist' && row.owner_user_id === actor.userId)) return row;
 if (!write && role === 'curator') {
  const assigned = await client.query('SELECT 1 FROM exhibition_assignments ea JOIN exhibitions e ON (e.tenant_id,e.id)=(ea.tenant_id,ea.exhibition_id) JOIN rooms r ON (r.tenant_id,r.exhibition_id)=(e.tenant_id,e.id) JOIN placements p ON (p.tenant_id,p.room_id)=(r.tenant_id,r.id) WHERE ea.tenant_id=$1 AND ea.user_id=$2 AND p.artwork_id=$3 AND e.deleted_at IS NULL AND r.deleted_at IS NULL AND p.deleted_at IS NULL', [actor.tenantId,actor.userId,id]);
  if (assigned.rowCount) return row;
 }
 throw new AccessDenied();
}
export async function exhibitionAccess(client: PoolClient, actor: Actor, id: string, write = false) {
 const role = await membership(client,actor,write);
 const result = await client.query('SELECT e.*,ea.can_view FROM exhibitions e LEFT JOIN exhibition_assignments ea ON (ea.tenant_id,ea.exhibition_id)=(e.tenant_id,e.id) AND ea.user_id=$3 WHERE e.tenant_id=$1 AND e.id=$2 AND e.deleted_at IS NULL',[actor.tenantId,id,actor.userId]);
 const row = result.rows[0];
 if (row && (role === 'admin' || (role === 'curator' && row.can_view !== null) || (!write && row.can_view === true))) return row;
 throw new AccessDenied();
}
