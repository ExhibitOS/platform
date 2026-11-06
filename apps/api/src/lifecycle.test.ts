import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, statfs, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { readiness } from './lifecycle.ts';
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {...actual, statfs: vi.fn(actual.statfs)};
});
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
it('checks an explicit selected supplemental migration without changing the default sequence',async()=>{
 const {config,pool,rows}=await fixture(),supplemental=join(config.migrationDirectory,'..','fresh-only');await mkdir(supplemental);await writeFile(join(supplemental,'026.sql'),'SELECT 2;');rows.push({name:'026.sql',sha256:createHash('sha256').update('SELECT 2;').digest('hex')});
 expect((await readiness(pool,config)).ready).toBe(false);expect((await readiness(pool,{...config,supplementalMigrationDirectory:supplemental})).ready).toBe(true);
 await writeFile(join(supplemental,'001.sql'),'SELECT 1;');expect((await readiness(pool,{...config,supplementalMigrationDirectory:supplemental})).ready).toBe(false);
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

it('rejects zero available local blocks and recovers without creating storage objects', async () => {
  const {config, pool} = await fixture();
  const capacity = await statfs(config.blobRoot, {bigint: true});
  vi.mocked(statfs).mockResolvedValueOnce({...capacity, bavail: 0n});
  const full = await readiness(pool, config);
  expect(full.ready).toBe(false);
  expect(full.services.find(service => service.name === 'storage')?.status).toBe('unavailable');
  expect(await readdir(config.blobRoot)).toEqual([]);
  const recovered = await readiness(pool, config);
  expect(recovered.ready).toBe(true);
  expect(recovered.services.find(service => service.name === 'storage')?.status).toBe('ready');
  expect(await readdir(config.blobRoot)).toEqual([]);
});

it('checks only the applied supplemental catalog while rejecting drift and unexpected database rows',async()=>{
 const {config,pool,rows}=await fixture(),supplemental=join(config.migrationDirectory,'..','selected');await mkdir(supplemental);
 const a='SELECT 26;',b='SELECT 27;',digest=(v:string)=>createHash('sha256').update(v).digest('hex');
 await writeFile(join(supplemental,'026.sql'),a);await writeFile(join(supplemental,'027.sql'),b);rows.push({name:'026.sql',sha256:digest(a)});
 const options={...config,supplementalMigrationDirectory:supplemental,supplementalMigrationNames:['026.sql']};
 expect((await readiness(pool,options)).ready).toBe(true);
 rows.push({name:'027.sql',sha256:digest(b)});expect((await readiness(pool,options)).ready).toBe(false);
 const both={...options,supplementalMigrationNames:['026.sql','027.sql']};expect((await readiness(pool,both)).ready).toBe(true);
 rows[2]!.sha256='0'.repeat(64);expect((await readiness(pool,both)).ready).toBe(false);rows.pop();expect((await readiness(pool,both)).ready).toBe(false);
 expect((await readiness(pool,{...options,supplementalMigrationNames:['026.sql','026.sql']})).ready).toBe(false);
});
it('requires the exact separate workspace import schema pair and full matching ledger',async()=>{
 const {config,pool,rows}=await fixture(),supplemental=join(config.migrationDirectory,'..','selected-v6'),imports=join(config.migrationDirectory,'..','imports-v6'),digest=(v:string)=>createHash('sha256').update(v).digest('hex');await mkdir(supplemental);await mkdir(imports);
 const a='SELECT 26;',b='SELECT 33;',c='SELECT 34;';await writeFile(join(supplemental,'026.sql'),a);await writeFile(join(imports,'033_workspace_material_import_provenance.sql'),b);await writeFile(join(imports,'034_workspace_material_terminal_proof.sql'),c);rows.push({name:'026.sql',sha256:digest(a)},{name:'033_workspace_material_import_provenance.sql',sha256:digest(b)},{name:'034_workspace_material_terminal_proof.sql',sha256:digest(c)});
 const options={...config,supplementalMigrationDirectory:supplemental,supplementalMigrationNames:['026.sql'],workspaceImportMigrationDirectory:imports};expect((await readiness(pool,options)).ready).toBe(true);await rm(join(imports,'034_workspace_material_terminal_proof.sql'));expect((await readiness(pool,options)).ready).toBe(false);await writeFile(join(imports,'034_workspace_material_terminal_proof.sql'),c);await writeFile(join(imports,'035_unexpected.sql'),'SELECT 35;');expect((await readiness(pool,options)).ready).toBe(false);
});
it('requires the exact separate workspace furnishing schema and matching ledger',async()=>{
 const {config,pool,rows}=await fixture(),furnishings=join(config.migrationDirectory,'..','furnishings'),name='036_workspace_furnishing.sql',sql='SELECT 36;';await mkdir(furnishings);await writeFile(join(furnishings,name),sql);rows.push({name,sha256:createHash('sha256').update(sql).digest('hex')});
 const options={...config,workspaceFurnishingMigrationDirectory:furnishings};expect((await readiness(pool,options)).ready).toBe(true);expect((await readiness(pool,config)).ready).toBe(false);await writeFile(join(furnishings,name),'changed');expect((await readiness(pool,options)).ready).toBe(false);await writeFile(join(furnishings,name),sql);await writeFile(join(furnishings,'037_unexpected.sql'),'SELECT 37;');expect((await readiness(pool,options)).ready).toBe(false);
});
