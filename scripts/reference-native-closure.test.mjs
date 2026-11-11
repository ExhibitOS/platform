// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readNativeReferenceClosure,exportNativeReferenceClosure,inspectNativeReferenceClosure} from './reference-native-closure.mjs';
import {isRefreshedShellPath} from './refresh-native-detail-shell.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Only malformed-input fixtures. No synthetic pin can become R97 authority. */
async function fixture(){
 const parent=await realpath(await mkdtemp(join(tmpdir(),'reference-native-input-'))),root=join(parent,'bundle');await mkdir(root);
 const files=[],put=async(path,data)=>{const bytes=Buffer.from(data);await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);files.push({path,bytes:bytes.length,sha256:hash(bytes)});};
 for(const path of ['source/static-export-manifest.json','source/static-publication-index.json',...Array.from({length:138},(_,i)=>`source/assets/source${i}.js`)])await put(path,'synthetic unqualified input');
 for(const path of ['web/static.html','web/static-studio.html',...Array.from({length:34},(_,i)=>`web/assets/web${i}.js`)])await put(path,'synthetic unqualified web');
 await put('web-inventory.json',JSON.stringify({format:'exhibitos-static-web-input-v1',buildId:'a'.repeat(64),files:files.filter(item=>item.path.startsWith('web/')).map(item=>({...item,path:item.path.slice(4)}))}));
 await put('closure.json',JSON.stringify({format:'exhibitos-reference-native-closure-v1',publication:{publicationId:'00000000-0000-4000-8000-000000000001',revisionSha256:'a'.repeat(64),indexSha256:'a'.repeat(64),manifestSha256:'a'.repeat(64)},viewer:{sourceCommit:'a'.repeat(40),sourceTree:'a'.repeat(40),lockSha256:'a'.repeat(64),buildId:'a'.repeat(64),inventorySha256:'a'.repeat(64)},paths:{source:'source',web:'web',webInventory:'web-inventory.json'}}));
 const inventory={format:'exhibitos-reference-native-input-v1',indexSha256:'a'.repeat(64),files};
 const input={inputRoot:root,inventorySha256:''};
 const repin=async()=>{const bytes=Buffer.from(JSON.stringify(inventory));await writeFile(join(root,'integrity.json'),bytes);input.inventorySha256=hash(bytes);};await repin();
 return {parent,root,inventory,input,repin};
}

test('requires exact explicit integrity pin and a canonical absolute public input root',async()=>{
 const f=await fixture();try{
  await assert.rejects(readNativeReferenceClosure({...f.input,extra:true}),/REFERENCE_NATIVE_REQUEST/);
  await assert.rejects(readNativeReferenceClosure({...f.input,inventorySha256:'0'.repeat(64)}),/REFERENCE_NATIVE_INTEGRITY/);
  await assert.rejects(readNativeReferenceClosure({...f.input,inputRoot:'relative'}),/REFERENCE_NATIVE_PATH/);
  const alias=join(f.parent,'alias');await symlink(f.root,alias);await assert.rejects(readNativeReferenceClosure({...f.input,inputRoot:alias}),/REFERENCE_NATIVE_PATH/);
 }finally{await rm(f.parent,{recursive:true,force:true});}
});

test('rejects duplicate/traversing inventory rows, unexpected files, links and changed bytes',async()=>{
 for(const mutate of [
  async f=>{f.inventory.files[1]={...f.inventory.files[0]};await f.repin();},
  async f=>{f.inventory.files[0].path='source/../foreign';await f.repin();},
  async f=>{await writeFile(join(f.root,'provenance.json'),'unlisted extra');},
  async f=>{const path=join(f.root,'web/assets/web0.js');await rm(path);await symlink(join(f.root,'closure.json'),path);},
  async f=>{await writeFile(join(f.root,'source/assets/source0.js'),'tampered');},
 ]){
  const f=await fixture();try{await mutate(f);await assert.rejects(readNativeReferenceClosure(f.input));}finally{await rm(f.parent,{recursive:true,force:true});}
 }
});

test('complete self-consistent but unqualified bundles do not create reference or publication authority',async()=>{
 const f=await fixture();try{await assert.rejects(readNativeReferenceClosure(f.input),/REFERENCE_NATIVE_CLOSURE/);}finally{await rm(f.parent,{recursive:true,force:true});}
});

test('export refuses overlap/existing output and removes only its own failed staging and lock',async()=>{
 const f=await fixture();try{
  await assert.rejects(exportNativeReferenceClosure({...f.input,outputDir:join(f.root,'nested')}),/REFERENCE_NATIVE_PATH/);
  const existing=join(f.parent,'existing');await mkdir(existing);await writeFile(join(existing,'preserved'),'sentinel');
  await assert.rejects(exportNativeReferenceClosure({...f.input,outputDir:existing}),/REFERENCE_NATIVE_OUTPUT_EXISTS/);assert.equal(await readFile(join(existing,'preserved'),'utf8'),'sentinel');
  await assert.rejects(exportNativeReferenceClosure({...f.input,outputDir:join(f.parent,'new-output')}),/REFERENCE_NATIVE_CLOSURE/);
  const names=await readdir(f.parent);assert(!names.includes('new-output'));assert(!names.some(name=>name.startsWith('.reference-native-closure-')||name.endsWith('.reference-native-closure.lock')));assert(names.includes('bundle'));assert(names.includes('existing'));
 }finally{await rm(f.parent,{recursive:true,force:true});}
});

