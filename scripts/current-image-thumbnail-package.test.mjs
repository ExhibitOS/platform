// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,readdir,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {nativePackageExcludedFiles,copyCurrentImageThumbnailSelectedFiles,packageNativeRuntime} from './package-native-runtime.mjs';
import {CURRENT_IMAGE_THUMBNAIL_MIGRATION as migration,CURRENT_IMAGE_THUMBNAIL_SHA256 as digest,CURRENT_IMAGE_THUMBNAIL_BYTES as size,CURRENT_IMAGE_THUMBNAIL_MARKER as marker,CURRENT_IMAGE_THUMBNAIL_CAPABILITY as capability,hasCurrentImageThumbnailCapability,verifyCurrentImageThumbnailMigration} from './native-oex-normal-catalog.mjs';
const relative='database/native-current-image-thumbnail/'+migration,sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'thumbnail-package-'))),source=join(root,'source'),output=join(root,'output');await mkdir(join(source,'database/native-current-image-thumbnail'),{recursive:true});await mkdir(join(output,'scripts'),{recursive:true});await copyFile(fileURLToPath(new URL('../'+relative,import.meta.url)),join(source,relative));return{root,source,output,tracked:new Map([['database',new Set()]])};}
test('051 is excluded from every default tracked database payload, including ordinary selected modes',()=>{for(const fresh of[false,true])for(const selected of[false,true])assert(nativePackageExcludedFiles(fresh,selected).has(relative));});
test('only explicit boolean opt-in copies the exact051 and strict parent45/profile marker',async()=>{const f=await fixture();try{
 await copyCurrentImageThumbnailSelectedFiles(f.source,f.output,f.tracked,false);assert.deepEqual(await readdir(join(f.output,'scripts')),[]);await copyCurrentImageThumbnailSelectedFiles(f.source,f.output,f.tracked,true);
 const sql=await readFile(join(f.output,relative)),bytes=await readFile(join(f.output,'scripts',marker));assert.equal(sql.length,size);assert.equal(sha(sql),digest);assert(bytes.equals(Buffer.from(capability)));assert.deepEqual(JSON.parse(bytes),{format:1,kind:'exhibitos-native-current-image-thumbnail',profile:'current-approved-image-thumbnail-256-v1',parentCatalog:45,migration,migrationSHA256:digest});assert.equal(await hasCurrentImageThumbnailCapability(join(f.output,'scripts',marker)),true);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('missing/tampered/symlinked schema or nonexact marker refuse without accepting inert data as a capability',async()=>{const f=await fixture();try{
 assert.equal(await hasCurrentImageThumbnailCapability(join(f.output,'scripts',marker)),false);
 for(const value of[capability.trim(),JSON.stringify({...JSON.parse(capability),parentCatalog:46})+'\n',JSON.stringify({...JSON.parse(capability),extra:true})+'\n']){await writeFile(join(f.output,'scripts',marker),value);await assert.rejects(hasCurrentImageThumbnailCapability(join(f.output,'scripts',marker)),/NATIVE_OEX_CATALOG/);}
 await writeFile(join(f.source,relative),'changed');await assert.rejects(copyCurrentImageThumbnailSelectedFiles(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 await rm(join(f.source,relative));await symlink(fileURLToPath(new URL('../'+relative,import.meta.url)),join(f.source,relative));await assert.rejects(verifyCurrentImageThumbnailMigration(join(f.source,'database/native-current-image-thumbnail')),/NATIVE_OEX_CATALOG/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('opt-in rejects missing parent and incompatible048/046/047/catalog045-adoption combinations before any command or destination write',async()=>{
 const base={currentImageThumbnailSelected:true,modelPreparationSelected:true,workspaceFurnishingWriterSelected:true};
 for(const change of[{modelPreparationSelected:false},{workspaceFurnishingWriterSelected:false},{infoStandPreparationSelected:true},{freshImageSelected:true},{largeModelSelected:true},{modelAdoptionSelected:true},{modelAdoptionCarriedTargetSelected:true},{catalog045PreReadyPreservation:true},{currentImageThumbnailSelected:'true'}])await assert.rejects(packageNativeRuntime('/never-created-thumbnail-package',{...base,...change}),/NATIVE_PACKAGE_INPUT_INVALID/);
});
