import { constants } from 'node:fs';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Pool } from 'pg';

export interface LifecycleConfig { migrationDirectory: string; webRoot: string; blobRoot: string }
export interface Readiness {
  schemaVersion: '1.0.0-draft.1'; protocolVersion: '1'; platformVersion: '0.1.0'; ready: boolean;
  services: {name: string; status: 'ready' | 'unavailable'}[];
}

async function directory(path: string, mode: number) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid directory');
  await access(path, mode);
}

// Only component states leave this boundary, never paths, SQL errors or credentials.
export async function readiness(pool: Pool, config: LifecycleConfig): Promise<Readiness> {
  const probe = async (work: () => Promise<void>) => {
    try { await work(); return 'ready' as const; } catch { return 'unavailable' as const; }
  };
  const [database, web, storage] = await Promise.all([
    probe(async () => {
      await directory(config.migrationDirectory, constants.R_OK);
      const names = (await readdir(config.migrationDirectory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
      if (!names.length) throw new Error('missing migrations');
      const expected = await Promise.all(names.map(async name => {
        const path = join(config.migrationDirectory, name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid migration');
        return {name, sha256: createHash('sha256').update(await readFile(path)).digest('hex')};
      }));
      const query = {text: 'SELECT name,sha256 FROM schema_migrations ORDER BY name', query_timeout: 2000};
      const actual = (await pool.query(query)).rows as {name: string; sha256: string}[];
      if (actual.length !== expected.length || expected.some((entry, index) => entry.name !== actual[index]?.name || entry.sha256 !== actual[index]?.sha256)) throw new Error('migration mismatch');
    }),
    probe(async () => {
      await directory(config.webRoot, constants.R_OK | constants.X_OK);
      const index = join(config.webRoot, 'index.html');
      const info = await lstat(index);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error('missing web build');
      await access(index, constants.R_OK);
    }),
    probe(() => directory(config.blobRoot, constants.R_OK | constants.W_OK | constants.X_OK)),
  ]);
  const ready = [database, web, storage].every(state => state === 'ready');
  return {schemaVersion: '1.0.0-draft.1', protocolVersion: '1', platformVersion: '0.1.0', ready,
    services: [{name: 'platform', status: ready ? 'ready' : 'unavailable'}, {name: 'api', status: 'ready'},
      {name: 'database', status: database}, {name: 'web', status: web}, {name: 'storage', status: storage}]};
}
