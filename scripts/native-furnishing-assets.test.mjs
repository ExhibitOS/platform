// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUPPORTED_FURNISHINGS, furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {copyNativeFurnishings,verifyDefaultFurnishingsManifest,checkedDefaultFurnishingsRoot} from './package-native-runtime.mjs';

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

test('pinned release manifest uses the existing catalogue and rejects substitutions',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-furnishings-release-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=fileURLToPath(new URL('./fixtures/default-furnishings-1.0.0.manifest.json',import.meta.url));
  const bytes=await readFile(fixture);await writeFile(join(root,'manifest.json'),bytes);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'4ac7d23c1b557d8e303ad04d78379bcefab50b40',manifestSHA256:'f11ba6f4407e31531230cdb94921d7d7baef3caca49b1859f8696fa1a39c4530'});
  const changed=Buffer.from(bytes);changed[changed.length-2]^=1;await writeFile(join(root,'manifest.json'),changed);
  await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  await writeFile(join(root,'manifest.json'),bytes);await assert.rejects(checkedDefaultFurnishingsRoot(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  await assert.rejects(checkedDefaultFurnishingsRoot('relative/path'),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  const frameRelease=fileURLToPath(new URL('./fixtures/default-furnishings-1.1.0.manifest.json',import.meta.url));
  await writeFile(join(root,'manifest.json'),await readFile(frameRelease));
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'90fb64d44b9c9fd91bb5c09045f92077484d1030',manifestSHA256:'b0173c3e8c5e0b85b66ca2e4a1f569fc1f5ca811d501b35cccd70739e5c6588f'});
  await assert.rejects(checkedDefaultFurnishingsRoot(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);

});
