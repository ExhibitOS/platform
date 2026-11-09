// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {staticCacheHeaders} from './static-cache-policy.mjs';

import {inspectCopyBases,readApprovedCopyBases} from './reference-demo-copy-bases.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const exec=promisify(execFile);

// Closed inventory for the qualified reference demo. Hosting-control files and
// arbitrary HTML are not emitted by its exporter and must never be deployed.
const qualifiedPath=p=>['index.html','studio.html','static-publication-index.json','THIRD_PARTY_NOTICES.txt','viewer-favicon.svg','voice-pcm-worklet.js','floor-texture-notices.txt'].includes(p)||
 /^(?:assets|basis)\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|wasm)$/.test(p)||
 /^data\/[a-f0-9]{64}\.(?:json|bin)$/.test(p)||
 /^private-copy-bases\/[a-f0-9]{64}\/(?:static-publication-index\.json|data\/[a-f0-9]{64}\.json)$/.test(p)||
 /^(?:floor-textures|surface-material-textures|material-catalogue-thumbnails)\/[A-Za-z0-9_-]+\/[0-9]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png$/.test(p)||
 /^surface-material-notices\/[A-Za-z0-9_-]+\.txt$/.test(p)||
 /^furnish-catalog\/backless-oak-bench\/1\/(?:model\.glb|LICENSE-NOTICE\.txt)$/.test(p);

// The pin comes from deployment configuration, independently of repository content.
export async function inspectDemo({output, pin, commit, approvedBases, runtimeRoot=join(root,'apps/web/dist-reference-demo-static')}){
 if(!/^[a-f0-9]{64}$/.test(pin??''))throw Error('DEMO_APPROVED_INDEX_REQUIRED');
 const indexBytes=await readFile(join(output,'static-publication-index.json'));
 if(sha256(indexBytes)!==pin)throw Error('DEMO_CONTENT_INDEX');
 const index=JSON.parse(indexBytes);
 let qualified;
 if(index.version===4){const {verifiedQualifiedWheat}=await import('./qualified-wheat-reference.mjs');qualified=await verifiedQualifiedWheat({root:output});}
 else if(index.detailAssets!==undefined)throw Error('DEMO_CONTENT_INDEX_FORMAT');
 if(![1,2,3,4].includes(index.version)||!index.publication||!Array.isArray(index.assets)||(index.resources!==undefined&&!Array.isArray(index.resources))||(index.furnishingNotices!==undefined&&!Array.isArray(index.furnishingNotices)))throw Error('DEMO_CONTENT_INDEX_FORMAT');
 const entries=[index.publication,...index.assets,...(index.resources??[]),...(index.furnishingNotices??[]),...(index.detailAssets??[])];
 const names=entries.map(entry=>{
  if(!/^data\/[a-f0-9]{64}\.(?:json|bin)$/.test(entry.path??'')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!(/^[a-f0-9]{64}$/.test(entry.sha256??'')))throw Error('DEMO_CONTENT_ENTRY');
  return entry.path.slice(5);
 });
 const uniqueNames=[...new Set(names)];
 const dir=join(output,'data');
 if(!(await lstat(dir)).isDirectory())throw Error('DEMO_CONTENT_DIRECTORY');
 const actual=(await readdir(dir)).sort();
 let publication;
 for(const entry of entries){
  const path=join(output,entry.path);
  if(!(await lstat(path)).isFile())throw Error('DEMO_CONTENT_FILE');
  const bytes=await readFile(path);
  if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw Error('DEMO_CONTENT_BYTES');
  if(entry===index.publication)publication=JSON.parse(bytes).publication;
 }
 if(!publication?.id||!publication.revisionSha256||publication.status!=='published')throw Error('DEMO_CONTENT_IDENTITY');
 if(qualified){
  const {expectedWheatHtml}=await import('./qualified-wheat-reference.mjs');
  let hasStudio=true;try{await lstat(join(output,'studio.html'));}catch(e){if(e.code!=='ENOENT')throw e;hasStudio=false;}
  const expectedHtml=await expectedWheatHtml({runtimeRoot,exhibition:qualified.publication.exhibition,privateEditor:hasStudio,indexSha256:qualified.reference.indexSha256});
  if(!(await readFile(join(output,'index.html'))).equals(expectedHtml.index))throw Error('DEMO_CONTENT_HTML');
  if(hasStudio&&!(await readFile(join(output,'studio.html'))).equals(expectedHtml.studio))throw Error('DEMO_CONTENT_HTML');
 }

 const manifest=await readFile(join(output,'static-export-manifest.json'));
 const description=JSON.parse(manifest);
 if(description.format!=='exhibitos-static-publication-v1'||description.publicationId!==publication.id||description.revisionSha256!==publication.revisionSha256||description.indexSha256!==pin||!Array.isArray(description.files))throw Error('DEMO_MANIFEST');
 const expected=new Map();
 for(const entry of description.files){
  if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||entry.path.includes('\\')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!(/^[a-f0-9]{64}$/.test(entry.sha256??''))||expected.has(entry.path))throw Error('DEMO_MANIFEST_ENTRY');
  if(qualified&&!qualifiedPath(entry.path))throw Error('DEMO_OUTPUT_PATH');
  expected.set(entry.path,entry);
 }
 if(!expected.has('static-publication-index.json')||expected.has('static-export-manifest.json')||expected.has('_headers'))throw Error('DEMO_MANIFEST_ENTRY');
 if(qualified){
  // The manifest cannot authenticate itself. Bind every emitted runtime chunk
  // to the independently built trusted runtime tree, including its inventory.
  const runtimeFiles=[];
  async function collectRuntime(path,prefix){
   const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink())throw Error('DEMO_RUNTIME');
   for(const item of await readdir(path,{withFileTypes:true})){
    const rel=prefix+item.name,full=join(path,item.name);
    if(item.isDirectory())await collectRuntime(full,rel+'/');
    else if(item.isFile()&&/^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(rel))runtimeFiles.push(rel);
    else throw Error('DEMO_RUNTIME');
   }
  }
  for(const folder of ['assets','basis'])await collectRuntime(join(runtimeRoot,folder),folder+'/');
  for(const name of ['THIRD_PARTY_NOTICES.txt','voice-pcm-worklet.js','viewer-favicon.svg'])runtimeFiles.push(name);
  const expectedRuntime=[...expected.keys()].filter(p=>/^(assets|basis)\//.test(p)||['THIRD_PARTY_NOTICES.txt','voice-pcm-worklet.js','viewer-favicon.svg'].includes(p));
  if(JSON.stringify(runtimeFiles.sort())!==JSON.stringify(expectedRuntime.sort()))throw Error('DEMO_RUNTIME_INVENTORY');
  for(const path of runtimeFiles){const source=await readFile(join(runtimeRoot,path)),row=expected.get(path);if(!row||row.bytes!==source.length||row.sha256!==sha256(source))throw Error('DEMO_RUNTIME_BYTES');}
 }
 const bases=qualified?[]:approvedBases??await readApprovedCopyBases(join(root,'demos/reference-exhibition/previous-copy-bases.json'));
 const retained=await inspectCopyBases(output,bases,expected);
 if(JSON.stringify(actual)!==JSON.stringify([...new Set([...uniqueNames,...retained])].sort()))throw Error('DEMO_CONTENT_INVENTORY');
 const headers=staticCacheHeaders(index,description.files);
 const allowed=new Set([...expected.keys(),'static-export-manifest.json',...(headers?['_headers']:[])]);
 async function walk(dir,prefix=''){
  for(const item of await readdir(dir,{withFileTypes:true})){
   const relative=prefix+item.name,path=join(dir,item.name);
   if(item.isDirectory())await walk(path,relative+'/');
   else if(!item.isFile()||!allowed.delete(relative))throw Error('DEMO_OUTPUT_INVENTORY');
   else if(relative==='_headers'&&!((await readFile(path)).equals(Buffer.from(headers))))throw Error('DEMO_HEADERS');
   else if(expected.has(relative)){
    const bytes=await readFile(path),entry=expected.get(relative);
    if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw Error('DEMO_OUTPUT_BYTES');
   }
  }
 }
 await walk(output);
 if(allowed.size)throw Error('DEMO_OUTPUT_INVENTORY');
 return {sourceCommit:commit,publicationId:publication.id,revisionSha256:publication.revisionSha256,indexSha256:pin,manifestSha256:sha256(manifest)};
}

