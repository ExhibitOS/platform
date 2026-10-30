// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUPPORTED_FURNISHINGS, furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {copyNativeFurnishings} from './package-native-runtime.mjs';

test('native package includes only the four exact approved model and notice pairs', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'exhibitos-native-furnishing-')));
  t.after(() => rm(root, {recursive:true, force:true}));
  const source = join(root, 'source'), output = join(root, 'output');
  await mkdir(source); await mkdir(output);
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const paths = Object.keys(SUPPORTED_FURNISHINGS).flatMap(id => {
    const entry = furnishingCatalogueEntry(id);
    return [entry.path, entry.rights.noticePath];
  });
  assert.equal(paths.length, 8);
  for (const path of paths) {
    await mkdir(dirname(join(source,path)), {recursive:true});
    await cp(join(repository,path), join(source,path));
  }
  await copyNativeFurnishings(source, output);
  for (const path of paths) {
    assert.deepEqual(await readFile(join(output,path)), await readFile(join(source,path)));
    assert((await lstat(join(output,path))).isFile());
  }
  await assert.rejects(copyNativeFurnishings(source, output)); // Never replace an existing payload.
  const corrupt = join(root, 'corrupt'); await mkdir(corrupt);
  await writeFile(join(source,paths[0]), Buffer.from('changed synthetic test copy'));
  await assert.rejects(copyNativeFurnishings(source, corrupt), /NATIVE_PACKAGE_FURNISHING_INVALID/);
  const linked = join(root, 'linked'); await mkdir(linked);
  await rm(join(source,paths[0])); await symlink(join(repository,paths[0]), join(source,paths[0]));
  await assert.rejects(copyNativeFurnishings(source, linked), /NATIVE_PACKAGE_INPUT_INVALID/);
});
