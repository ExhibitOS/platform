// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyNativeFurnishings,verifyDefaultFurnishingsManifest,requireCurrentFurnishingsRelease,requireGpuModelPreparationFurnishingsRelease} from './package-native-runtime.mjs';
const release={commit:'6d338e8af0b7bed681c1cb7c6515241cb6c2ee57',manifestSHA256:'827048c2722f7ed6ecf4c77ec7a3d13f944e9987c2cdc0b36ae01b9d2175c9bd'};
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.11.0.manifest.json',import.meta.url));
const prior=await readFile(new URL('./fixtures/default-furnishings-1.10.0.manifest.json',import.meta.url));
const producer=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_111_TEST_ROOT,hash=b=>createHash('sha256').update(b).digest('hex');
async function temporary(t){const root=await realpath(await mkdtemp(join(tmpdir(),'default111-test-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('1.11 preserves every prior descriptor and adds the unchanged declared downlight with its rights notice',async t=>{
 const root=await temporary(t),manifest=JSON.parse(fixture);assert.equal(hash(fixture),release.manifestSHA256);assert.equal(fixture.length,16322);
 assert.equal(manifest.bundleVersion,'1.11.0');assert.equal(manifest.assets.length,18);assert.deepEqual(manifest.assets.slice(0,17),JSON.parse(prior).assets);
 assert.deepEqual(manifest.assets[17],{catalogId:'recessed-downlight',catalogVersion:1,name:'Recessed Downlight',hostKind:'light',model:{path:'assets/furnishings/user-authored-20261027/recessed-downlight/model.glb',mime:'model/gltf-binary',bytes:86480,sha256:'041c6c2c340a039f1eb82f70d925c1ecbe913276deaba5b447e540d67fc2e7bf'},rights:{licenseId:'CC0-1.0',notice:{path:'assets/furnishings/user-authored-20261027/recessed-downlight/LICENSE-NOTICE.txt',bytes:1569,sha256:'b878f7873013dd45d32bfd7d8003dfb7f57d5680d69e3ed3f24d461692bf7b8e'}},provenance:{sourceSha256:'041c6c2c340a039f1eb82f70d925c1ecbe913276deaba5b447e540d67fc2e7bf',recipe:'original-v1'}});
 await writeFile(join(root,'manifest.json'),fixture);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release);
 await assert.rejects(requireCurrentFurnishingsRelease(root));await assert.rejects(requireGpuModelPreparationFurnishingsRelease(root));
 const changed=JSON.parse(fixture);changed.assets[17].hostKind='pedestal';await writeFile(join(root,'manifest.json'),JSON.stringify(changed,null,2)+'\n');await assert.rejects(verifyDefaultFurnishingsManifest(root));
});
test('the frozen 1.11 source copies both downlight bytes and all retained pairs through the normal producer',{skip:!producer},async t=>{
 await assert.rejects(requireCurrentFurnishingsRelease(producer));await assert.rejects(requireGpuModelPreparationFurnishingsRelease(producer));
 const root=await temporary(t),out=join(root,'output');await mkdir(out);await copyNativeFurnishings(producer,out,release);
 for(const asset of JSON.parse(fixture).assets)for(const row of [asset.model,asset.rights.notice]){const bytes=await readFile(join(out,row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
 assert.deepEqual(await readFile(join(out,'assets/furnishings/default-manifest.json')),fixture);
 await assert.rejects(copyNativeFurnishings(producer,out,release));
});
