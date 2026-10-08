import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { readiness } from './lifecycle.ts';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'exhibitos-readiness-')); roots.push(root);
  const config = {migrationDirectory: join(root, 'migrations'), webRoot: join(root, 'web'), blobRoot: join(root, 'blobs')};
  await Promise.all(Object.values(config).map(path => mkdir(path)));
  await writeFile(join(config.migrationDirectory, '001.sql'), 'SELECT 1;');
  await writeFile(join(config.webRoot, 'index.html'), '<!doctype html>');
  const rows = [{name: '001.sql', sha256: createHash('sha256').update('SELECT 1;').digest('hex')}];
  const pool = {query: async () => ({rows})} as unknown as Pool;
  return {config, pool, rows};
}
it('reports component readiness only with matching migration bytes and existing runtime roots', async () => {
  const {config, pool} = await fixture();
  expect(await readiness(pool, config)).toEqual({schemaVersion: '1.0.0-draft.1', protocolVersion: '1', platformVersion: '0.1.0', ready: true,
    services: ['platform', 'api', 'database', 'web', 'storage'].map(name => ({name, status: 'ready'}))});
});
it('fails readiness for drifted or extra database migrations', async () => {
  const {config, pool, rows} = await fixture(); rows[0]!.sha256 = '0'.repeat(64);
  expect((await readiness(pool, config)).ready).toBe(false);
  rows.push({name: '002.sql', sha256: '0'.repeat(64)});
  expect((await readiness(pool, config)).services.find(service => service.name === 'database')?.status).toBe('unavailable');
});
it('does not expose errors, filesystem paths or secrets when the database is unavailable', async () => {
  const {config} = await fixture();
  const pool = {query: async () => { throw new Error('postgresql://secret@private-database'); }} as unknown as Pool;
  const result = await readiness(pool, config);
  expect(result.ready).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/secret|private-database|migrations|exhibitos-readiness/);
});
it('rejects a missing build and symlink storage roots', async () => {
  const {config, pool} = await fixture();
  await rm(join(config.webRoot, 'index.html'));
  await rm(config.blobRoot, {recursive: true}); await symlink(config.webRoot, config.blobRoot);
  const result = await readiness(pool, config);
  expect(result.services.filter(service => ['web', 'storage'].includes(service.name)).every(service => service.status === 'unavailable')).toBe(true);
});
