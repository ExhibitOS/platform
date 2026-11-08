// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePackageExcludedFiles} from './package-native-runtime.mjs';
test('ordinary package tracked database inventory excludes unselected 045 and retains base25',()=>{
 const paths=execFileSync('/usr/bin/git',['ls-files','--','database'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}).trim().split('\n'),supplement='database/native-model-preparation/045_required_model_preparation.sql';
 assert(paths.includes(supplement));
 for(const fresh of [false,true])for(const selected of [false,true]){
  const excluded=nativePackageExcludedFiles(fresh,selected),copied=paths.filter(path=>!excluded.has(path));
  assert(!copied.includes(supplement));assert.equal(copied.filter(path=>/^database\/migrations\/.*\.sql$/.test(path)).length,25);
 }
});
