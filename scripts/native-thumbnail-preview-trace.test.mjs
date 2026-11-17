// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,constants,openSync,readSync} from 'node:fs';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createServer,request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProxy} from './local-runtime.mjs';
import {createNativeThumbnailPreviewTrace,takeThumbnailPreviewTracePipe} from './native-thumbnail-preview-trace.mjs';

const requestId='11111111-1111-4111-8111-111111111111',
 tenantId='22222222-2222-4222-8222-222222222222',principalId='33333333-3333-4333-8333-333333333333',
 artworkId='44444444-4444-4444-8444-444444444444';
const scope={requestId,tenantId,principalId},session={tenantId,userId:principalId,role:'artist'};
const header='x-exhibitos-thumbnail-trace',route=`/api/v1/tenants/${tenantId}/cms/artworks/${artworkId}/preview?expectedRevision=2`;
const host='127.0.0.1:13200';

async function listen(server) {
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 return server.address().port;
}

async function get(port,path,id) {
 return new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,headers:{host,[header]:id}},res=>{
   const body=[];
   res.on('data',part=>body.push(part));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(body).toString()}));
  });
  req.once('error',reject);req.end();
 });
}

test('one armed exact loopback GET joins proxy and API without changing its response',async t=>{
 const root=await mkdtemp(join(tmpdir(),'thumbnail-trace-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'assets'));
 const trace=createNativeThumbnailPreviewTrace(scope);
 const api=createServer((req,res)=>{
  trace.apiIngress(req);
  trace.apiAuthorized(req,session);
  trace.apiHeadersReady(req,200);
  res.writeHead(200,{'content-type':'application/octet-stream'});
  res.end('unchanged bytes');
 });
 const apiPort=await listen(api);
 t.after(()=>{api.close();api.closeAllConnections();});
 const proxy=await createLocalProxy({webRoot:root,origin:'http://'+host,apiPort,thumbnailPreviewTrace:trace});
 const port=await listen(proxy);
 t.after(()=>{proxy.close();proxy.closeAllConnections();});
 await get(apiPort,route,requestId);
 await get(port,route+'&assetId='+artworkId,requestId);
 await get(port,route,principalId);
 assert.deepEqual(trace.snapshot().events,[]);
 const response=await get(port,route,requestId);
 assert.equal(response.status,200);
 assert.equal(response.body,'unchanged bytes');
 assert.equal(response.headers[header],undefined);
 assert.deepEqual(trace.snapshot().events.map(event=>event.kind),[
  'proxy-ingress','api-ingress','api-authorized','api-headers-ready','proxy-upstream-headers','proxy-headers-forwarded',
 ]);
 const captured=trace.snapshot();
 await get(port,route,requestId);
 assert.deepEqual(trace.snapshot(),captured);
 const encoded=JSON.stringify(captured);
 assert(!encoded.includes(tenantId)&&!encoded.includes(principalId)&&!encoded.includes(artworkId)&&!encoded.includes('/preview'));
 assert(captured.events.every(event=>Number.isInteger(event.elapsedMs)&&event.elapsedMs>=0));
});

test('foreign API identity and pre-header close do not fabricate authorization or headers',()=>{
 const trace=createNativeThumbnailPreviewTrace(scope);
 const forward={method:'GET',url:route,headers:{[header]:requestId},socket:{remoteAddress:'127.0.0.1',remotePort:12345}};
 assert.equal(trace.claimProxy({...forward,socket:{remoteAddress:'192.0.2.1'}}),undefined);
 const claim=trace.claimProxy(forward);
 claim.connect(23456);
 trace.apiIngress(forward);
 trace.apiAuthorized(forward,session);
 const api={...forward,socket:{...forward.socket,remotePort:23456}};
 trace.apiIngress(api);
 trace.apiAuthorized(api,{...session,userId:artworkId});
 trace.apiHeadersReady(api,99);
 claim.closed();
 assert.deepEqual(trace.snapshot().events.map(event=>event.kind),['proxy-ingress','api-ingress','proxy-client-closed']);
});

test('private nonblocking FIFO receives one trace footer and cannot overlap an owner descriptor',async t=>{
 const root=await mkdtemp(join(tmpdir(),'thumbnail-trace-pipe-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'trace.fifo');
 execFileSync('/usr/bin/mkfifo',['-m','600',path]);
 const reader=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);
 t.after(()=>closeSync(reader));
 const fd=openSync(path,constants.O_WRONLY|constants.O_NONBLOCK);
 assert.throws(()=>takeThumbnailPreviewTracePipe({requestId,outputFd:fd},{EXHIBITOS_NATIVE_OWNER_FD:String(fd)}),/NATIVE_THUMBNAIL_TRACE_INPUT/);
 const sink=takeThumbnailPreviewTracePipe({requestId,outputFd:fd},{});
 t.after(()=>sink.close());
 const snapshot=createNativeThumbnailPreviewTrace(scope).snapshot();
 sink.finish(snapshot);
 sink.finish(snapshot);
 const bytes=Buffer.alloc(2048),size=readSync(reader,bytes);
 assert.equal(bytes.subarray(0,size).toString(),JSON.stringify(snapshot)+'\n');
 assert.equal(readSync(reader,bytes),0);
});
