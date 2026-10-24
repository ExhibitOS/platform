// SPDX-License-Identifier: AGPL-3.0-or-later
// Requires a fresh, explicitly owned synthetic native PostgreSQL database.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { migrate } from '../packages/storage/dist/index.js';
import { bootstrap, Auth } from '../apps/api/dist/auth.js';
import { openLocalWorkspace, validateLocalWorkspace } from '../apps/api/dist/local-workspace.js';
import { buildApp } from '../apps/api/dist/app.js';

const url = new URL(process.env.DATABASE_URL ?? 'about:blank');
assert.equal(process.env.EXHIBITOS_LOCAL_WORKSPACE_TEST_ACK, 'isolated-synthetic');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(process.platform, 'darwin');
const pool = new Pool({ connectionString: url.href, max: 2 });
const origin = 'http://127.0.0.1:13200';
const input = () => ({ format: 1, workspaceId: randomUUID(), tenantId: randomUUID(), principalId: randomUUID(), ownerUid: process.getuid(), sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const evidence = [];
let app, legacyPool;
try {
  await migrate(pool, new URL('../database/migrations/', import.meta.url).pathname);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 0);
  const v = input();
  for (const [bad, mode] of [[undefined, 'native'], [{ ...v, ownerUid: v.ownerUid + 1 }, 'native'], [{ ...v, principalId: randomUUID(), extra: true }, 'native'], [v, 'container'], [{ ...v, csrfToken: v.sessionToken }, 'native']]) assert.throws(() => validateLocalWorkspace(bad, mode));
  const channel = new URL('./native-workspace-channel.mjs', import.meta.url).href;
  const validator = new URL('../apps/api/dist/local-workspace.js', import.meta.url).href;
  const program = `import {readNativeWorkspaceChannel} from ${JSON.stringify(channel)}; import {validateLocalWorkspace} from ${JSON.stringify(validator)}; try {validateLocalWorkspace(await readNativeWorkspaceChannel(),'native');console.log('CHANNEL_OK');}catch{console.error('CHANNEL_REFUSED');process.exitCode=2;}`;
  const pipe = spawnSync(process.execPath, ['--input-type=module', '-e', program], { input: JSON.stringify(v), encoding: 'utf8', timeout: 10000 });
  assert.equal(pipe.status, 0); assert.equal(pipe.stdout.trim(), 'CHANNEL_OK'); assert.ok(!pipe.stdout.includes(v.sessionToken) && !pipe.stderr.includes(v.sessionToken));
  const overflow = spawnSync(process.execPath, ['--input-type=module', '-e', program], { input: 'x'.repeat(4097), encoding: 'utf8', timeout: 10000 });
  assert.equal(overflow.status, 2); assert.equal(overflow.stderr.trim(), 'CHANNEL_REFUSED');
  const noPipe = spawnSync(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
  assert.equal(noPipe.status, 2);
  evidence.push('Inherited pipe only, bounded/owner/native validation and no secret echo');

  const first = await openLocalWorkspace(pool, v, 'native');
  assert.equal(first.principalId, v.principalId);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM auth_credentials')).rows[0].count, 0);
  app = buildApp({ pool, auth: { mode: 'local', origin, bindHost: '127.0.0.1' } });
  const cookie = `exhibitos_local_session=${v.sessionToken}`;
  const headers = { host: '127.0.0.1:13200', origin, cookie, 'x-csrf-token': v.csrfToken };
  const prefix = `/api/v1/tenants/${v.tenantId}/cms`;
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { host: headers.host } })).statusCode, 401);
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers });
  assert.equal(session.statusCode, 200); assert.equal(session.json().userId, v.principalId);
  const payload = { name: 'Local synthetic owner', bio: 'No account or password creation' };
  for (const denied of [{ ...headers, origin: 'https://attacker.invalid' }, { ...headers, 'x-csrf-token': 'wrong' }, { host: headers.host, cookie, 'x-csrf-token': v.csrfToken }]) {
    assert.equal((await app.inject({ method: 'POST', url: `${prefix}/artists`, headers: denied, payload })).statusCode, 403);
  }
  const artist = await app.inject({ method: 'POST', url: `${prefix}/artists`, headers, payload });
  assert.equal(artist.statusCode, 201);
  const artwork = await app.inject({ method: 'POST', url: `${prefix}/artworks`, headers, payload: { artistId: artist.json().id, title: 'Durable workspace fixture', description: 'Synthetic metadata boundary only', dimensions: { width: 1, height: 1, unit: 'm' }, rights: { holder: 'Synthetic owner', ownership: 'owner', licenseId: 'CC0-1.0', permissions: { display: true, download: true, export: true, commercial: false }, creditLine: '' }, provenance: { source: 'synthetic', sourceUnits: 'm', scaleApplied: false, notes: '' } } });
  assert.equal(artwork.statusCode, 201);
  evidence.push('No password credential, existing authenticated CMS session/RBAC/tenant/origin/CSRF boundary');

  const reopened = { ...v, sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') };
  await openLocalWorkspace(pool, reopened, 'native');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers })).statusCode, 401);
  const renewed = { ...headers, cookie: `exhibitos_local_session=${reopened.sessionToken}`, 'x-csrf-token': reopened.csrfToken };
  const saved = await app.inject({ method: 'GET', url: `${prefix}/artworks/${artwork.json().id}`, headers: renewed });
  assert.equal(saved.statusCode, 200); assert.equal(saved.json().metadata.title, 'Durable workspace fixture');
  await assert.rejects(openLocalWorkspace(pool, { ...reopened, principalId: randomUUID() }, 'native'), e => e.code === 'LOCAL_WORKSPACE_OWNER_MISMATCH');
  await assert.rejects(openLocalWorkspace(pool, input(), 'native'), e => e.code === 'LOCAL_WORKSPACE_MIGRATION_REQUIRED');
  await assert.rejects(bootstrap(pool, v.tenantId, 'must-not-create-password', randomBytes(24).toString('hex')), e => e.code === 'BOOTSTRAP_CLOSED');
  await pool.query('UPDATE users SET disabled=true WHERE id=$1', [v.principalId]);
  await assert.rejects(openLocalWorkspace(pool, reopened, 'native'), e => e.code === 'LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
  await pool.query('UPDATE users SET disabled=false WHERE id=$1', [v.principalId]);
  evidence.push('Same persistent principal/data on reopen; old token revoked; ownership/legacy bootstrap refusal and disabled owner preservation');

  const legacyName = `legacy_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE DATABASE "${legacyName}"`);
  const legacyURL = new URL(url); legacyURL.pathname = `/${legacyName}`;
  legacyPool = new Pool({ connectionString: legacyURL.href, max: 2 });
  await migrate(legacyPool, new URL('../database/migrations/', import.meta.url).pathname);
  const legacyTenant = randomUUID(), legacyPassword = randomBytes(24).toString('hex');
  await bootstrap(legacyPool, legacyTenant, 'legacy-synthetic', legacyPassword);
  await assert.rejects(openLocalWorkspace(legacyPool, input(), 'native'), e => e.code === 'LOCAL_WORKSPACE_MIGRATION_REQUIRED');
  assert.equal((await legacyPool.query('SELECT count(*)::int AS count FROM local_workspaces')).rows[0].count, 0);
  const legacyLogin = await new Auth(legacyPool).login('legacy-synthetic', legacyPassword, legacyTenant, '127.0.0.1');
  assert.ok(legacyLogin.token);
  evidence.push('Existing password account/database rejected for automatic takeover and still logs in unchanged');
  console.log(JSON.stringify({ result: 'PASS', evidence, accountlessWholeFlow: false }));
} finally { await app?.close(); await legacyPool?.end(); await pool.end(); }
