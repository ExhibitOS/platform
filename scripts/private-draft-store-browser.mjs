// SPDX-License-Identifier: AGPL-3.0-or-later
// Focused real IndexedDB proof; temporary bundle and browser profile are isolated.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {build} from 'vite';
import {chromium} from '@playwright/test';
import {fixtureURL} from '@exhibitos/spec';

const output=await mkdtemp(`${tmpdir()}/exhibitos-private-drafts-proof-`);
await build({configFile:false,logLevel:'error',root:new URL('../apps/web/',import.meta.url).pathname,build:{outDir:output,emptyOutDir:false,copyPublicDir:false,minify:false,lib:{entry:new URL('../apps/web/src/drafts/store.ts',import.meta.url).pathname,name:'DraftStoreProof',formats:['iife'],fileName:()=> 'store.js'}}});
const script=await readFile(`${output}/store.js`),server=createServer((req,res)=>{res.setHeader('cache-control','no-store');if(req.url==='/store.js'){res.setHeader('content-type','application/javascript');res.end(script);}else res.end('<!doctype html><title>Private draft proof</title><script src="/store.js"></script>');});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')),time=new Date().toISOString();
 const draft={schemaVersion:'1.0.0-draft.1',kind:'exhibition-draft',id:randomUUID(),exhibitionId:candidate.id,editVersion:1,createdAt:time,updatedAt:time,candidate};
 const result=await page.evaluate(async input=>{
  const {DraftStore}=globalThis.DraftStoreProof,name='exhibitos-private-editor-v1-'+crypto.randomUUID();
  const legacy=new DraftStore(name);let current=await legacy.save(input);const original=current;
  const old=structuredClone(current.draft);old.candidate.title='Legacy two';current=await legacy.save(old,current.version);await legacy.close();
  const store=new DraftStore(name,{privateHistory:true}),other=new DraftStore(name,{privateHistory:true});
  for(let n=0;n<4;n++){const d=structuredClone(current.draft);d.candidate.title=`Private ${n}`;current=await store.save(d,current.version);}
  const versions=(await store.history(current.id)).map(r=>r.version);
  const previous=await store.privatePrevious(current.id);
  const unsaved=structuredClone(current.draft);unsaved.candidate.title='Unsaved before reset';
  const reset=structuredClone(current.draft);reset.candidate.title='Reset source';
  const resetResult=await store.resetPrivate(unsaved,reset,current.version),resetPrevious=await store.privatePrevious(current.id);
  let conflict;try{await other.save(unsaved,current.version);}catch(e){conflict=e.code;}
  const recovered=await store.recoverPrivate(resetResult.draft,resetResult.version),recoveryPrevious=await store.privatePrevious(current.id);
  const archived=(await store.history(current.id)).map(r=>r.version);
  let blocked;try{new DraftStore('exhibitos-studio',{privateHistory:true});}catch(e){blocked=e.code;}
  await store.close();await other.close();
  return {versions,previous:previous?.draft.candidate.title,reset:resetResult.draft.candidate.title,resetPrevious:resetPrevious?.draft.candidate.title,conflict,recovered:recovered.draft.candidate.title,recoveryPrevious:recoveryPrevious?.draft.candidate.title,archived,legacyVersion:original.version,blocked};
 },draft);
 assert.deepEqual(result.versions,[6,5,2,1]);assert.equal(result.previous,'Private 2');assert.equal(result.reset,'Reset source');assert.equal(result.resetPrevious,'Unsaved before reset');assert.equal(result.conflict,'LOCAL_CONFLICT');assert.equal(result.recovered,'Unsaved before reset');assert.equal(result.recoveryPrevious,'Reset source');assert.deepEqual(result.archived,[10,9,2,1]);assert.equal(result.blocked,'UNAVAILABLE');
 process.stdout.write(JSON.stringify({status:'PASS',browser:'Chromium',scope:'private IndexedDB opt-in, previous, reset, recovery, stale writer and legacy archive',...result})+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
