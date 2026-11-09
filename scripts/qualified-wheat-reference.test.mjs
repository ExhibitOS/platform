// SPDX-License-Identifier: AGPL-3.0-or-later
// Explicit integration test against the independently built, pinned artifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readdir,readFile,link,unlink,writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {inspectDemo} from './deploy-reference-demo.mjs';
import {verifiedQualifiedWheat} from './qualified-wheat-reference.mjs';
const input=process.env.EXHIBITOS_QUALIFIED_WHEAT_OUTPUT;
const hash=b=>createHash('sha256').update(b).digest('hex');
async function copyLinks(from,to){await mkdir(to,{recursive:true});for(const item of await readdir(from,{withFileTypes:true})){const a=join(from,item.name),b=join(to,item.name);if(item.isDirectory())await copyLinks(a,b);else if(item.isFile())await link(a,b);else throw Error('unexpected fixture type');}}
async function replace(path,bytes){await unlink(path);await writeFile(path,bytes,{flag:'wx'});}
async function rehashManifest(root,path){const name=join(root,'static-export-manifest.json'),m=JSON.parse(await readFile(name)),data=await readFile(join(root,path)),e=m.files.find(x=>x.path===path);e.bytes=data.length;e.sha256=hash(data);await replace(name,Buffer.from(JSON.stringify(m)));}
test('exact built v4 session decoration and tampered outputs', {skip:!input},async t=>{
 const source=resolve(input),base=await mkdtemp(join(dirname(source),'.wheat-reference-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const qualified=await verifiedQualifiedWheat({root:source}),reference=qualified.reference;
 const inspect=output=>inspectDemo({output,pin:reference.indexSha256,commit:'test',runtimeRoot:process.env.EXHIBITOS_QUALIFIED_WHEAT_RUNTIME});
 await inspect(source);
 for(const name of ['index.html','studio.html']){
  const html=await readFile(join(source,name),'utf8');
  assert.equal(html.split('<meta name="exhibitos-demo-decoration" content="session-v1">').length,2);
  assert.equal(html.includes('exhibitos-private-copy-bases'),false);
 }
 assert.equal((await readdir(source)).includes('private-copy-bases'),false);
 const {renderEntranceShell}=await import('../apps/web/dist-reference-demo-cover/entrance-shell.js');const shell=renderEntranceShell(qualified.publication.exhibition);
 for(const scenario of ['index','original','extra-data','html-pin','duplicate-meta','cover-shell','studio-mode','runtime-manifest','hosting-control','assets-ignore','foreign-html'])await t.test(scenario,async()=>{
  const root=join(base,scenario);await copyLinks(source,root);
  if(scenario==='index')await replace(join(root,'static-publication-index.json'),Buffer.from('{}'));
  if(scenario==='original')await replace(join(root,`data/${reference.assetSha256}.bin`),Buffer.from('tampered'));
  if(['hosting-control','assets-ignore','foreign-html'].includes(scenario)){const path=scenario==='hosting-control'?'_redirects':scenario==='assets-ignore'?'.assetsignore':'other.html',bytes=Buffer.from(scenario==='hosting-control'?'/ https://example.com/ 302\n':'unapproved');await writeFile(join(root,path),bytes);const name=join(root,'static-export-manifest.json'),m=JSON.parse(await readFile(name));m.files.push({path,bytes:bytes.length,sha256:hash(bytes)});await replace(name,Buffer.from(JSON.stringify(m)));}
  if(scenario==='runtime-manifest'){const manifest=JSON.parse(await readFile(join(root,'static-export-manifest.json')));const entry=manifest.files.find(x=>/^assets\/static-.*\.js$/.test(x.path));assert.ok(entry);await replace(join(root,entry.path),Buffer.from('/* replaced entrypoint */'));await rehashManifest(root,entry.path);}
  if(scenario==='extra-data')await writeFile(join(root,`data/${'a'.repeat(64)}.bin`),'extra');
  if(scenario==='html-pin'||scenario==='duplicate-meta'||scenario==='cover-shell'){
   const path=join(root,'index.html');let html=await readFile(path,'utf8');
   html=scenario==='html-pin'?html.replace(reference.indexSha256,'0'.repeat(64)):scenario==='duplicate-meta'?html.replace('<head>',"<head><meta content='"+'0'.repeat(64)+"' name='exhibitos-static-index'>"):html.replace(shell,shell.slice(0,10)+'X'+shell.slice(11));
   await replace(path,Buffer.from(html));await rehashManifest(root,'index.html');
  }
  if(scenario==='studio-mode'){
   const path=join(root,'studio.html');
   const html=await readFile(path,'utf8');
   await replace(path,Buffer.from(html.replace('content="session-v1"','content="persistent"')));
   await rehashManifest(root,'studio.html');
  }
  await assert.rejects(inspect(root));
 });
});
