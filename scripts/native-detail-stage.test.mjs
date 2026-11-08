// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncNativeDetailStage} from './native-detail-stage.mjs';

test('syncs files and nested directories and rejects symlinks and cancellation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'detail-stage-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'nested'));await writeFile(join(root,'nested','file'),'content');await syncNativeDetailStage(root,AbortSignal.timeout(1000));
 await symlink(join(root,'nested','file'),join(root,'link'));await assert.rejects(syncNativeDetailStage(root,AbortSignal.timeout(1000)),/NATIVE_DETAIL_STAGE/);await rm(join(root,'link'));const controller=new AbortController();controller.abort();await assert.rejects(syncNativeDetailStage(root,controller.signal));
});
