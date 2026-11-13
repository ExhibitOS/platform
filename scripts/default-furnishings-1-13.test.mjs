// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {verifyDefaultFurnishingsManifest,requireCurrentFurnishingsRelease} from './package-native-runtime.mjs';
const fixture=await readFile(new URL('./fixtures/default-furnishings-1.13.0.manifest.json',import.meta.url)),prior=JSON.parse(await readFile(new URL('./fixtures/default-furnishings-1.12.0.manifest.json',import.meta.url),'utf8'));
test('1.13 preserves all prior defaults and distributes the named rail as ordinary source rather than registry authority',async()=>{
 const m=JSON.parse(fixture),rail=m.assets.at(-1);assert.equal(m.bundleVersion,'1.13.0');assert.equal(m.assets.length,20);assert.deepEqual(m.assets.slice(0,19),prior.assets);
 assert.equal(createHash('sha256').update(fixture).digest('hex'),'3b7f67ab30b5537b7d2355fa76518569859d986e834f3f8c1b05cb8b5354ef9f');assert.equal(rail.catalogId,'linear-track');assert.equal(rail.hostKind,'ceiling-rail');assert.equal(rail.model.sha256,'1ba64842de525166018e941074852a3e041d07adf605674c7d7fadb02693a09e');assert.equal(rail.workspaceFurnishing,undefined);assert.equal(rail.thumbnail,undefined);
 const root=await realpath(await mkdtemp(join(tmpdir(),'default113-')));try{await writeFile(join(root,'manifest.json'),fixture);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'d6ba786808ab5bd159f565298c6a4b381d036ff1',manifestSHA256:'3b7f67ab30b5537b7d2355fa76518569859d986e834f3f8c1b05cb8b5354ef9f'});await assert.rejects(requireCurrentFurnishingsRelease(root));}finally{await rm(root,{recursive:true,force:true});}
});
