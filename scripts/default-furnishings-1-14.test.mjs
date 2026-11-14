// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyDefaultFurnishingsManifest} from './package-native-runtime.mjs';
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.14.0.manifest.json',import.meta.url));
const prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.13.0.manifest.json',import.meta.url),'utf8'));
test('1.14 preserves every prior source and adds only the original protective hood, without registry authority',async()=>{
 const manifest=JSON.parse(fixture),hood=manifest.assets.at(-1);
 assert.equal(manifest.bundleVersion,'1.14.0');assert.equal(manifest.assets.length,21);
 assert.deepEqual(manifest.assets.slice(0,20),prior.assets);
 assert.equal(createHash('sha256').update(fixture).digest('hex'),'9cae93c4ec7a0051e9ac0d6ffb3a877dc02c9652399ee3f31bb72680b638690d');
 assert.equal(hood.catalogId,'hayes-clear-protective-hood');assert.equal(hood.hostKind,'display-case');
 assert.equal(hood.model.sha256,'1ddb8e0c5101cfaf035adde25cc0ec5bb88d01dba720441f143cca8d9c455819');
 assert.equal(hood.rights.notice.sha256,'8d8c9b82689e03d273325eef0763dd46019c69c23305d869154302e1af1e0e8d');
 assert.equal(hood.provenance.recipe,'original-v1');assert.equal(hood.provenance.sourceSha256,hood.model.sha256);
 assert.equal(hood.workspaceFurnishing,undefined);assert.equal(hood.thumbnail,undefined);
 const root=await realpath(await mkdtemp(join(tmpdir(),'default114-')));
 try{
  await writeFile(join(root,'manifest.json'),fixture);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'2c62f964018fe2d8447f656f808b0cc108962d32',manifestSHA256:'9cae93c4ec7a0051e9ac0d6ffb3a877dc02c9652399ee3f31bb72680b638690d'});
  // Keep length and valid JSON: an otherwise plausible host substitution must fail the immutable release pin.
  await writeFile(join(root,'manifest.json'),fixture.toString().replace('"hostKind": "display-case"','"hostKind": "artwork-case"'));
  await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
