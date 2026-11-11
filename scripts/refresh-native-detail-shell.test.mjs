// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,writeFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {revisionHash} from '@exhibitos/spec';
import {ARTWORK_DETAIL_QUALITY_NAMESPACE,freezeCanonical} from '@exhibitos/studio-contract';
import {refreshNativeDetailShell} from './refresh-native-detail-shell.mjs';
import {localStaticPublicationSource,EDITOR_CATALOGUE_PATHS} from './local-static-publication-source.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'detail-shell-refresh-'))),source=join(root,'source'),web=join(root,'web');await mkdir(source);await mkdir(web);
 const publicationId=id(99),original=Buffer.from('retained public original'),originalHash=hash(original),assetId=id(1),buildId='e'.repeat(64);
 const featureReport={version:1,inspector:'synthetic-only',assetSha256:originalHash,assetBytes:original.length,media:{kind:'image',codec:'jpeg',width:1,height:1,bitDepth:8,channels:3,frameCount:1,interlaced:false,orientation:1,colourProfile:'none'},cost:{model:'synthetic-only',residentBytes:4,peakAdditionalBytes:8}};
 const relation={version:1,candidates:[{candidateId:id(2),assetId,tier:'acquired-original',sha256:originalHash,bytes:original.length,mime:'image/jpeg',sourceBindingSha256:'b'.repeat(64),featureReportSha256:hash(freezeCanonical(featureReport)),featureReport}]};
 const exhibition={title:'Retained title',artworks:[{artworkType:'image',extensions:{[ARTWORK_DETAIL_QUALITY_NAMESPACE]:relation}}]},revisionSha256=revisionHash(exhibition);
 const raw={publication:{id:publicationId,revisionSha256,publishedAt:'2026-11-11T00:00:00Z',status:'published'},exhibition,assets:[],detailAssets:[{assetId,url:`/api/v1/publications/${publicationId}/detail-assets/${assetId}`,mime:'image/jpeg'}]};
 const publication=Buffer.from(JSON.stringify(raw)),publicationPath=`data/${hash(publication)}.json`,detailPath=`data/${originalHash}.bin`;
 const index=Buffer.from(JSON.stringify({version:4,publication:{path:publicationPath,bytes:publication.length,sha256:hash(publication),mime:'application/json'},assets:[],detailAssets:[{assetId,path:detailPath,bytes:original.length,sha256:originalHash,mime:'image/jpeg'}]}));
 const contents=new Map([['static-publication-index.json',index],[publicationPath,publication],[detailPath,original],['index.html',Buffer.from('<!doctype html><html><head><title>Retained title</title><meta name="exhibitos-private-editor" content="enabled"></head><body><div id="root"><section data-cover-bootstrap>Retained cover</section></div></body></html>')],['studio.html',Buffer.from('old editor')],['assets/old.js',Buffer.from('old shell')],['floor-textures/synthetic/1/colour.png',Buffer.from('retained floor')],...EDITOR_CATALOGUE_PATHS.map(path=>[path,Buffer.from('retained catalogue '+path)])]);
 const write=async(base,path,bytes)=>{await mkdir(join(base,...path.split('/').slice(0,-1)),{recursive:true});await writeFile(join(base,path),bytes);};
 for(const [path,bytes]of contents)await write(source,path,bytes);
 const sourceManifest=Buffer.from(JSON.stringify({format:'exhibitos-static-publication-v1',publicationId,revisionSha256,indexSha256:hash(index),files:[...contents].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))}));await write(source,'static-export-manifest.json',sourceManifest);
 const html=(studio=false)=>Buffer.from(`<!doctype html><html><head><meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"><meta name="exhibitos-viewer-build-id" content="${buildId}"><title>New default title</title><script type="module" src="/assets/new.js"></script></head><body><div id="root">${studio?'':'<!--STATIC_COVER_SHELL-->'}</div></body></html>`);
 const webFiles=new Map([['static.html',html()],['static-studio.html',html(true)],['assets/new.js',Buffer.from('new qualified shell')],['THIRD_PARTY_NOTICES.txt',Buffer.from('qualified notices')]]);
 for(const [path,bytes]of webFiles)await write(web,path,bytes);
 const inventoryPath=join(root,'web-inventory.json');
 const inventory=Buffer.from(JSON.stringify({format:'exhibitos-static-web-input-v1',buildId,files:[...webFiles].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))}));await writeFile(inventoryPath,inventory);
 return {root,source,web,contents,webFiles,detailPath,index,inventoryPath,request:{sourceDir:source,sourceManifestSha256:hash(sourceManifest),indexSha256:hash(index),publicationId,revisionSha256,webRoot:web,webInventoryPath:inventoryPath,webInventorySha256:hash(inventory),webBuildId:buildId,outputDir:join(root,'successor')}};
}

