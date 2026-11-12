// SPDX-License-Identifier: AGPL-3.0-or-later
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm,symlink,unlink,chmod,readdir,realpath,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativePackageExcludedFiles,assertGpuModelPreparationPackageOptions,copyGpuModelPreparationSelectedFiles,verifyGpuModelEncoderPackageRoot,GPU_MODEL_ENCODER_PACKAGE,packageNativeRuntime,requireGpuModelPreparationFurnishingsRelease} from './package-native-runtime.mjs';
import {GPU_MODEL_PREPARATION_RECIPE} from '../apps/api/src/gpu-model-preparation-contract.ts';
import {MODEL_PREPARATION_CAPABILITY,GPU_MODEL_PREPARATION_MIGRATION,GPU_MODEL_PREPARATION_SHA256,GPU_MODEL_PREPARATION_MARKER,GPU_MODEL_PREPARATION_CAPABILITY,hasGpuModelPreparationCapability} from './native-oex-normal-catalog.mjs';
const source=fileURLToPath(new URL('../',import.meta.url)),relative='database/native-gpu-model-preparation/'+GPU_MODEL_PREPARATION_MIGRATION;
const realCreateHash=crypto.createHash,sha=bytes=>realCreateHash('sha256').update(bytes).digest('hex');
const selected={normalOexSelected:true,privateStaticEditor:true,workspaceMaterialSelected:true,workspaceImportSelected:true,workspaceWallImportSelected:true,workspaceFurnishingSelected:true,workspaceFurnishingWriterSelected:true,workspaceFurnishingPublicationSelected:true,workspaceMaterialPublicationSelected:true,workspaceMaterialMultimapSelected:true,workspaceFurnishingStoolSelected:true,workspaceFurnishingRoomVisualSelected:true,workspaceFurnishingArtworkFrameSelected:true,workspaceFurnishingArtworkFrameModelsSelected:true,workspaceArtworkFramePreparationSelected:true,workspacePortalFinishSelected:true,hayesOriginalSelected:true,hayesDispositionSelected:true,hayesReleaseSelected:true,modelPreparationSelected:true,gpuModelPreparationSelected:true,postgresProfile:'validation-full',privateWheatQualification:'2152f40102fc904b971a66fbedacaf6a157706c507ae59cb04c4ff6a886a6082',gpuModelEncoderRoot:'/synthetic-owned-encoder'};
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'gpu-selected-package-'))),input=join(root,'source'),output=join(root,'platform'),encoder=join(root,'synthetic-encoder');
 await mkdir(join(input,'database/native-gpu-model-preparation'),{recursive:true});await mkdir(join(input,'scripts'),{recursive:true});await mkdir(join(output,'scripts'),{recursive:true});await copyFile(join(source,relative),join(input,relative));
 for(const name of ['native-gpu-model-preparation-bootstrap.mjs','native-gpu-model-runtime.mjs'])await writeFile(join(input,'scripts',name),'// synthetic module, never executed\nexport const fixture=true;\n');
 await writeFile(join(output,'scripts/native-model-preparation-capability-v1.json'),MODEL_PREPARATION_CAPABILITY);
 const mappings=new Map(),noticeFiles=Array.from({length:21},(_,i)=>{const b=Buffer.from('synthetic notice '+i);return {path:'licenses/notice-'+i+'.txt',bytes:b.length,sha256:sha(b)};});
 for(const record of noticeFiles){await mkdir(join(encoder,'licenses'),{recursive:true,mode:0o700});await writeFile(join(encoder,record.path),'synthetic notice '+noticeFiles.indexOf(record),{mode:0o644});}
 const components=Buffer.alloc(GPU_MODEL_ENCODER_PACKAGE.components.bytes,32);Buffer.from(JSON.stringify({sourceCommit:'4d6fc70eaf62ad0558e63e8d97eb9766118327a6',noticeFiles})).copy(components);
 for(const [record,bytes]of [[GPU_MODEL_ENCODER_PACKAGE.executable,Buffer.alloc(GPU_MODEL_ENCODER_PACKAGE.executable.bytes,81)],[GPU_MODEL_ENCODER_PACKAGE.library,Buffer.alloc(GPU_MODEL_ENCODER_PACKAGE.library.bytes,82)],[GPU_MODEL_ENCODER_PACKAGE.components,components]]){await mkdir(join(encoder,record.path.split('/')[0]),{recursive:true,mode:0o700});await writeFile(join(encoder,record.path),bytes,{mode:record.mode});mappings.set(sha(bytes),record.sha256);}
 for(const [path,target]of Object.entries(GPU_MODEL_ENCODER_PACKAGE.links))await symlink(target,join(encoder,path));
 return {root,input,output,encoder,mappings,tracked:new Map([['database',new Set()]])};
}
/** Only the cryptographic boundary is mocked for synthetic non-executable blobs.
 * Real signed inputs are never copied or executed by this test. */
