// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyNativeFurnishings,verifyDefaultFurnishingsManifest,requireCurrentFurnishingsRelease} from './package-native-runtime.mjs';
import authored from '../apps/api/src/installed-artwork-frames.json' with {type:'json'};
const release={commit:'7b2f8334a379bfcac80da4ad656fdb2e1db60f0a',manifestSHA256:'b265727004a7be3255b424c0d77dd649e601bd3409eb72fca522116c491c05ab'},fixture=await readFile(new URL('./fixtures/default-furnishings-1.12.0.manifest.json',import.meta.url)),prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.11.0.manifest.json',import.meta.url),'utf8')),hash=b=>createHash('sha256').update(b).digest('hex'),producer=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_112_TEST_ROOT;
async function temporary(t){const root=await realpath(await mkdtemp(join(tmpdir(),'default112-test-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('1.12 preserves eighteen defaults and declares the separate installed measured original with both notices',async t=>{
 const root=await temporary(t),manifest=JSON.parse(fixture),thin=manifest.assets.at(-1),metadata=authored.find(frame=>frame.catalogId==='thin-brass-frame');
 assert.equal(hash(fixture),release.manifestSHA256);assert.equal(fixture.length,19618);assert.equal(manifest.bundleVersion,'1.12.0');assert.equal(manifest.assets.length,19);assert.deepEqual(manifest.assets.slice(0,18),prior.assets);
 assert.deepEqual(thin.thumbnail,metadata.thumbnail);assert.deepEqual(thin.workspaceFurnishing,metadata.descriptor);assert.deepEqual(thin.provenance.sourceNotice,metadata.custodyFiles[0]);assert.deepEqual(thin.rights.notice,metadata.notice);assert.equal(thin.model.path,metadata.path);assert.equal(thin.provenance.sourceSha256,thin.model.sha256);assert.equal(thin.provenance.recipe,'original-v1');assert.notEqual(thin.workspaceFurnishing.id,'66d45ba8-457e-4d23-999d-f242fc1c7590');assert.equal(thin.workspaceFurnishing.imageFit,undefined);
 await writeFile(join(root,'manifest.json'),fixture);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release);await assert.rejects(requireCurrentFurnishingsRelease(root));
});
test('the normal asset copier preserves original model/license/source notice and every old declared pair',{skip:!producer},async t=>{
 await requireCurrentFurnishingsRelease(producer);const root=await temporary(t),out=join(root,'output');await mkdir(out);await copyNativeFurnishings(producer,out,release);
 for(const asset of JSON.parse(fixture).assets)for(const row of [asset.model,asset.rights.notice,...(asset.provenance.sourceNotice?[asset.provenance.sourceNotice]:[]),...(asset.thumbnail?[{path:asset.thumbnail.path,...asset.thumbnail.png}]:[])]){const bytes=await readFile(join(out,row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
 assert.deepEqual(await readFile(join(out,'assets/furnishings/default-manifest.json')),fixture);await assert.rejects(copyNativeFurnishings(producer,out,release));
});
