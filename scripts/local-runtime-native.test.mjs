// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {assertThumbnailRuntimeConfiguration,localRuntimeNetwork, startLocalRuntime} from './local-runtime.mjs';

test('native services bind loopback on the actual user origin without container mapping', () => {
  assert.deepEqual(localRuntimeNetwork({EXHIBITOS_RUNTIME_MODE:'native'}), {
    mode:'native',port:13200,apiPort:13201,proxyPort:13200,proxyHost:'127.0.0.1'
  });
  assert.deepEqual(localRuntimeNetwork({EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_PORT:'14500',EXHIBITOS_API_PORT:'14501'}), {
    mode:'native',port:14500,apiPort:14501,proxyPort:14500,proxyHost:'127.0.0.1'
  });
  assert.deepEqual(localRuntimeNetwork({}), {
    mode:'container',port:13200,apiPort:3000,proxyPort:8080,proxyHost:'0.0.0.0'
  });
});

test('invalid native ports/mode fail before DB access, migrations or credential setup', async () => {
  for (const fields of [
    {EXHIBITOS_PORT:'13201'}, {EXHIBITOS_API_PORT:'0'}, {EXHIBITOS_API_PORT:'1023'},
    {EXHIBITOS_PORT:'65536'}, {EXHIBITOS_API_PORT:'13201.5'},
    {EXHIBITOS_PORT:' 13200'}, {EXHIBITOS_API_PORT:'013201'},
    {EXHIBITOS_RUNTIME_MODE:'unexpected'}
  ]) {
    const environment = {EXHIBITOS_RUNTIME_MODE:'native',...fields};
    assert.throws(() => localRuntimeNetwork(environment), /LOCAL_(?:CONFIGURATION|RUNTIME_MODE)_INVALID/);
    await assert.rejects(startLocalRuntime(environment), /LOCAL_(?:CONFIGURATION|RUNTIME_MODE)_INVALID/);
  }
});


test('actual runtime thumbnail guard admits only the explicit combined mode with both capabilities',()=>{
 const mode='workspace-furnishing-051-to-050-051-upgrade-v1',base={mode,furnishingMode:true,modelPreparationCapability:true,workspaceFurnishingThumbnailCapability:true,currentImageThumbnailCapability:true};
 assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration(base));
 for(const mode of ['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1'])assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration({...base,mode}));
 for(const change of [{workspaceFurnishingThumbnailCapability:false},{currentImageThumbnailCapability:false},{furnishingMode:false},{modelPreparationCapability:false},{gpuModelPreparationCapability:true},{infoStandPreparationCapability:true},{freshImageCapability:true},{largeModelCapability:true},{catalog045PreReady:true},{oexCleanupSelection:true},{adoptionDescriptors:{}},{mode:'workspace-furnishing-045-to-050-upgrade-v1'},{mode:'workspace-furnishing-045-to-051-upgrade-v1'},{mode:'workspace-furnishing-unqualified-upgrade-v1'}])assert.throws(()=>assertThumbnailRuntimeConfiguration({...base,...change}),/NATIVE_OEX_CATALOG/);
 assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration({...base,mode:'workspace-furnishing-045-to-050-upgrade-v1',currentImageThumbnailCapability:false}));
 assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration({...base,mode:'workspace-furnishing-045-to-051-upgrade-v1',workspaceFurnishingThumbnailCapability:false}));
});

test('current rail selection requires its own pin and both parent thumbnail capabilities',()=>{
 const selected={mode:'workspace-furnishing-053-selected-import-v1',furnishingMode:true,modelPreparationCapability:true,workspaceFurnishingThumbnailCapability:true,currentImageThumbnailCapability:true,currentWorkspaceRailCapability:true};
 assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration(selected));
 const ordinary={...selected,mode:'workspace-furnishing-036-reopen-v1'};
 assert.doesNotThrow(()=>assertThumbnailRuntimeConfiguration({...ordinary,currentWorkspaceRailCapability:false,benchBaseColorCapability:true}));
 assert.throws(()=>assertThumbnailRuntimeConfiguration({...ordinary,benchBaseColorCapability:true}),/NATIVE_OEX_CATALOG/);
 for(const key of ['currentWorkspaceRailCapability','workspaceFurnishingThumbnailCapability','currentImageThumbnailCapability']){
  assert.throws(()=>assertThumbnailRuntimeConfiguration({...selected,[key]:false}),/NATIVE_OEX_CATALOG/);
 }
});

test('the admitted native process mask keeps new and refreshed TUF cache entries private', () => {
 const parentMask = process.umask();
 const runtime = new URL('./local-runtime.mjs', import.meta.url).href;
 // Run the actual installed cache writers in a process with a normal 022 mask.
 // The fake fetcher supplies synthetic bytes without contacting a trust mirror.
 execFileSync(process.execPath, ['--input-type=module', '--eval', `
  import assert from 'node:assert/strict';
  import {createHash} from 'node:crypto';
  import {mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
  import {tmpdir} from 'node:os';
  import {join} from 'node:path';
  import {Readable} from 'node:stream';
  import {TUFClient} from '@sigstore/tuf/dist/client.js';
  import {BaseFetcher} from 'tuf-js/dist/fetcher.js';
  import {TargetFile} from 'tuf-js';
  const {restrictNativeCatalogueCreationMode}=await import(${JSON.stringify(runtime)});
  process.umask(0o022);
  restrictNativeCatalogueCreationMode();
  assert.equal(process.umask(),0o077);
  const directory=mkdtempSync(join(tmpdir(),'exhibitos-tuf-mode-'));
  try {
   const seed=join(directory,'seed.json');
   const seedBytes=readFileSync(new URL('../apps/api/trust/github-release-tuf-root.json',${JSON.stringify(runtime)}));
   writeFileSync(seed,seedBytes,{mode:0o600});
   const cachePath=join(directory,'default-catalogue-trust');
   const client=new TUFClient({cachePath,rootPath:seed,mirrorURL:'https://tuf-repo.github.com'});
   const repo=join(cachePath,'tuf-repo.github.com'), targets=join(repo,'targets');
   for(const path of [cachePath,repo,targets])assert.equal(statSync(path).mode&0o777,0o700);
   const mode=path=>statSync(path).mode&0o777;
   assert.equal(mode(join(repo,'root.json')),0o600);
   assert.deepEqual(readFileSync(join(repo,'root.json')),seedBytes);
   class FixtureFetcher extends BaseFetcher {
    async fetch(){ return Readable.from([this.bytes]); }
   }
   const fetcher=new FixtureFetcher();
   client.updater.fetcher=fetcher;
   for(const version of [1,2]){
    const payload=Buffer.from(JSON.stringify({version}));
    for(const role of ['timestamp','snapshot','targets']){
     client.updater.persistMetadata(role,payload);
     const path=join(repo,role+'.json');
     assert.equal(mode(path),0o600);
     assert.deepEqual(readFileSync(path),payload);
    }
    fetcher.bytes=payload;
    const path=await client.updater.downloadTarget(new TargetFile({
     path:'trusted_root.json',length:payload.length,hashes:{sha256:createHash('sha256').update(payload).digest('hex')},
    }),undefined,'https://tuf-repo.github.com/targets');
    assert.equal(mode(path),0o600);
    assert.deepEqual(readFileSync(path),payload);
   }
   process.umask(0o122);
   restrictNativeCatalogueCreationMode();
   assert.equal(process.umask(),0o177);
  }finally{rmSync(directory,{recursive:true,force:true});}
 `], {cwd: new URL('..',import.meta.url), timeout:10000});
 assert.equal(process.umask(),parentMask);
});
