// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localStaticPublicationSource,assertSamePublicationContent,retainedPrivateEditor,EDITOR_CATALOGUE_PATHS} from './local-static-publication-source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){const root=await mkdtemp(join(tmpdir(),'exhibitos-refresh-test-')),index=Buffer.from('{"version":1}'),asset=Buffer.from('fixture');await mkdir(join(root,'data'));const p=`data/${hash(asset)}.bin`;await writeFile(join(root,'static-publication-index.json'),index);await writeFile(join(root,p),asset);const publicationId='625618bf-8b63-448c-abd6-08f1bb7dd68e',revisionSha256='a'.repeat(64),indexSha256=hash(index);const manifest=Buffer.from(JSON.stringify({format:'exhibitos-static-publication-v1',publicationId,revisionSha256,indexSha256,files:[{path:'static-publication-index.json',bytes:index.length,sha256:indexSha256},{path:p,bytes:asset.length,sha256:hash(asset)}]}));await writeFile(join(root,'static-export-manifest.json'),manifest);return {root,p,asset,request:{sourceDir:root,sourceManifestSha256:hash(manifest),indexSha256,publicationId,revisionSha256}};}
test('accepts only exact verified source paths and detects subsequent changes',async()=>{const f=await fixture();try{const source=await localStaticPublicationSource(f.request);assert.deepEqual(Buffer.from(await (await source.fetch(source.origin+'/'+f.p)).arrayBuffer()),f.asset);await assert.rejects(source.fetch('https://elsewhere.invalid/'+f.p));await writeFile(join(f.root,f.p),'changed');await assert.rejects(source.fetch(source.origin+'/'+f.p));await assert.rejects(localStaticPublicationSource(f.request));}finally{await rm(f.root,{recursive:true,force:true});}});
test('rejects unexpected files, missing files and symbolic links',async()=>{const f=await fixture();try{await writeFile(join(f.root,'extra'),'x');await assert.rejects(localStaticPublicationSource(f.request));await rm(join(f.root,'extra'));await mkdir(join(f.root,'unexpected-empty'));await assert.rejects(localStaticPublicationSource(f.request));await rm(join(f.root,'unexpected-empty'),{recursive:true});await rm(join(f.root,f.p));await assert.rejects(localStaticPublicationSource(f.request));await symlink(join(f.root,'static-publication-index.json'),join(f.root,f.p));await assert.rejects(localStaticPublicationSource(f.request));}finally{await rm(f.root,{recursive:true,force:true});}});
test('cancellation stops source admission',async()=>{const f=await fixture();try{await assert.rejects(localStaticPublicationSource(f.request,{cancelled:()=>true}),/REFRESH_CANCELLED/);}finally{await rm(f.root,{recursive:true,force:true});}});

test('content equality rejects changed and unclassified paths while allowing shell changes',()=>{const entries=new Map([['static-publication-index.json',{bytes:1,sha256:'a'}],['data/x.bin',{bytes:2,sha256:'b'}],['index.html',{bytes:1,sha256:'old'}]]);const generated=[{path:'static-publication-index.json',bytes:1,sha256:'a'},{path:'data/x.bin',bytes:2,sha256:'b'},{path:'index.html',bytes:10,sha256:'new'}];assert.doesNotThrow(()=>assertSamePublicationContent(entries,generated));assert.throws(()=>assertSamePublicationContent(entries,generated.map(x=>x.path==='data/x.bin'?{...x,sha256:'c'}:x)),/REFRESH_CONTENT_CHANGED/);assert.throws(()=>assertSamePublicationContent(entries,[...generated,{path:'unknown/artwork.bin',bytes:1,sha256:'x'}]),/REFRESH_CONTENT_UNCLASSIFIED/);});

test('retained editor catalogue is complete, immutable content rather than shell',()=>{
 const entry={bytes:1,sha256:'a'},catalog=new Map(EDITOR_CATALOGUE_PATHS.map(path=>[path,entry]));
 assert.equal(retainedPrivateEditor(new Map()),false);
 assert.throws(()=>retainedPrivateEditor(new Map([[EDITOR_CATALOGUE_PATHS[0],entry]])),/REFRESH_CONTENT_UNCLASSIFIED/);
 assert.throws(()=>retainedPrivateEditor(catalog),/REFRESH_CONTENT_UNCLASSIFIED/);
 catalog.set('studio.html',entry);assert.equal(retainedPrivateEditor(catalog),true);
 const generated=[...catalog].map(([path,value])=>({path,...value}));
 assert.doesNotThrow(()=>assertSamePublicationContent(catalog,generated));
 assert.throws(()=>assertSamePublicationContent(catalog,generated.filter(x=>x.path!==EDITOR_CATALOGUE_PATHS[0])),/REFRESH_CONTENT_CHANGED/);
 assert.throws(()=>assertSamePublicationContent(catalog,generated.map(x=>x.path===EDITOR_CATALOGUE_PATHS[0]?{...x,sha256:'b'}:x)),/REFRESH_CONTENT_CHANGED/);
 assert.throws(()=>assertSamePublicationContent(catalog,[...generated,{path:'furnish-catalog/other/1/model.glb',...entry}]),/REFRESH_CONTENT_UNCLASSIFIED/);
});
