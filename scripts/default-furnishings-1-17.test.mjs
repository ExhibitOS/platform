// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyDefaultFurnishingsManifest} from './package-native-runtime.mjs';
test('1.17 preserves all23 originals and adds two separately named source-bound records',async()=>{
 const bytes=await readFile(new URL('./fixtures/default-furnishings-1.17.0.manifest.json',import.meta.url)),manifest=JSON.parse(bytes),prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.16.0.manifest.json',import.meta.url)));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'4751b398f8a1d6edd362004449655932fabfdd78de3500b74b29453b05d5475a');
 assert.equal(manifest.bundleVersion,'1.17.0');assert.equal(manifest.assets.length,25);assert.deepEqual(manifest.assets.slice(0,23),prior.assets);
 const [rail,spot]=manifest.assets.slice(23);assert.equal(rail.catalogId,'painting-rectangular-dark-track');assert.equal(rail.hostKind,'ceiling-rail');assert.equal(rail.model.sha256,'aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42');
 assert.equal(spot.catalogId,'museum-track-spot-fixed-64p1');assert.equal(spot.hostKind,'light');assert.equal(spot.model.sha256,'3cbe71cf0c6ed28cb99f16c34094b43dc1cb5b3f293406b2cec54e9fcbf0783a');
 const root=await realpath(await mkdtemp(join(tmpdir(),'default117-')));
 try{await writeFile(join(root,'manifest.json'),bytes);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'cc477089d9a0792a26563f9b618ecf6e962d2caf',manifestSHA256:'4751b398f8a1d6edd362004449655932fabfdd78de3500b74b29453b05d5475a'});await writeFile(join(root,'manifest.json'),Buffer.from(bytes.toString().replace('268820','268821')));await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);}finally{await rm(root,{recursive:true,force:true});}
});
