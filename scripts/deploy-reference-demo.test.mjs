// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deployReferenceDemo} from './deploy-reference-demo.mjs';
import {staticCacheHeaders} from './static-cache-policy.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const commit='a'.repeat(40);
async function fixture(){
 const output=await mkdtemp(join(tmpdir(),'demo-guard-'));
 await mkdir(join(output,'data'));
 const pub=Buffer.from(JSON.stringify({publication:{id:'synthetic',revisionSha256:'b'.repeat(64),status:'published'}}));
 const asset=Buffer.from('synthetic asset');
 const entry=(bytes,ext)=>({path:`data/${hash(bytes)}.${ext}`,bytes:bytes.length,sha256:hash(bytes)});
 const publication=entry(pub,'json'),item=entry(asset,'bin');
 await writeFile(join(output,publication.path),pub);await writeFile(join(output,item.path),asset);
 const indexObject={version:2,publication,assets:[item],resources:[]};
 const index=Buffer.from(JSON.stringify(indexObject));
 await writeFile(join(output,'static-publication-index.json'),index);
 const runtime=Buffer.from('runtime');await writeFile(join(output,'index.html'),runtime);
 const files=[publication,item,{path:'static-publication-index.json',bytes:index.length,sha256:hash(index)},{path:'index.html',bytes:runtime.length,sha256:hash(runtime)}];
 const manifest={format:'exhibitos-static-publication-v1',publicationId:'synthetic',revisionSha256:'b'.repeat(64),indexSha256:hash(index),files};
 await writeFile(join(output,'static-export-manifest.json'),JSON.stringify(manifest));
 const headers=staticCacheHeaders(indexObject,files);if(headers)await writeFile(join(output,'_headers'),headers);
 return {output,pin:hash(index),publication,item};
}

test('deployment guard admits only current main and authenticated, complete data',async t=>{
 for(const name of ['approved','stale','newer during validation','git failure','missing remote','wrong branch','missing commit','short commit','wrong checkout','missing pin','changed index','corrupt data','extra data','missing data','missing manifest','runtime manifest changed','extra runtime','corrupt runtime','altered headers'])await t.test(name,async()=>{
  const f=await fixture();t.after(()=>rm(f.output,{recursive:true,force:true}));
  const env={WORKERS_CI_BRANCH:'main',WORKERS_CI_COMMIT_SHA:commit,EXHIBITOS_APPROVED_DEMO_INDEX_SHA256:f.pin};
  let remote=commit,calls=0,reads=0;const log=[];
  if(name==='stale')remote='c'.repeat(40);
  if(name==='missing remote')remote='';
  if(name==='wrong branch')env.WORKERS_CI_BRANCH='other';
  if(name==='missing commit')delete env.WORKERS_CI_COMMIT_SHA;
  if(name==='short commit')env.WORKERS_CI_COMMIT_SHA='abc';
  if(name==='missing pin')delete env.EXHIBITOS_APPROVED_DEMO_INDEX_SHA256;
  if(name==='changed index')await writeFile(join(f.output,'static-publication-index.json'),'{}');
  if(name==='corrupt data')await writeFile(join(f.output,f.item.path),'wrong');
  if(name==='extra data')await writeFile(join(f.output,'data','extra'),'extra');
  if(name==='missing data')await rm(join(f.output,f.item.path));
  if(name==='missing manifest')await rm(join(f.output,'static-export-manifest.json'));
  if(name==='extra runtime')await writeFile(join(f.output,'extra.txt'),'unexpected');
  if(name==='corrupt runtime')await writeFile(join(f.output,'index.html'),'corrupt');
  if(name==='altered headers')await writeFile(join(f.output,'_headers'),'bad');
  if(name==='runtime manifest changed'){const p=join(f.output,'static-export-manifest.json');const m=JSON.parse(await readFile(p));m.extra='valid runtime metadata';await writeFile(p,JSON.stringify(m));}
  const run=()=>deployReferenceDemo({env,output:f.output,approvedBases:[],remoteHead:async()=>{if(name==='git failure')throw Error('git failed');return name==='newer during validation'&&++reads===2?'c'.repeat(40):remote;},checkoutHead:async()=>name==='wrong checkout'?'d'.repeat(40):commit,deploy:async()=>{calls++;},log:s=>log.push(s)});
  if(name==='approved'||name==='runtime manifest changed'){
   assert.equal(await run(),'deployed');assert.equal(calls,1);
   const proof=JSON.parse(log[0]);assert.equal(proof.indexSha256,f.pin);assert.equal(proof.publicationId,'synthetic');assert.equal(proof.sourceCommit,commit);assert.match(proof.manifestSha256,/^[a-f0-9]{64}$/);
  }else if(name==='stale'||name==='newer during validation'){assert.equal(await run(),'skipped');assert.equal(calls,0);}
  else{await assert.rejects(run);assert.equal(calls,0);}
 });
});