test('refreshes only v4 web shell and regenerates inventory while all detail/content/editor mappings stay byte-identical',async()=>{
 const f=await fixture();try{
  const result=await refreshNativeDetailShell(f.request);assert.equal(result.stageStatus,'verified');assert.equal(result.indexSha256,f.request.indexSha256);assert.notEqual(result.manifestSha256,f.request.sourceManifestSha256);assert.equal(result.webBuildId,f.request.webBuildId);
  const next=await localStaticPublicationSource({...f.request,sourceDir:result.output,sourceManifestSha256:result.manifestSha256});
  for(const [path,bytes]of f.contents)if(path==='static-publication-index.json'||path.startsWith('data/')||path.startsWith('floor-textures/')||EDITOR_CATALOGUE_PATHS.includes(path))assert.deepEqual(await readFile(join(result.output,path)),bytes);
  assert.equal(next.entries.has('assets/old.js'),false);assert.deepEqual(await readFile(join(result.output,'assets/new.js')),f.webFiles.get('assets/new.js'));
  const html=await readFile(join(result.output,'index.html'),'utf8');assert(html.includes('Retained cover'));assert(html.includes('<title>Retained title</title>'));assert(html.includes(f.request.indexSha256));assert(html.includes(f.request.webBuildId));assert(!html.includes('STATIC_INDEX_SHA256'));assert(html.includes('exhibitos-private-editor'));
  assert.deepEqual(await readFile(join(f.source,'static-publication-index.json')),f.index);assert(!(await readdir(f.root)).some(name=>name.startsWith('.exhibitos-shell-refresh-')));
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('refuses wrong web inventory/build identity, undeclared paths, foreign files and symlinks',async()=>{
 for(const mutation of [async f=>{f.request.webInventorySha256='0'.repeat(64);},async f=>{f.request.webBuildId='a'.repeat(64);},async f=>{await writeFile(join(f.web,'unexpected.txt'),'foreign');},async f=>{await rm(join(f.web,'assets/new.js'));await symlink(join(f.source,f.detailPath),join(f.web,'assets/new.js'));},async f=>{await writeFile(join(f.web,'assets/new.js'),'changed');}]){
  const f=await fixture();try{await mutation(f);await assert.rejects(refreshNativeDetailShell(f.request));assert(!(await readdir(f.root)).includes('successor'));}finally{await rm(f.root,{recursive:true,force:true});}
 }
});

test('refuses overlapping or existing output, changed content and mismatched v4 detail tuples',async()=>{
 for(const mutation of [async f=>{f.request.outputDir=join(f.source,'nested');},async f=>{f.request.outputDir=f.web;},async f=>{await mkdir(f.request.outputDir);},async f=>{await writeFile(join(f.source,f.detailPath),'tampered original');},async f=>{
  // Re-pin a structurally different source inventory to prove detail tuple
  // validation is separate from mere full-inventory integrity.
  const index=JSON.parse(f.index);index.detailAssets[0].assetId=id(55);const bytes=Buffer.from(JSON.stringify(index));await writeFile(join(f.source,'static-publication-index.json'),bytes);f.request.indexSha256=hash(bytes);
  const manifest=JSON.parse(await readFile(join(f.source,'static-export-manifest.json'),'utf8'));manifest.indexSha256=f.request.indexSha256;Object.assign(manifest.files.find(item=>item.path==='static-publication-index.json'),{bytes:bytes.length,sha256:hash(bytes)});const body=Buffer.from(JSON.stringify(manifest));await writeFile(join(f.source,'static-export-manifest.json'),body);f.request.sourceManifestSha256=hash(body);
 }]){
  const f=await fixture();try{await mutation(f);await assert.rejects(refreshNativeDetailShell(f.request));}finally{await rm(f.root,{recursive:true,force:true});}
 }
});

test('revalidates source at commit and removes incomplete successor after cancellation or source tampering',async()=>{
 const f=await fixture();try{let calls=0;await assert.rejects(refreshNativeDetailShell(f.request,{cancelled:()=>++calls>20}),/REFRESH_CANCELLED/);assert(!(await readdir(f.root)).includes('successor'));assert(!(await readdir(f.root)).some(name=>name.startsWith('.exhibitos-shell-refresh-')));}finally{await rm(f.root,{recursive:true,force:true});}
 const changed=await fixture();try{
  let tampered=false;
  await assert.rejects(refreshNativeDetailShell(changed.request,{cancelled:()=>{
   const stage=readdirSync(changed.root).find(name=>name.startsWith('.exhibitos-shell-refresh-'));
   if(!tampered&&stage&&existsSync(join(changed.root,stage,'candidate/static-export-manifest.json'))){writeFileSync(join(changed.source,changed.detailPath),'changed at commit');tampered=true;}
   return false;
  }}));
  assert(tampered);assert(!(await readdir(changed.root)).includes('successor'));assert(!(await readdir(changed.root)).some(name=>name.startsWith('.exhibitos-shell-refresh-')));
 }finally{await rm(changed.root,{recursive:true,force:true});}
});
