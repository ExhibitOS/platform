// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localPublicationFetch} from './build-reference-demo.mjs';

test('local demo input adapter rejects remote destinations and non-public paths',async()=>{
 const fetcher=localPublicationFetch('/unused');
 for(const url of ['https://example.org/static-publication-index.json','https://reference-demo.invalid/.env','https://reference-demo.invalid/data/not-a-hash.bin','https://reference-demo.invalid/static-publication-index.json?token=anything']){
  await assert.rejects(fetcher(url),/DEMO_SOURCE_PATH/);
 }
});

test('local demo inputs are exact bytes and refuse symbolic links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-demo-source-test-'));
 try{
  const bytes=Buffer.from('{"version":1}');
  await writeFile(join(root,'static-publication-index.json'),bytes);
  const fetcher=localPublicationFetch(root);
  assert.deepEqual(Buffer.from(await (await fetcher('https://reference-demo.invalid/static-publication-index.json')).arrayBuffer()),bytes);
  await mkdir(join(root,'data'));
  const path=`data/${'a'.repeat(64)}.bin`;
  await symlink(join(root,'static-publication-index.json'),join(root,path));
  await assert.rejects(fetcher(`https://reference-demo.invalid/${path}`),/DEMO_SOURCE_SYMLINK/);
 }finally{await rm(root,{recursive:true,force:true});}
});
