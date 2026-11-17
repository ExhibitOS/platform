// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {checkedDefaultFurnishingsRoot,copyNativeFurnishings,requireCurrentFurnishingsRelease,verifyDefaultFurnishingsManifest} from './package-native-runtime.mjs';

const root=process.env.EXHIBITOS_DEFAULT_119_FIXTURE;
const prior=process.env.EXHIBITOS_DEFAULT_118_FIXTURE;
const commit='1c81844b8c7f545387fff4ade6823aee4b72eff7';
const manifestSHA256='138b8307dba70f382f886c5c37b6396f1327b0b7311a202ec5d6932185743b08';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('1.19 checks and copies the issued bench, license and acquired source through the existing packager', {skip:!root}, async t=>{
  const source=await realpath(root);
  await requireCurrentFurnishingsRelease(source);
  const release=await checkedDefaultFurnishingsRoot(source);
  assert.deepEqual(release,{root:source,commit,manifestSHA256});
  const scratch=await realpath(await mkdtemp(join(tmpdir(),'default119-')));
  t.after(()=>rm(scratch,{recursive:true,force:true}));
  const output=join(scratch,'output');
  await copyNativeFurnishings(source,output,release);
  const bundled=await readFile(join(output,'assets/furnishings/default-manifest.json'));
  assert.equal(bundled.length,27317);
  assert.equal(digest(bundled),manifestSHA256);
  const assets=JSON.parse(bundled).assets;
  assert.equal(assets.length,27);
  const bench=assets.find(item=>item.catalogId==='sculpture-room-oak-bench');
  assert.equal(bench.hostKind,'bench');
  assert.equal(bench.provenance.recipe,'bench-basecolor-512-v1');
  for(const item of assets){
    for(const file of [item.model,item.rights.notice,...(item.provenance.source?[item.provenance.source]:[])]){
      const bytes=await readFile(join(output,file.path));
      assert.equal(bytes.length,file.bytes);
      assert.equal(digest(bytes),file.sha256);
    }
  }
  const invalid=join(scratch,'invalid');
  await cp(join(source,'assets'),join(invalid,'assets'),{recursive:true});
  await writeFile(join(invalid,'manifest.json'),bundled);
  const tampered=Buffer.from(await readFile(join(invalid,bench.provenance.source.path)));
  tampered[0]^=1;
  await writeFile(join(invalid,bench.provenance.source.path),tampered);
  await assert.rejects(copyNativeFurnishings(invalid,join(scratch,'invalid-output'),release),/NATIVE_PACKAGE_FURNISHING_INVALID/);
});

test('the exact 1.18 manifest remains recognizable by the historical route', {skip:!prior}, async()=>{
  const previous=await realpath(prior);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(previous),{
    commit:'e9fc45d3bca70690922a9e92849e4ecd1c587a33',
    manifestSHA256:'83d9d1913850c310e63a1d5a77297ca8944da1fc9720cf017e3a9dad361b7e5a',
  });
  await assert.rejects(requireCurrentFurnishingsRelease(previous),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});
