// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasNativeDetailCapability,NATIVE_DETAIL_CAPABILITY} from './native-detail-capability.mjs';

test('native detail marker requires exact fixed regular-file bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-detail-capability-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'marker'),link=join(root,'link');
 assert.equal(Buffer.byteLength(NATIVE_DETAIL_CAPABILITY),177);assert.equal(createHash('sha256').update(NATIVE_DETAIL_CAPABILITY).digest('hex'),'9663e0fb346c78ebbd1b9e883bbd2400a1b968368d101102f0e0285c8e7deaef');
 assert.equal(await hasNativeDetailCapability(path),false);await writeFile(path,NATIVE_DETAIL_CAPABILITY);assert.equal(await hasNativeDetailCapability(path),true);await chmod(path,0o755);assert.equal(await hasNativeDetailCapability(path),false);await chmod(path,0o644);await symlink(path,link);assert.equal(await hasNativeDetailCapability(link),false);await writeFile(path,NATIVE_DETAIL_CAPABILITY+'\n');assert.equal(await hasNativeDetailCapability(path),false);
});
