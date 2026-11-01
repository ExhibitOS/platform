import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

export interface LifecycleConfig { migrationDirectory: string; supplementalMigrationDirectory?:string; webRoot: string; blobRoot: string; storageCheck?: () => Promise<void> }
export interface Readiness {
  schemaVersion: '1.0.0-draft.1'; protocolVersion: '1'; platformVersion: '0.1.0'; ready: boolean;
  services: {name: string; status: 'ready' | 'unavailable'}[];
}

async function directory(path: string, mode: number) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid directory');
  await access(path, mode);
}

// Inspect capacity without creating files that could enter a concurrent backup.
// Available blocks do not guarantee that a particular upload or quota will fit.
export async function checkLocalStorage(path: string): Promise<void> {
  const root = resolve(path);
  await directory(root, constants.R_OK | constants.W_OK | constants.X_OK);
  const before = await lstat(root);
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const bound = await handle.stat();
    if (bound.dev !== before.dev || bound.ino !== before.ino) throw new Error('storage root changed');
    const capacity = await statfs(root, {bigint: true});
    const after = await lstat(root), final = await handle.stat();
    if (after.isSymbolicLink() || after.dev !== bound.dev || after.ino !== bound.ino || final.dev !== bound.dev || final.ino !== bound.ino || capacity.bsize <= 0n || capacity.blocks <= 0n || capacity.bavail <= 0n || capacity.bavail > capacity.blocks) throw new Error('storage unavailable');
  } finally { await handle.close(); }
}

// Only component states leave this boundary, never paths, SQL errors or credentials.
export async function readiness(pool: Pool, config: LifecycleConfig): Promise<Readiness> {
  const probe = async (work: () => Promise<void>) => {
    try { await work(); return 'ready' as const; } catch { return 'unavailable' as const; }
  };
  const [database, web, storage] = await Promise.all([
    probe(async () => {
      const directories=[config.migrationDirectory,...(config.supplementalMigrationDirectory?[config.supplementalMigrationDirectory]:[])],files:{name:string;path:string}[]=[];
      for(const root of directories){await directory(root,constants.R_OK);for(const name of (await readdir(root)).filter(name=>/^\d+.*\.sql$/.test(name)))files.push({name,path:join(root,name)});}
      files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);if(!files.length||new Set(files.map(f=>f.name)).size!==files.length)throw new Error('missing or duplicate migrations');
      const expected = await Promise.all(files.map(async ({name,path}) => {
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
    probe(() => config.storageCheck ? config.storageCheck() : checkLocalStorage(config.blobRoot)),
  ]);
  const ready = [database, web, storage].every(state => state === 'ready');
  return {schemaVersion: '1.0.0-draft.1', protocolVersion: '1', platformVersion: '0.1.0', ready,
    services: [{name: 'platform', status: ready ? 'ready' : 'unavailable'}, {name: 'api', status: 'ready'},
      {name: 'database', status: database}, {name: 'web', status: web}, {name: 'storage', status: storage}]};
}
