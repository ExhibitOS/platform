// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,mkdtemp,mkdir,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {fixtureURL,readOex,revisionHash} from '@exhibitos/spec';

const wrapper=fileURLToPath(new URL('./native-static-export.mjs',import.meta.url));
const frame=value=>{const body=Buffer.from(JSON.stringify(value)),out=Buffer.alloc(body.length+4);out.writeUInt32BE(body.length);body.copy(out,4);return out;};
test('real detail child writes only in pinned cwd while ancestor is replaced', {timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'detail-owned-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'wrapper'),moved=join(root,'moved'),stage=join(path,'output'),runtime=join(root,'runtime');await mkdir(stage,{recursive:true});await mkdir(runtime);await writeFile(join(runtime,'static.html'),'<html><head><meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"></head><body><div id="root"></div></body></html>');
 const decoded=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),publicationId=randomUUID(),revisionSha256=revisionHash(decoded.exhibition),jobId=randomUUID(),runtimeGeneration=randomUUID(),owner={version:1,jobId,runtimeGeneration,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),publicationId,revisionSha256,sessionToken:'s'.repeat(43),csrfToken:'c'.repeat(43)};
 const projection={publication:{id:publicationId,revisionSha256,publishedAt:new Date().toISOString(),status:'published'},exhibition:decoded.exhibition,assets:decoded.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,url:`/api/v1/publications/${publicationId}/assets/${a.id}`}))};
 const server=createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname,send=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(path.endsWith('/prepare'))return send({version:1,publicationId,revisionSha256,detailAssets:[]});if(path.endsWith('/final-check'))return send({version:1,publicationId,revisionSha256,valid:true});if(path.endsWith(`/operations/${jobId}`))return send({version:1,jobId,publicationId,revisionSha256,runtimeGeneration,state:'settled-success'});if(path===`/api/v1/publications/${publicationId}`)return send(projection);
  const asset=decoded.manifest.assets.find(a=>path===`/api/v1/publications/${publicationId}/assets/${a.id}`);if(asset){res.writeHead(200,{'content-type':asset.mime,'x-exhibitos-publication-revision':revisionSha256});return res.end(decoded.files.get(asset.path));}res.writeHead(404);res.end();});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});owner.origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,[wrapper,owner.origin,publicationId,runtime,'.','--native-detail-v1'],{cwd:stage,stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let stderr='';child.stderr.on('data',b=>{stderr+=b;});let pending=Buffer.alloc(0),seen=[];let staged,ready;const stageFrame=new Promise(resolve=>{staged=resolve;}),readyFrame=new Promise(resolve=>{ready=resolve;});child.stdout.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=4&&pending.length>=4+pending.readUInt32BE(0)){const size=pending.readUInt32BE(0),message=JSON.parse(pending.subarray(4,4+size));pending=pending.subarray(size+4);seen.push(message);if(message.kind==='staged')staged(message);if(message.kind==='ready')ready(message);}});
 await once(child,'spawn');await rename(path,moved);await mkdir(stage,{recursive:true});child.stdin.write(frame(owner));const value=await stageFrame;assert.equal(value.jobId,jobId);assert((await readdir(join(moved,'output'))).includes('static-export-manifest.json'));assert.deepEqual(await readdir(stage),[]);
 await rm(path,{recursive:true});await rename(moved,path);child.stdin.write(frame({version:1,kind:'verified-staging',jobId,manifestSha256:value.manifestSha256}));assert.deepEqual(await readyFrame,{version:1,kind:'ready',jobId,manifestSha256:value.manifestSha256});assert.deepEqual(await once(child,'exit'),[0,null],stderr);assert.equal(seen.length,2);assert.equal(pending.length,0);assert.equal(stderr,'');
});