async function withSyntheticTool(f,work){
 const mocked=mock.method(crypto,'createHash',algorithm=>{const raw=realCreateHash(algorithm);return {update(chunk,...args){raw.update(chunk,...args);return this;},digest(encoding){const actual=raw.digest('hex'),value=f.mappings.get(actual)??actual;return encoding==='hex'?value:Buffer.from(value,'hex');}};});syncBuiltinESMExports();
 try{return await work();}finally{mocked.mock.restore();syncBuiltinESMExports();}
}
test('ordinary/fresh/050 tracked paths exclude inert049 independently of selected markers',()=>{
 for(const fresh of[false,true])for(const normal of[false,true]){const excluded=nativePackageExcludedFiles(fresh,normal);assert(excluded.has(relative));assert(excluded.has('database/native-workspace-furnishing-thumbnail/050_workspace_furnishing_thumbnail.sql'));}
});
test('only the exact full parent45 ordinary1.7 family can opt into049 before any command or destination write',async()=>{
 assert.doesNotThrow(()=>assertGpuModelPreparationPackageOptions(selected));
 for(const key of Object.keys(selected).filter(key=>selected[key]===true&&key!=='gpuModelPreparationSelected'))await assert.rejects(packageNativeRuntime('/never-created-gpu-package',{...selected,[key]:false}),/NATIVE_PACKAGE_INPUT_INVALID/);
 for(const key of ['freshOexValidation','workspaceFurnishingSelectedImport','workspaceMaterialSelectedImport','workspaceMaterialMultimapSelectedImport','modelAdoptionSelected','modelAdoptionCarriedTargetSelected','catalog045PreReadyPreservation','catalog045PreReadyHayesPreservation','freshImageSelected','largeModelSelected','largeModelRecoverySelected','infoStandPreparationSelected','workspaceFurnishingThumbnailsSelected','hayesReleaseProbeSelected','hayesDispositionProbeSelected','hayesSessionProbeSelected'])await assert.rejects(packageNativeRuntime('/never-created-gpu-package',{...selected,[key]:true}),/NATIVE_PACKAGE_INPUT_INVALID/);
 for(const change of [{gpuModelPreparationSelected:'true'},{gpuModelPreparationSelected:false},{gpuModelEncoderRoot:undefined},{gpuModelEncoderRoot:'relative'},{privateWheatQualification:'0'.repeat(64)},{postgresProfile:'core'}])await assert.rejects(packageNativeRuntime('/never-created-gpu-package',{...selected,...change}),/NATIVE_PACKAGE_INPUT_INVALID/);
 assert.doesNotThrow(()=>assertGpuModelPreparationPackageOptions({}));assert.doesNotThrow(()=>assertGpuModelPreparationPackageOptions({workspaceFurnishingThumbnailsSelected:true}));
});
test('049 source-copy opt-out creates no migration, marker or tool surface',async()=>{
 const f=await fixture();try{await copyGpuModelPreparationSelectedFiles(f.input,f.output,f.tracked,false);assert.deepEqual(await readdir(join(f.output,'scripts')),['native-model-preparation-capability-v1.json']);await assert.rejects(readFile(join(f.output,relative)),{code:'ENOENT'});}finally{await rm(f.root,{recursive:true,force:true});}
});
test('synthetic fixed signed-tool package copies exact049, six-field marker, two dynamic modules and complete notices',async()=>{
 const f=await fixture();try{await withSyntheticTool(f,async()=>{
  const verified=await verifyGpuModelEncoderPackageRoot(f.encoder);assert.equal(verified.files.length,24);await copyGpuModelPreparationSelectedFiles(f.input,f.output,f.tracked,true,f.encoder);
  assert.equal(sha(await readFile(join(f.output,relative))),GPU_MODEL_PREPARATION_SHA256);assert.equal(await readFile(join(f.output,'scripts',GPU_MODEL_PREPARATION_MARKER),'utf8'),GPU_MODEL_PREPARATION_CAPABILITY);assert.equal(await hasGpuModelPreparationCapability(join(f.output,'scripts',GPU_MODEL_PREPARATION_MARKER)),true);assert.equal(Object.keys(JSON.parse(GPU_MODEL_PREPARATION_CAPABILITY)).length,6);
  assert.equal((await lstat(join(f.output,'tools/ktx-4.4.2-noetc/bin/toktx'))).mode&0o777,0o755);assert.equal((await verifyGpuModelEncoderPackageRoot(join(f.output,GPU_MODEL_ENCODER_PACKAGE.runtimePrefix))).files.length,24);
  assert.equal(await readFile(join(f.output,'scripts/native-gpu-model-runtime.mjs'),'utf8'),await readFile(join(f.input,'scripts/native-gpu-model-runtime.mjs'),'utf8'));
 });}finally{await rm(f.root,{recursive:true,force:true});}
});
test('049 copy refuses missing/wrong parent45 without a readiness marker',async()=>{
 const f=await fixture();try{await writeFile(join(f.output,'scripts/native-model-preparation-capability-v1.json'),'wrong');await assert.rejects(copyGpuModelPreparationSelectedFiles(f.input,f.output,f.tracked,true,f.encoder),/NATIVE_PACKAGE_SOURCE_INVALID/);assert.equal(await hasGpuModelPreparationCapability(join(f.output,'scripts',GPU_MODEL_PREPARATION_MARKER)),false);}finally{await rm(f.root,{recursive:true,force:true});}
});
test('049 copy rejects altered migration and preserves failure without inventing a marker',async()=>{
 const f=await fixture();try{await withSyntheticTool(f,async()=>{await writeFile(join(f.input,relative),'tampered');await assert.rejects(copyGpuModelPreparationSelectedFiles(f.input,f.output,f.tracked,true,f.encoder),/NATIVE_PACKAGE_SOURCE_INVALID/);assert.equal(await hasGpuModelPreparationCapability(join(f.output,'scripts',GPU_MODEL_PREPARATION_MARKER)),false);});}finally{await rm(f.root,{recursive:true,force:true});}
});
for(const mode of ['extra','binary','mode','special-mode','library-link','missing-notice','symlink-file','hardlink-file'])test('signed-tool validation rejects '+mode+' without executing anything',async()=>{
 const f=await fixture();try{await withSyntheticTool(f,async()=>{
  if(mode==='extra')await writeFile(join(f.encoder,'bin/foreign'),'foreign');if(mode==='binary')await writeFile(join(f.encoder,'bin/toktx'),Buffer.alloc(993520,83));if(mode==='mode')await chmod(join(f.encoder,'bin/toktx'),0o644);if(mode==='special-mode')await chmod(join(f.encoder,'bin/toktx'),0o4755);
  if(mode==='library-link'){await unlink(join(f.encoder,'lib/libktx.dylib'));await symlink('libktx.4.4.2.dylib',join(f.encoder,'lib/libktx.dylib'));}
  if(mode==='missing-notice')await unlink(join(f.encoder,'licenses/notice-0.txt'));
  if(mode==='symlink-file'){await unlink(join(f.encoder,'bin/toktx'));await symlink(join(f.encoder,'lib/libktx.4.4.2.dylib'),join(f.encoder,'bin/toktx'));}
  if(mode==='hardlink-file'){const {link}=await import('node:fs/promises');await link(join(f.encoder,'bin/toktx'),join(f.root,'other-tool-name'));}
  await assert.rejects(verifyGpuModelEncoderPackageRoot(f.encoder),/NATIVE_PACKAGE_GPU_ENCODER_INVALID/);
 });}finally{await rm(f.root,{recursive:true,force:true});}
});
test('the049release guard refuses unpinned1.8/1.9 manifests instead of using current defaults',async()=>{
 const f=await fixture();try{await writeFile(join(f.input,'manifest.json'),JSON.stringify({bundleVersion:'1.9.0'}));await assert.rejects(requireGpuModelPreparationFurnishingsRelease(f.input),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);}finally{await rm(f.root,{recursive:true,force:true});}
});

test('fixed managed tool package pins match the actual signed source recipe and never the historical vendor build',()=>{const encoder=GPU_MODEL_PREPARATION_RECIPE.encoder;assert.equal('platform/'+GPU_MODEL_ENCODER_PACKAGE.runtimePrefix,encoder.runtimePrefix);assert.equal(GPU_MODEL_ENCODER_PACKAGE.executable.sha256,encoder.sha256);assert.equal(GPU_MODEL_ENCODER_PACKAGE.executable.bytes,encoder.bytes);assert.equal(GPU_MODEL_ENCODER_PACKAGE.library.sha256,encoder.librarySHA256);assert.equal(GPU_MODEL_ENCODER_PACKAGE.library.bytes,encoder.libraryBytes);});
