// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {copyNativeFurnishingSupport,copyNativeOwnerSupport} from './package-native-runtime.mjs';

test('the packaged furnishing admission and recovery modules import without the source tree',async()=>{
 const output=await mkdtemp(join(tmpdir(),'furnishing-support-package-'));
 try{await copyNativeFurnishingSupport(fileURLToPath(new URL('../',import.meta.url)),output);const admission=await import(pathToFileURL(join(output,'scripts/native-workspace-furnishing-admission.mjs')).href);const recovery=await import(pathToFileURL(join(output,'scripts/native-workspace-furnishing-recovery.mjs')).href);assert.equal(typeof admission.acceptFurnishingWriterLease,'function');assert.equal(typeof recovery.recoverFurnishingWriterClaims,'function');}finally{await rm(output,{recursive:true,force:true});}
});


test('packaged owner channel modules load without the source tree',async()=>{
 const output=await mkdtemp(join(tmpdir(),'native-owner-package-'));
 try{await copyNativeOwnerSupport(fileURLToPath(new URL('../',import.meta.url)),output);const normal=await import(pathToFileURL(join(output,'scripts/native-owner-channel.mjs')).href),hayes=await import(pathToFileURL(join(output,'scripts/native-hayes-owner-channel.mjs')).href);assert.equal(typeof normal.openNativeOwnerChannel,'function');assert.equal(typeof hayes.openHayesOwnerChannel,'function');const adoption=await import(pathToFileURL(join(output,'scripts/native-model-adoption-owner-channel.mjs')).href);assert.equal(typeof adoption.openAdoptionOwnerChannel,'function');}finally{await rm(output,{recursive:true,force:true});}
});

test('054 is explicit and selected payloads exclude the sibling supplemental SQL files',async()=>{
 const {assertHayesPreopenTerminalPackageSelection,nativePackageExcludedFiles}=await import('./package-native-runtime.mjs');
 const {HAYES_PREOPEN_TERMINAL_MARKER,HAYES_PREOPEN_TERMINAL_CAPABILITY}=await import('./native-oex-normal-catalog.mjs');
 const {createHash}=await import('node:crypto');
 const complete={hayesPreopenTerminalSelected:true,hayesReleaseSelected:true,
  workspaceFurnishingThumbnailsSelected:true,currentImageThumbnailSelected:true};
 assert.doesNotThrow(()=>assertHayesPreopenTerminalPackageSelection(complete));
 for(const flag of ['hayesReleaseSelected','workspaceFurnishingThumbnailsSelected','currentImageThumbnailSelected']){
  assert.throws(()=>assertHayesPreopenTerminalPackageSelection({...complete,[flag]:false}),/NATIVE_PACKAGE_INPUT_INVALID/);
 }
 assert.throws(()=>assertHayesPreopenTerminalPackageSelection({...complete,hayesPreopenTerminalSelected:'true'}),/NATIVE_PACKAGE_INPUT_INVALID/);
 assert(nativePackageExcludedFiles(false,true).has('database/native-hayes-preopen-terminal/054_hayes_preopen_terminal.sql'));
 assert(nativePackageExcludedFiles(false,true).has('scripts/'+HAYES_PREOPEN_TERMINAL_MARKER));
 const selected=nativePackageExcludedFiles(false,true,true);
 assert(selected.has('database/native-workspace-bench-basecolor-preparation/052_workspace_bench_basecolor_preparation.sql'));
 assert(selected.has('database/native-oex-current-workspace-rail/053_oex_current_workspace_rail.sql'));
 assert.equal(createHash('sha256').update(HAYES_PREOPEN_TERMINAL_CAPABILITY).digest('hex'),
  '2d2709a4993a617b61a3120724ed75b8cb68ce6ff588f3970141346ec83f6799');
});

test('055 is an explicit 054-only bench successor with the existing visual and preparation capabilities',async()=>{
 const {assertHayesPreopenTerminalPackageSelection,nativePackageExcludedFiles}=await import('./package-native-runtime.mjs');
 const {BENCH_AFTER_TERMINAL_DIRECTORY,BENCH_AFTER_TERMINAL_MIGRATION,BENCH_AFTER_TERMINAL_MARKER}=await import('./native-oex-normal-catalog.mjs');
 const options={benchAfterTerminalSelected:true,hayesPreopenTerminalSelected:true,hayesReleaseSelected:true,
  workspaceFurnishingThumbnailsSelected:true,currentImageThumbnailSelected:true,
  workspaceArtworkFramePreparationSelected:true,workspaceFurnishingRoomVisualSelected:true};
 assert.doesNotThrow(()=>assertHayesPreopenTerminalPackageSelection(options));
 for(const flag of ['hayesPreopenTerminalSelected','workspaceArtworkFramePreparationSelected','workspaceFurnishingRoomVisualSelected'])
  assert.throws(()=>assertHayesPreopenTerminalPackageSelection({...options,[flag]:false}),/NATIVE_PACKAGE_INPUT_INVALID/);
 for(const paths of [nativePackageExcludedFiles(false,true),nativePackageExcludedFiles(false,true,true)]){
  assert(paths.has(BENCH_AFTER_TERMINAL_DIRECTORY+'/'+BENCH_AFTER_TERMINAL_MIGRATION));
  assert(paths.has('scripts/'+BENCH_AFTER_TERMINAL_MARKER));
 }
});
