// SPDX-License-Identifier: AGPL-3.0-or-later
/** Private native bootstrap, never an HTTP route. Existing Auth.request, roles,
 * tenant binding, CSRF and Origin checks still authorize every CMS operation. */
import type { Pool } from 'pg';
import { transaction } from '@exhibitos/storage';
import { randomUUID } from 'node:crypto';
import { ApiError, digest, uuid } from './auth.ts';

export interface LocalWorkspaceInput {
  format: 1;
  workspaceId: string;
  tenantId: string;
  principalId: string;
  ownerUid: number;
  sessionToken: string;
  csrfToken: string;
}
export function validateLocalWorkspace(value: unknown, runtimeMode: string | undefined): LocalWorkspaceInput {
  if (process.platform !== 'darwin' || runtimeMode !== 'native' || !process.getuid || process.getuid() <= 0 || !value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(403, 'LOCAL_WORKSPACE_CHANNEL_REQUIRED');
  const v = value as LocalWorkspaceInput;
  const fields = ['format', 'workspaceId', 'tenantId', 'principalId', 'ownerUid', 'sessionToken', 'csrfToken'];
  if (Object.keys(v).length !== fields.length || !fields.every(k => Object.hasOwn(v, k)) || v.format !== 1 || !Number.isSafeInteger(v.ownerUid) || v.ownerUid !== process.getuid()) throw new ApiError(403, 'LOCAL_WORKSPACE_OWNER_MISMATCH');
  uuid(v.workspaceId); uuid(v.tenantId); uuid(v.principalId);
  for (const token of [v.sessionToken, v.csrfToken]) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').length !== 32 || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new ApiError(400, 'LOCAL_WORKSPACE_CHANNEL_INVALID');
  }
  if (v.sessionToken === v.csrfToken) throw new ApiError(400, 'LOCAL_WORKSPACE_CHANNEL_INVALID');
  return v;
}

export async function openLocalWorkspace(pool: Pool, input: LocalWorkspaceInput, runtimeMode: string | undefined) {
  const v = validateLocalWorkspace(input, runtimeMode);
  return transaction(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock(82003)');
    await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const existing = await c.query('SELECT * FROM local_workspaces WHERE id=$1 FOR UPDATE', [v.workspaceId]);
    if (!existing.rowCount) {
      // A new personal workspace must never claim legacy account/tenant data.
      const occupied = await c.query('SELECT (EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM tenants) OR EXISTS(SELECT 1 FROM local_workspaces)) AS occupied');
      if (occupied.rows[0]?.occupied) throw new ApiError(409, 'LOCAL_WORKSPACE_MIGRATION_REQUIRED');
      await c.query("INSERT INTO tenants(id,name) VALUES($1,'Personal workspace')", [v.tenantId]);
      await c.query('INSERT INTO users(id,subject) VALUES($1,$2)', [v.principalId, `local-workspace-${v.workspaceId}`]);
      await c.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [v.tenantId, v.principalId]);
      await c.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)', [v.workspaceId, v.tenantId, v.principalId, v.ownerUid]);
    } else {
      const row = existing.rows[0];
      if (row.tenant_id !== v.tenantId || row.user_id !== v.principalId || Number(row.mac_uid) !== v.ownerUid) throw new ApiError(403, 'LOCAL_WORKSPACE_OWNER_MISMATCH');
      const owner = await c.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL", [v.tenantId, v.principalId]);
      if (!owner.rowCount) throw new ApiError(403, 'LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
    }
    // No credential row is ever created. Reopen revokes only this workspace's
    // previous sessions and never resets a password or grants a legacy owner.
    await c.query('UPDATE auth_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2', [v.tenantId, v.principalId]);
    await c.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '8 hours')", [randomUUID(), digest(v.sessionToken), digest(v.csrfToken), v.csrfToken, v.tenantId, v.principalId]);
    return { workspaceId: v.workspaceId, tenantId: v.tenantId, principalId: v.principalId };
  });
}
