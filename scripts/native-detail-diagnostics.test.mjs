// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const source=await readFile(new URL('./native-static-export.mjs',import.meta.url));
const phases=['startup','prepare','export','ack','final-check','settle','ready'];
// Execute the actual wrapper with synthetic import peers so deliberately secret
// errors can cross its real catch boundary without any API, profile or artwork.
async function failure(t,{phase='export',message='STATIC_FETCH: /private/token',ordinary=false,nonError=false}={}){
 const root=await mkdtemp(join(tmpdir(),'detail-diagnostic-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'native-static-export.mjs'),source);
 const throwing=nonError?"throw {detail:'private-secret'};":`throw Object.assign(Error(${JSON.stringify(message)}),{cause:Error('private-cause')});`;
 await writeFile(join(root,'export-static-publication.mjs'),`export async function exportStaticPublication(){${throwing}}`);
 await writeFile(join(root,'native-detail-export-runner.mjs'),`export async function runNativeDetailExport({onPhase}){onPhase(${JSON.stringify(phase)});${throwing}}`);
 const child=spawn(process.execPath,[join(root,'native-static-export.mjs'),'http://127.0.0.1:9','00000000-0000-4000-8000-000000000001','/private-runtime','.',...(ordinary?[]:['--private-editor','--native-detail-v1'])],{stdio:['pipe','pipe','pipe']});
 const closed=once(child,'close');let out='',err='';child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
 assert.deepEqual(await closed,[1,null]);assert.equal(out,'');return err;
}
for(const phase of phases)test(`detail failure emits only finite ${phase} and normalized code`,async t=>{
 assert.equal(await failure(t,{phase}),`NATIVE_DETAIL_PHASE: ${phase}\nError: STATIC_FETCH\n`);
});
for(const message of ['NATIVE_DETAIL_CONTROL','STATIC_PUBLICATION_CHANGED: /private/token\nError: secret','STATIC_FILE_TOO_LARGE: https://private.invalid/token'])test(`allowlisted error normalization ${message.split(':')[0]}`,async t=>{
 assert.equal(await failure(t,{message}),`NATIVE_DETAIL_PHASE: export\nError: ${message.split(':')[0]}\n`);
});
for(const message of ['fetch failed https://private.invalid/token','NATIVE_DETAIL_CONTROL: secret','STATIC_FETCH_SUFFIX: secret','STATIC_FETCH\nError: secret','STATIC_FUTURE: /private/token'])test('unknown or contaminated errors never expose message, cause or stack',async t=>{
 assert.equal(await failure(t,{message}),'NATIVE_DETAIL_PHASE: export\nError: STATIC_NATIVE_FAILED\n');
});
test('non-Error detail failures remain finite',async t=>{assert.equal(await failure(t,{nonError:true}),'NATIVE_DETAIL_PHASE: export\nError: STATIC_NATIVE_FAILED\n');});
test('ordinary failure retains its existing bare-code output without a detail marker',async t=>{assert.equal(await failure(t,{ordinary:true}),'STATIC_FETCH\n');});

test('unknown phase text is never emitted by the wrapper',async t=>{assert.equal(await failure(t,{phase:'private-secret'}),'NATIVE_DETAIL_PHASE: startup\nError: STATIC_FETCH\n');});

for(const mode of ['prepare','fetch','json'])test(`real wrapper reports ${mode} failure before staging without raw HTTP text`,{timeout:10000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'detail-diagnostic-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const owner={version:1,jobId:'00000000-0000-4000-8000-000000000001',runtimeGeneration:'00000000-0000-4000-8000-000000000002',workspaceId:'00000000-0000-4000-8000-000000000003',tenantId:'00000000-0000-4000-8000-000000000004',principalId:'00000000-0000-4000-8000-000000000005',publicationId:'00000000-0000-4000-8000-000000000006',revisionSha256:'a'.repeat(64),sessionToken:'s'.repeat(43),csrfToken:'c'.repeat(43)};
 const server=createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url.endsWith('/prepare')){if(mode==='prepare'){res.writeHead(403);res.end(JSON.stringify({secret:'private-secret'}));}else res.end(JSON.stringify({version:1,publicationId:owner.publicationId,revisionSha256:owner.revisionSha256,detailAssets:[]}));}
  else if(req.url.endsWith('/close'))res.end(JSON.stringify({version:1,jobId:owner.jobId,state:'closing'}));
  else{res.writeHead(mode==='fetch'?404:200);res.end('private-secret https://private.invalid/token');}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});owner.origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,[new URL('./native-static-export.mjs',import.meta.url).pathname,owner.origin,owner.publicationId,root,'.','--private-editor','--native-detail-v1'],{cwd:root,stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const closed=once(child,'close');let out='',err='';child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
 const data=Buffer.from(JSON.stringify(owner)),frame=Buffer.alloc(data.length+4);frame.writeUInt32BE(data.length);data.copy(frame,4);child.stdin.write(frame);
 assert.deepEqual(await closed,[1,null]);assert.equal(out,'');assert.deepEqual(await readdir(root),[]);
 assert.equal(err,`NATIVE_DETAIL_PHASE: ${mode==='prepare'?'prepare':'export'}\nError: ${mode==='prepare'?'NATIVE_DETAIL_CONTROL':mode==='fetch'?'STATIC_FETCH':'STATIC_JSON_INVALID'}\n`);
});
