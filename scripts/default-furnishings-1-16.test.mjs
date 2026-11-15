// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyDefaultFurnishingsManifest,requireCurrentFurnishingsRelease,checkedDefaultFurnishingsRoot,copyNativeFurnishings} from './package-native-runtime.mjs';
import {USER_ASSET_CATALOGUE} from '../packages/studio-contract/dist/user-asset-catalogue.js';
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.16.0.manifest.json',import.meta.url));
const prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.15.0.manifest.json',import.meta.url),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('1.16 retains all previous entries and distributes the separate grouped rail without private registry authority',async()=>{
 const manifest=JSON.parse(fixture),rail=manifest.assets.at(-1),entry=USER_ASSET_CATALOGUE.find(a=>a.id==='dark-track-network');
 assert.equal(fixture.length,23170);assert.equal(digest(fixture),'9302a6472a603b2ad21a693f848fd4670c41d04b51e563bbeae088dade825e81');
 assert.equal(manifest.bundleVersion,'1.16.0');assert.equal(manifest.assets.length,23);assert.deepEqual(manifest.assets.slice(0,22),prior.assets);
 assert.equal(rail.catalogId,'dark-track-network');assert.equal(rail.catalogVersion,1);assert.equal(rail.hostKind,'ceiling-rail');
 assert.equal(rail.model.sha256,'5cc5d772acd4087c5d7d26b5f24e2fe38626b1315e377210410954abf7d4ff44');assert.equal(rail.model.bytes,377576);
 assert.deepEqual(rail.model,{path:entry.path,mime:entry.mime,bytes:entry.bytes,sha256:entry.sha256});assert.equal(rail.rights.notice.bytes,675);assert.equal(rail.rights.notice.sha256,entry.rights.noticeSha256);assert.equal(rail.rights.notice.path,entry.rights.noticePath);
 assert.deepEqual(rail.provenance,{sourceSha256:rail.model.sha256,recipe:'original-v1'});assert.equal(rail.workspaceFurnishing,undefined);assert.equal(rail.fit,undefined);assert.equal(rail.thumbnail,undefined);
 const root=await realpath(await mkdtemp(join(tmpdir(),'default116-')));
 try{
  await writeFile(join(root,'manifest.json'),fixture);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'bb580b1e5be6e8a6f9c93cce2be586c791d86285',manifestSHA256:digest(fixture)});
  await writeFile(join(root,'manifest.json'),fixture.toString().replace('Dark Continuous Track Network','Dark Continuous Track NetworK'));await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('current immutable release copies both white and grouped original sources through existing guarded packaging',{skip:!process.env.EXHIBITOS_DEFAULT_116_FIXTURE},async()=>{
 const root=await realpath(process.env.EXHIBITOS_DEFAULT_116_FIXTURE);await requireCurrentFurnishingsRelease(root);const release=await checkedDefaultFurnishingsRoot(root),output=await realpath(await mkdtemp(join(tmpdir(),'default116-copy-')));
 try{
  assert.equal(release.commit,'bb580b1e5be6e8a6f9c93cce2be586c791d86285');assert.equal(release.manifestSHA256,digest(fixture));
  await copyNativeFurnishings(root,output,release);
  const manifest=JSON.parse(await readFile(join(output,'assets/furnishings/default-manifest.json'),'utf8'));
  for(const id of ['linear-track','dark-track-network']){const entry=manifest.assets.find(a=>a.catalogId===id);assert.equal(digest(await readFile(join(output,entry.model.path))),entry.model.sha256);assert.equal(digest(await readFile(join(output,entry.rights.notice.path))),entry.rights.notice.sha256);}
  assert.deepEqual(manifest.assets.slice(0,22),prior.assets);
 }finally{await rm(output,{recursive:true,force:true});}
});
