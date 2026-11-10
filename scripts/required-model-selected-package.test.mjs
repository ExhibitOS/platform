// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ADOPTION_CAPABILITY,ADOPTION_MARKER} from './native-model-adoption-owner-channel.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyModelPreparationSelectedFiles,packageNativeRuntime} from './package-native-runtime.mjs';
import {HAYES_RELEASE_CAPABILITY,MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_CAPABILITY,hasModelPreparationCapability,verifyModelPreparationMigration} from './native-oex-normal-catalog.mjs';
const source=fileURLToPath(new URL('../',import.meta.url)),relative='database/native-model-preparation/'+MODEL_PREPARATION_MIGRATION;
test('explicit045 copy verifies parent and migration, and uses the actual marker/catalog opener',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'selected-model-package-'))),platform=join(root,'platform'),tracked=new Map([['database',new Set()]]);
 try{
  await mkdir(join(platform,'scripts'),{recursive:true});
  await copyModelPreparationSelectedFiles(source,platform,tracked,false,true);
  await assert.rejects(readFile(join(platform,relative)),{code:'ENOENT'});assert.equal(await hasModelPreparationCapability(join(platform,'scripts/native-model-preparation-capability-v1.json')),false);
  await assert.rejects(copyModelPreparationSelectedFiles(source,platform,tracked,true,false),/NATIVE_PACKAGE_INPUT_INVALID/);
  await writeFile(join(platform,'scripts/native-hayes-release-capability-v1.json'),'wrong');await assert.rejects(copyModelPreparationSelectedFiles(source,platform,tracked,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
  await writeFile(join(platform,'scripts/native-hayes-release-capability-v1.json'),HAYES_RELEASE_CAPABILITY);
  await copyModelPreparationSelectedFiles(source,platform,tracked,true,true);
  assert.equal(await hasModelPreparationCapability(join(platform,'scripts/native-model-preparation-capability-v1.json')),true);
  assert.equal(await readFile(join(platform,'scripts/native-model-preparation-capability-v1.json'),'utf8'),MODEL_PREPARATION_CAPABILITY);
  assert.equal(await verifyModelPreparationMigration(join(platform,'database/native-model-preparation')),await readFile(join(source,relative),'utf8'));
  const altered=join(root,'altered');await mkdir(join(altered,'database/native-model-preparation'),{recursive:true});await copyFile(join(source,relative),join(altered,relative));await writeFile(join(altered,relative),'changed');await assert.rejects(copyModelPreparationSelectedFiles(altered,platform,tracked,true,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('selected045 rejects missing ordinary prerequisites and probe configurations before packaging',async()=>{
 for(const config of [{modelPreparationSelected:true},{modelPreparationSelected:'true'},{modelPreparationSelected:true,hayesReleaseSelected:true},{modelPreparationSelected:true,hayesReleaseSelected:true,privateStaticEditor:true,hayesReleaseProbeSelected:true},{modelPreparationSelected:true,hayesReleaseSelected:true,privateStaticEditor:true,workspaceFurnishingSelectedImport:true}])await assert.rejects(packageNativeRuntime('/unused',config),/NATIVE_PACKAGE_INPUT_INVALID/);
});

test('adoption packaging requires an ordinary 045 profile and pins the Manager marker',async()=>{
 const ordinary={modelPreparationSelected:true,modelAdoptionSelected:true};
 for(const config of [{modelAdoptionSelected:true},{modelAdoptionSelected:'true'},
  ...['catalog045PreReadyPreservation','catalog045PreReadyHayesPreservation','freshImageSelected','largeModelSelected','infoStandPreparationSelected'].map(key=>({...ordinary,[key]:true}))]){
  await assert.rejects(packageNativeRuntime('/unused',config),/NATIVE_PACKAGE_INPUT_INVALID/);
 }
 assert.equal(ADOPTION_MARKER,'native-model-adoption-capability-v1.json');
 assert.equal(createHash('sha256').update(ADOPTION_CAPABILITY).digest('hex'),'1cc2e6bc81fec1ef0aa6b6643dd177feff9480ad690d7b1b75e870b5072ca4a3');
});
