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
