// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSignedInventory,finalizeNativeRuntime} from './finalize-native-runtime.mjs';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const paths=['bin/node',...['createdb','initdb','pg_dump','pg_isready','pg_restore','postgres','psql'].map(x=>`postgres/bin/${x}`),...['libcrypto.3.dylib','libicudata.77.1.dylib','libicui18n.77.1.dylib','libicuuc.77.1.dylib','liblz4.1.10.0.dylib','libpq.5.dylib','libssl.3.dylib','libxml2.16.dylib','libzstd.1.5.7.dylib','postgresql/dict_snowball.dylib','postgresql/plpgsql.dylib'].map(x=>`postgres/lib/${x}`)];
const make=()=>{
 const before=paths.map(path=>({path,bytes:1,sha256:'a'.repeat(64),executable:true}));
 before.push({path:'platform/file',bytes:1,sha256:'c'.repeat(64),executable:false},{path:'postgres/lib/alias',link:'libpq.5.dylib'});
 const after=structuredClone(before);for(const entry of after)if(paths.includes(entry.path)){entry.bytes=2;entry.sha256='b'.repeat(64);}
 const rows=paths.map(path=>({path,before:'a'.repeat(64),after:'b'.repeat(64),beforeMode:0o755,afterMode:0o755}));
 return {before,after,rows};
};
test('signed inventory allows only exact listed signed-byte changes',()=>{
 const {before,after,rows}=make();assert.equal(compareSignedInventory(before,after,rows),true);
 for(const mutate of [
  x=>x.rows.pop(),
  x=>{x.rows[0].after='d'.repeat(64);},
  x=>{x.rows[0].afterMode=0o700;},
  x=>{x.rows[0].beforeMode=0o777;x.rows[0].afterMode=0o777;},
  x=>{x.after.find(v=>v.path==='platform/file').sha256='d'.repeat(64);},
  x=>{x.after.find(v=>v.path==='postgres/lib/alias').link='../other';},
  x=>x.after.push({path:'unexpected',bytes:1,sha256:'e'.repeat(64),executable:false}),
  x=>{x.rows[1].path=x.rows[0].path;}
 ]){const fixture=make();mutate(fixture);assert.throws(()=>compareSignedInventory(fixture.before,fixture.after,fixture.rows),/NATIVE_FINALIZE_INVALID/);}
});

test('refuses to finalize over the original runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-finalizer-'));
 try{
  const manifest=join(root,'manifest.json');await writeFile(manifest,'preserve');
  await assert.rejects(finalizeNativeRuntime({signedRoot:root,originalRoot:root,operationRoot:root,originalManifest:manifest,receiptPath:manifest}),/NATIVE_FINALIZE_INVALID/);
  assert.equal(await readFile(manifest,'utf8'),'preserve');
 }finally{await rm(root,{recursive:true,force:true});}
});