const actual=process.env.EXHIBITOS_REFERENCE_NATIVE_CLOSURE,pin=process.env.EXHIBITOS_REFERENCE_NATIVE_INTEGRITY_SHA256;
test('preserves qualified publication content and applies exact session-only hosting configuration from the public closure',{skip:!actual||!pin},async t=>{
 const inputRoot=await realpath(resolve(actual)),source=await readNativeReferenceClosure({inputRoot,inventorySha256:pin}),parent=await realpath(await mkdtemp(join(dirname(inputRoot),'.reference-native-integration-')));t.after(()=>rm(parent,{recursive:true,force:true}));
 const outputDir=join(parent,'output'),result=await exportNativeReferenceClosure({inputRoot,inventorySha256:pin,outputDir});
 assert.equal(result.nativeManifestSha256,source.reference.nativeManifestSha256);assert.notEqual(result.manifestSha256,source.reference.nativeManifestSha256);assert.equal(result.hostingMode,'session-v1');assert.equal(result.rawFiles,source.sourceEntries.size);assert.equal(result.outputFiles,source.sourceEntries.size+1);assert.equal(result.files,source.sourceEntries.size+1);assert.equal(result.viewerBuildId,source.reference.viewerBuildId);
 for(const path of ['index.html','studio.html']){
  const original=await readFile(join(source.sourceRoot,path),'utf8'),html=await readFile(join(outputDir,path),'utf8');
  if(source.reference.viewerBuildId==='b54b543b7b9f5d14a3e0ed750240c087d50baa0302209e6dd4f71a93680f27a1'){
   assert.equal(html,original.replace('</head>','<meta name="exhibitos-demo-decoration" content="session-v1"></head>'));
   assert.equal(result.manifestSha256,'b6c1bd0277e2f453646d0f0640f91889e17fb4b10e31c5b8fa45bb95879613a6');
  }
  assert(html.includes(`<meta name="exhibitos-viewer-build-id" content="${source.reference.viewerBuildId}">`));
  if(path==='index.html'){
   assert.equal(html.match(/<title>[^<]*<\/title>/)?.[0],original.match(/<title>[^<]*<\/title>/)?.[0]);
   assert.equal(html.match(/<body>[\s\S]*<\/body>/)?.[0],original.match(/<body>[\s\S]*<\/body>/)?.[0]);
  }
  assert.equal(html.split('exhibitos-demo-decoration').length,2);
 }
 for(const path of source.sourceEntries.keys()){
  if(path==='static-export-manifest.json'||isRefreshedShellPath(path))continue;
  assert.deepEqual(await readFile(join(outputDir,path)),await readFile(join(source.sourceRoot,path)));
 }
 assert.deepEqual(await readFile(join(outputDir,'static-publication-index.json')),await readFile(join(source.sourceRoot,'static-publication-index.json')));
 await inspectNativeReferenceClosure({output:outputDir,inputRoot,inventorySha256:pin});
 for(const [path]of source.webEntries){
  if(['static.html','static-studio.html'].includes(path))continue;
  assert.deepEqual(await readFile(join(outputDir,path)),await readFile(join(source.webRoot,path)));
 }
 const {inspectDemo}=await import('./deploy-reference-demo.mjs');
 const proof=await inspectDemo({output:outputDir,pin:source.reference.indexSha256,commit:'tool-producer',nativeClosure:{inputRoot,inventorySha256:pin}});
 assert.equal(proof.sourceCommit,'tool-producer');assert.equal(proof.viewerSourceCommit,source.reference.viewerSourceCommit);
 await assert.rejects(inspectDemo({output:outputDir,pin:source.reference.indexSha256,commit:'tool-producer'}),/REFERENCE_NATIVE_REQUEST/);
 const studio=await readFile(join(outputDir,'studio.html'));
 await writeFile(join(outputDir,'studio.html'),studio.toString('utf8').replace('content="session-v1"','content="persistent"'));
 await assert.rejects(inspectNativeReferenceClosure({output:outputDir,inputRoot,inventorySha256:pin}),/REFERENCE_NATIVE_INTEGRITY/);
 await writeFile(join(outputDir,'studio.html'),studio);
 await writeFile(join(outputDir,'_headers'),'foreign headers');await assert.rejects(inspectNativeReferenceClosure({output:outputDir,inputRoot,inventorySha256:pin}),/REFERENCE_NATIVE_INTEGRITY/);
});


test('rejects mixing a qualified content publication with another qualified web tuple',{skip:!actual||!pin},async t=>{
 const inputRoot=await realpath(resolve(actual)),parent=await realpath(await mkdtemp(join(dirname(inputRoot),'.reference-native-mix-')));t.after(()=>rm(parent,{recursive:true,force:true}));
 const root=join(parent,'bundle');await cp(inputRoot,root,{recursive:true});
 const closure=JSON.parse(await readFile(join(root,'closure.json'),'utf8'));
 const {R97_REFERENCE,R97_MOBILE_REFERENCE}=await import('./qualified-wheat-reference.mjs');
 const other=closure.viewer.buildId===R97_REFERENCE.viewerBuildId?R97_MOBILE_REFERENCE:R97_REFERENCE;
 closure.viewer={sourceCommit:other.viewerSourceCommit,sourceTree:other.viewerSourceTree,lockSha256:other.viewerLockSha256,buildId:other.viewerBuildId,inventorySha256:other.viewerInventorySha256};
 const bytes=Buffer.from(JSON.stringify(closure));await writeFile(join(root,'closure.json'),bytes);
 const inventory=JSON.parse(await readFile(join(root,'integrity.json'),'utf8')),row=inventory.files.find(item=>item.path==='closure.json');row.bytes=bytes.length;row.sha256=hash(bytes);
 const integrity=Buffer.from(JSON.stringify(inventory));await writeFile(join(root,'integrity.json'),integrity);
 await assert.rejects(readNativeReferenceClosure({inputRoot:root,inventorySha256:hash(integrity)}),/REFERENCE_NATIVE_CLOSURE/);
});