export async function deployReferenceDemo({env=process.env,output=join(root,'dist-demo'),remoteHead,checkoutHead,deploy,approvedBases,log=console.log}={}){
 const commit=env.WORKERS_CI_COMMIT_SHA;
 if(env.WORKERS_CI_BRANCH!=='main')throw Error('DEMO_BRANCH');
 if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('DEMO_COMMIT');
 const checkout=await checkoutHead();
 if(checkout!==commit)throw Error('DEMO_CHECKOUT_HEAD');
 const remote=await remoteHead();
 if(!/^[a-f0-9]{40}$/.test(remote??''))throw Error('DEMO_REMOTE_HEAD');
 if(commit!==remote){log(`Skipping superseded demo build ${commit} (main is ${remote})`);return 'skipped';}
 const proof=await inspectDemo({output,pin:env.EXHIBITOS_APPROVED_DEMO_INDEX_SHA256,commit,approvedBases});
 const finalHead=await remoteHead();
 if(!/^[a-f0-9]{40}$/.test(finalHead??''))throw Error('DEMO_REMOTE_HEAD');
 if(finalHead!==commit){log(`Skipping superseded demo build ${commit} (main is ${finalHead})`);return 'skipped';}
 log(JSON.stringify(proof));
 await deploy();
 return 'deployed';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 await deployReferenceDemo({
  checkoutHead:async()=>{const {stdout}=await exec('git',['rev-parse','HEAD'],{cwd:root});return stdout.trim();},
  remoteHead:async()=>{
   const {stdout}=await exec('git',['ls-remote','https://github.com/ExhibitOS/platform.git','refs/heads/main'],{cwd:root});
   const match=stdout.match(/^([a-f0-9]{40})\s+refs\/heads\/main\s*$/);
   return match?.[1];
  },
  deploy:()=>new Promise((ok,reject)=>{
   const child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config','wrangler.demo.jsonc'],{cwd:root,stdio:'inherit'});
   child.once('error',reject);
   child.once('exit',(code,signal)=>code===0?ok():reject(Error(`DEMO_DEPLOY_FAILED ${code??signal}`)));
  })
 });
}
