// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {migrateLegacyOex} from './archive-migration.ts';
describe('original archival OEX migration',()=>{
 it('converts actual legacy fixture to media profile preserving exact scene, rights, provenance and asset bytes',async()=>{
  const source=await readFile(fixtureURL('oex/v1/examples/synthetic.oex')),before=Buffer.from(source),legacy=await readOex(source);
  expect(legacy.manifest.formatVersion).toBe('1.0.0-draft.1');
  const result=await migrateLegacyOex(source,{createdAt:'2026-10-11T00:00:00.000Z'}),current=await readOex(result.bytes);
  expect(source).toEqual(before);expect(current.exhibition).toEqual(legacy.exhibition);expect(current.manifest.formatVersion).toBe('1.0.0-draft.2');
  for(const a of current.manifest.assets){const old=legacy.manifest.assets.find(x=>x.artifactPath===a.artifactPath)!;expect(current.files.get(a.path)).toEqual(legacy.files.get(old.path));}
  expect(result.receipt.originalUnchanged).toBe(true);expect(result.receipt.signedFreezeMigrated).toBe(false);
 });
 it('refuses corrupted history and already current packages without rewriting input',async()=>{
  const source=await readFile(fixtureURL('oex/v1/examples/synthetic.oex')),bad=Buffer.from(source);bad[40]=bad[40]!^1;
  await expect(migrateLegacyOex(bad,{createdAt:'2026-10-11T00:00:00.000Z'})).rejects.toThrow();
  const converted=await migrateLegacyOex(source,{createdAt:'2026-10-11T00:00:00.000Z'});
  await expect(migrateLegacyOex(converted.bytes,{createdAt:'2026-10-11T00:00:00.000Z'})).rejects.toThrow('UNSUPPORTED_MIGRATION_SOURCE');
 });
});
