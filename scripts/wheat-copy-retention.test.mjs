// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {revisionHash} from '@exhibitos/spec';
import {verifiedCopyBases,writeCopyBases,inspectCopyBases} from './reference-demo-copy-bases.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const oldFull='2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f',oldLow='e246eae77c461d0c3aed5949fe24ff1805f175e44aacf1752f2143cd2b9fbc0b',full='cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',low='0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304';
test('packages only exact historical Wheat bytes without altering the active index',async t=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-wheat-copies-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const demo='demos/reference-exhibition',source=join(demo,'source'),output=join(root,'output'),archive=join(root,'archive');await mkdir(output);await mkdir(join(archive,'source/data'),{recursive:true});
 const bases=JSON.parse(await readFile(join(demo,'previous-copy-bases.json'))),base=bases[0],prefix=`private-copy-bases/${base.indexSha256}`;
 const oldIndex=JSON.parse(await readFile(join(demo,prefix,'static-publication-index.json')));await mkdir(join(archive,prefix,'data'),{recursive:true});
 for(const path of ['static-publication-index.json',oldIndex.publication.path])await writeFile(join(archive,prefix,path),await readFile(join(demo,prefix,path)));
 for(const sha of [oldFull,oldLow])await writeFile(join(archive,'source/data',sha+'.bin'),await readFile(join(source,'data',sha+'.bin')));
 // Build the prior revision from its pinned retained base. The active source
 // legitimately changes to the new Wheat preparation after integration.
 const index=structuredClone(oldIndex),value=JSON.parse(await readFile(join(demo,prefix,oldIndex.publication.path)));
 const work=value.exhibition.artworks.find(a=>a.assets.some(a=>a.sha256===oldFull)),primary=work.assets.find(a=>a.sha256===oldFull),coarse=work.assets.find(a=>a.sha256===oldLow);
 primary.sha256=full;primary.bytes=8103573;coarse.sha256=low;coarse.bytes=509458;
 const lod=work.extensions['org.exhibitos.viewer/lod'].variants;lod.find(x=>x.detail==='full').textureSize=2048;
 Object.assign(work.extensions['org.exhibitos.viewer/display-policy'],{approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',sourceAssetSha256:full});
 work.provenance.events[0].description=work.provenance.events[0].description.replace(oldFull,full).replace('fe002ad256885d6c1899025aa2a07910faaf6eca9055bd87880a2b3b43a8ef24','5206824d01e36782dbdd9dc9d0872f64c5e17990000495e511bc80d11bb979fd');
 value.publication.revisionSha256=revisionHash(value.exhibition);const pub=Buffer.from(JSON.stringify(value)),pubHash=hash(pub);index.publication={path:`data/${pubHash}.json`,bytes:pub.length,sha256:pubHash,mime:'application/json'};
 for(const entry of index.assets){if(entry.sha256===oldFull)Object.assign(entry,{sha256:full,bytes:8103573,path:`data/${full}.bin`});if(entry.sha256===oldLow)Object.assign(entry,{sha256:low,bytes:509458,path:`data/${low}.bin`});}
 const indexBytes=Buffer.from(JSON.stringify(index));await mkdir(join(output,'data'));await writeFile(join(output,'data',pubHash+'.json'),pub);await writeFile(join(output,'static-publication-index.json'),indexBytes);
 const studio=Buffer.from('<html><head></head></html>');await writeFile(join(output,'studio.html'),studio);await writeFile(join(output,'static-export-manifest.json'),JSON.stringify({files:[{path:'studio.html',bytes:studio.length,sha256:hash(studio)}]}));
 const files=await verifiedCopyBases({output,archiveRoot:archive,bases:[base]});assert.equal(files.length,4);assert.deepEqual(files.filter(([p])=>p.startsWith('data/')).map(([p])=>p).sort(),[`data/${oldFull}.bin`,`data/${oldLow}.bin`].sort());
 await writeCopyBases(output,archive,[base]);assert.deepEqual(await readFile(join(output,'static-publication-index.json')),indexBytes);
 const manifest=JSON.parse(await readFile(join(output,'static-export-manifest.json'))),expected=new Map(manifest.files.map(f=>[f.path,f]));await inspectCopyBases(output,[base],expected);
 await writeFile(join(output,'data',oldFull+'.bin'),Buffer.alloc(7503560));await assert.rejects(verifiedCopyBases({output,archiveRoot:output,bases:[base]}),/DEMO_COPY_BASE/);
});
