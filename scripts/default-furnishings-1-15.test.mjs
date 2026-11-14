// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyDefaultFurnishingsManifest} from './package-native-runtime.mjs';
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.15.0.manifest.json',import.meta.url));
const prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.14.0.manifest.json',import.meta.url),'utf8'));
test('1.15 preserves every prior source and adds only the original refined bench v6, without registry authority',async()=>{
 const manifest=JSON.parse(fixture),bench=manifest.assets.at(-1);
 assert.equal(manifest.bundleVersion,'1.15.0');assert.equal(manifest.assets.length,22);
 assert.deepEqual(manifest.assets.slice(0,21),prior.assets);
 assert.equal(createHash('sha256').update(fixture).digest('hex'),'0cab62aed2f85534e29ee5b6eb824d7f3eaae8036cc2d5dced47fd4f5a4dd17d');
 assert.equal(bench.catalogId,'sculpture-bench-refined-v6');assert.equal(bench.hostKind,'bench');
 assert.equal(bench.model.sha256,'28e980f60dfa50c0dd68b6bcf20f34df29957bf50a824262fe91db9d24279f60');
 assert.equal(bench.rights.notice.sha256,'45935b8221ed5f18c96239cc88cae36d804ef802e6d16fdd7001ac87325528f7');
 assert.equal(bench.provenance.recipe,'original-v1');assert.equal(bench.provenance.sourceSha256,bench.model.sha256);
 assert.equal(bench.workspaceFurnishing,undefined);assert.equal(bench.thumbnail,undefined);
 const root=await realpath(await mkdtemp(join(tmpdir(),'default115-')));
 try{
  await writeFile(join(root,'manifest.json'),fixture);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'6955a2fe25cce9ee42863881374fb14f998c66ef',manifestSHA256:'0cab62aed2f85534e29ee5b6eb824d7f3eaae8036cc2d5dced47fd4f5a4dd17d'});
  // Keep length and valid JSON: an otherwise plausible metadata substitution must fail the immutable release pin.
  await writeFile(join(root,'manifest.json'),fixture.toString().replace('"name": "Sculpture Bench Refined v6"','"name": "Sculpture Bench Refined v7"'));
  await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
