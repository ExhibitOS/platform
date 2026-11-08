// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./native-detail-v4-failure-child.mjs',import.meta.url));
for(const [mode,expected] of [['corrupt','STATIC_DETAIL_HASH'],['alias','STATIC_DETAIL_ALIAS'],['withdraw','STATIC_PUBLICATION_CHANGED']])test(`synthetic v4 ${mode} fails before final promotion`,{timeout:10000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'detail-v4-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));const stage=join(root,'stage'),runtime=join(root,'runtime');await mkdir(stage);await mkdir(runtime);await writeFile(join(runtime,'static.html'),'<html><head><meta content="STATIC_INDEX_SHA256"></head><body><div id="root"></div></body></html>');
 const child=spawn(process.execPath,[fixture,mode,runtime],{cwd:stage,stdio:['ignore','pipe','pipe']}),closed=once(child,'close');t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});let out='',err='';child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});assert.deepEqual(await closed,[0,null],err);assert.equal(out.trim(),expected);assert((await lstat(stage)).isDirectory());
});
