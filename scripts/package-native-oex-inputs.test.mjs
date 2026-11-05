// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,symlink,realpath,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {copyFreshOexValidationFiles,copyNormalOexSelectedFile,writeNormalOexCapability} from './package-native-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const spec='vendor/exhibitos-spec-0.1.0-draft.15.tgz',migration='database/fresh-oex-test/026_oex_bounded.sql',normal='database/native-oex-normal/026_oex_file_profile.sql',provenance='database/native-oex-normal/027_oex_exhibition_provenance.sql',material='database/native-oex-normal/028_oex_material_catalogue.sql',floor='database/native-oex-normal/029_oex_quiet_oak_floor.sql';
async function fixture(){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-oex-package-'))),source=join(temp,'source'),output=join(temp,'output');await mkdir(source);await mkdir(output);
 for(const name of [spec,migration,normal,provenance,material,floor]){await mkdir(dirname(join(source,name)),{recursive:true});await copyFile(join(root,name),join(source,name));}
 await writeFile(join(source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':`file:${spec}`}}}}));
 return {temp,source,output,tracked:new Map([['database',new Set()],['vendor',new Set()]])};
}
test('includes locked spec in both modes and test migration only when explicitly requested',async()=>{
 const f=await fixture();try{
  await copyFreshOexValidationFiles(f.source,f.output,f.tracked,false);assert.deepEqual(await readFile(join(f.output,spec)),await readFile(join(f.source,spec)));await assert.rejects(readFile(join(f.output,migration)),{code:'ENOENT'});
  await mkdir(join(f.temp,'second'));await copyFreshOexValidationFiles(f.source,join(f.temp,'second'),f.tracked,true);assert.deepEqual(await readFile(join(f.temp,'second',migration)),await readFile(join(f.source,migration)));
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('rejects changed or symlinked input and verifies already-copied tracked output',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.source,migration),'changed');await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
  await rm(join(f.source,spec));await symlink(join(root,spec),join(f.source,spec));await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,false),/NATIVE_PACKAGE_INPUT_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
 const g=await fixture();try{await mkdir(join(g.output,'vendor'));await writeFile(join(g.output,spec),'bad');g.tracked.get('vendor').add(spec);await assert.rejects(copyFreshOexValidationFiles(g.source,g.output,g.tracked,false),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(g.temp,{recursive:true,force:true});}
});

test('accepts already-copied tracked inputs only after checking their exact bytes',async()=>{
 const f=await fixture();try{
  for(const path of [spec,migration]){await mkdir(dirname(join(f.output,path)),{recursive:true});await copyFile(join(f.source,path),join(f.output,path));f.tracked.get(path.split('/')[0]).add(path);}
  await copyFreshOexValidationFiles(f.source,f.output,f.tracked,true);
  await writeFile(join(f.output,migration),'changed');await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});

test('includes the exact normal selected migration only with explicit opt-in',async()=>{const f=await fixture();try{await copyNormalOexSelectedFile(f.source,f.output,f.tracked,false);await assert.rejects(readFile(join(f.output,normal)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,provenance)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,material)),{code:'ENOENT'});await assert.rejects(readFile(join(f.output,floor)),{code:'ENOENT'});await copyNormalOexSelectedFile(f.source,f.output,f.tracked,true);assert.deepEqual(await readFile(join(f.output,floor)),await readFile(join(f.source,floor)));assert.deepEqual(await readFile(join(f.output,normal)),await readFile(join(f.source,normal)));assert.deepEqual(await readFile(join(f.output,provenance)),await readFile(join(f.source,provenance)));assert.deepEqual(await readFile(join(f.output,material)),await readFile(join(f.source,material)));await writeFile(join(f.source,normal),'changed');await assert.rejects(copyNormalOexSelectedFile(f.source,join(f.temp,'other'),f.tracked,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('normal selected payload requires the pinned OEX spec',async()=>{const f=await fixture();try{await writeFile(join(f.source,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@exhibitos/spec':'different'}}}}));await assert.rejects(copyFreshOexValidationFiles(f.source,f.output,f.tracked,false,true),/NATIVE_PACKAGE_SOURCE_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}});

test('selected capability has exact sealed bytes, is absent by default and refuses replacement',async()=>{const f=await fixture();try{
 const path=join(f.output,'scripts/native-normal-oex-capability-v1.json'),v3=join(f.output,'scripts/native-normal-oex-027-capability-v3.json');await mkdir(dirname(path));
 await writeNormalOexCapability(f.output,false);await assert.rejects(readFile(path),{code:'ENOENT'});await assert.rejects(readFile(v3),{code:'ENOENT'});
 await writeNormalOexCapability(f.output,true);
 assert.equal(await readFile(path,'utf8'),'{"format":1,"kind":"exhibitos-native-normal-oex","protocol":"normal-oex-v1","ownerChannelVersion":2,"schemaPath":"platform/database/native-oex-normal/026_oex_file_profile.sql","schemaSHA256":"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112","archiveFormat":"1.0.0-draft.9","maxArchiveBytes":536870912,"oneShot":true}');
 const proofBytes=await readFile(v3);assert.equal(proofBytes.length,516);assert.equal(createHash('sha256').update(proofBytes).digest('hex'),'f9eecec7b17a7f010a94bcc8711326a44261c9713249b01231cc62b86b18eb6d');
 const proof=JSON.parse(proofBytes.toString('utf8')); assert.deepEqual(proof,{format:1,kind:'exhibitos-native-normal-oex-027',protocol:'normal-oex-027-v3',ownerChannelVersion:3,baseSchemaPath:'platform/database/native-oex-normal/026_oex_file_profile.sql',baseSchemaSHA256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112',schemaPath:'platform/database/native-oex-normal/027_oex_exhibition_provenance.sql',schemaSHA256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7',archiveFormat:'1.0.0-draft.9',maxArchiveBytes:536870912,oneShot:true});
 const v4=await readFile(join(f.output,'scripts/native-normal-oex-028-capability-v4.json'));assert.equal(v4.length,787);assert.equal(createHash('sha256').update(v4).digest('hex'),'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4');
 const supplement=await readFile(join(f.output,'scripts/native-normal-oex-029-floor-capability-v4.json'));const floorProof=JSON.parse(supplement);assert.deepEqual(floorProof,{format:1,kind:'exhibitos-native-normal-oex-floor-supplement',protocol:'normal-oex-028-v4',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',parentCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',schemaPath:'platform/'+floor,schemaSHA256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a',packId:'quiet-oak-herringbone',packVersion:1,freshOnly:true});assert.equal(supplement.toString(),JSON.stringify(floorProof));
 const stat=await lstat(path);assert.ok(stat.isFile());assert.equal(stat.mode & 0o111,0);
 await assert.rejects(writeNormalOexCapability(f.output,true),{code:'EEXIST'});
 }finally{await rm(f.temp,{recursive:true,force:true});}});

test('rejects changed or symlinked 027 provenance input',async()=>{for(const kind of ['changed','symlink']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,provenance),'changed');else{await rm(join(f.source,provenance));await symlink(join(root,provenance),join(f.source,provenance));}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});

test('rejects changed or symlinked028 material input',async()=>{for(const kind of ['changed','symlink']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,material),'changed');else{await rm(join(f.source,material));await symlink(join(root,material),join(f.source,material));}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});

// Prior migration bytes remain checked independently; the new supplement must
// also reject source drift, symlinks and changed already-copied tracked bytes.
test('rejects changed, symlinked or drifted tracked029 floor migration',async()=>{for(const kind of ['changed','symlink','tracked']){const f=await fixture();try{if(kind==='changed')await writeFile(join(f.source,floor),'changed');else if(kind==='symlink'){await rm(join(f.source,floor));await symlink(join(root,floor),join(f.source,floor));}else{await mkdir(dirname(join(f.output,floor)),{recursive:true});await writeFile(join(f.output,floor),'changed');f.tracked.get('database').add(floor);}await assert.rejects(copyNormalOexSelectedFile(f.source,f.output,f.tracked,true),/NATIVE_PACKAGE_(SOURCE|INPUT)_INVALID/);}finally{await rm(f.temp,{recursive:true,force:true});}}});
