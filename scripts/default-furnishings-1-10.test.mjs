// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyNativeFurnishings,verifyDefaultFurnishingsManifest,requireCurrentFurnishingsRelease,requireGpuModelPreparationFurnishingsRelease} from './package-native-runtime.mjs';
const release={commit:'6625b27c5ebfdac09d0e97c0747740a6ebd4039c',manifestSHA256:'de68b06af7edd6ab36d60ba44400059ec00f52f57d0dc4a46cb5245d55951096'};
const modelPath='assets/furnishings/exhibitos-authored-20261112/sculpture-bench-refined/model.glb',noticePath=modelPath.replace('model.glb','LICENSE-NOTICE.txt');
const digest=b=>createHash('sha256').update(b).digest('hex');
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.10.0.manifest.json',import.meta.url));
const producerRoot=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_110_TEST_ROOT;
async function temporary(t){const root=await realpath(await mkdtemp(join(tmpdir(),'default110-test-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('1.10 admits the exact new original while preserving all16 prior distribution records',async t=>{
 const root=await temporary(t),manifest=JSON.parse(fixture),prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.9.0.manifest.json',import.meta.url)));
 assert.equal(fixture.length,15460);assert.equal(digest(fixture),release.manifestSHA256);assert.equal(manifest.bundleVersion,'1.10.0');assert.equal(manifest.assets.length,17);assert.deepEqual(manifest.assets.slice(0,16),prior.assets);
 assert.deepEqual(manifest.assets[16],{catalogId:'sculpture-bench-refined',catalogVersion:1,name:'Sculpture Bench Refined',hostKind:'bench',model:{path:modelPath,mime:'model/gltf-binary',bytes:345608,sha256:'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9'},rights:{licenseId:'CC0-1.0',notice:{path:noticePath,bytes:892,sha256:'4e14161b2a63d79429a0f4861d0e8400691ad84d80f4b8974f48b1644db359b9'}},provenance:{sourceSha256:'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9',recipe:'original-v1'}});
 await writeFile(join(root,'manifest.json'),fixture);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release);
 // Matching bytes do not grant a caller-controlled directory the release Git identity.
 await assert.rejects(requireCurrentFurnishingsRelease(root));
 const changed=Buffer.from(fixture);changed[changed.length-2]^=1;await writeFile(join(root,'manifest.json'),changed);await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});
test('historical1.10 remains auditable separately from current normal and B049 fixed1.7 admission',async t=>{
 const root=await temporary(t),prior=await readFile(new URL('./fixtures/default-furnishings-1.9.0.manifest.json',import.meta.url));
 await writeFile(join(root,'manifest.json'),prior);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'8dee4eebb0d36d74d3d8cd955c9faf2c6bd2904a',manifestSHA256:'957af345c80951c287ce5492e0078769b800b3f889c19c24365b31b5e1c591ad'});await assert.rejects(requireCurrentFurnishingsRelease(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
 await writeFile(join(root,'manifest.json'),fixture);await assert.rejects(requireGpuModelPreparationFurnishingsRelease(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});
test('normal1.10 source admission and existing copier include the newbench and all retained pairs',{skip:!producerRoot},async t=>{
 const root=await temporary(t);const head=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:producerRoot,encoding:'utf8'}).trim();
 assert.ok([release.commit,'9fa51fe913273e03cf0a74169f266049188defcd'].includes(head));await assert.rejects(requireCurrentFurnishingsRelease(producerRoot),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
 const output=join(root,'output');await mkdir(output);await copyNativeFurnishings(producerRoot,output,release);
 for(const item of JSON.parse(fixture).assets)for(const path of [item.model.path,item.rights.notice.path])assert((await lstat(join(output,path))).isFile());
 assert.equal(digest(await readFile(join(output,modelPath))),'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9');assert.equal(digest(await readFile(join(output,noticePath))),'4e14161b2a63d79429a0f4861d0e8400691ad84d80f4b8974f48b1644db359b9');assert.deepEqual(await readFile(join(output,'assets/furnishings/default-manifest.json')),fixture);
 // Existing output ownership remains exclusive; distribution is never overwritten.
 await assert.rejects(copyNativeFurnishings(producerRoot,output,release));
});
