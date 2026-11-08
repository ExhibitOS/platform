// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDetailControl} from './native-detail-control.mjs';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {createHash} from 'node:crypto';

const startup={version:1,origin:'http://127.0.0.1:3000',tenantId:'00000000-0000-4000-8000-000000000001',publicationId:'00000000-0000-4000-8000-000000000002',jobId:'00000000-0000-4000-8000-000000000003',runtimeGeneration:'00000000-0000-4000-8000-000000000004',workspaceId:'00000000-0000-4000-8000-000000000005',principalId:'00000000-0000-4000-8000-000000000006',revisionSha256:'a'.repeat(64),sessionToken:'s'.repeat(43),csrfToken:'c'.repeat(43)};
const response=value=>Response.json(value);
const prepared=()=>({version:1,publicationId:startup.publicationId,revisionSha256:startup.revisionSha256,detailAssets:[]});
const checked=()=>({version:1,publicationId:startup.publicationId,revisionSha256:startup.revisionSha256,valid:true});
const status=state=>({version:1,jobId:startup.jobId,publicationId:startup.publicationId,revisionSha256:startup.revisionSha256,runtimeGeneration:startup.runtimeGeneration,state});
const busy=()=>Response.json({code:'NATIVE_DETAIL_BUSY',message:'NATIVE_DETAIL_BUSY',fieldErrors:[],requestId:'req-1'},{status:409});

test('retries only busy, fences final scope and observes positive settlement',async()=>{
 const seen=[];let attempts=0,polls=0;
 const fetcher=async(url,options)=>{seen.push([url,options]);assert.equal(options.headers.cookie,`exhibitos_local_session=${startup.sessionToken}`);assert.equal(options.headers['x-csrf-token'],startup.csrfToken);if(url.endsWith('/prepare'))return ++attempts===1?busy():response(prepared());if(url.endsWith('/final-check')){assert.equal(JSON.parse(options.body).detailCount,0);return response(checked());}return response(status(++polls===1?'pending':'settled-success'));};
 const control=nativeDetailControl(startup,AbortSignal.timeout(1000),fetcher);await control.prepare();await control.finalCheck();await control.settled();assert.equal(seen.length,5);
});
test('refuses candidates, malformed replies, wrong owner, and failed settlement',async()=>{
 for(const [action,value] of [['prepare',{...prepared(),detailAssets:[{assetId:'not-eligible'}]}],['prepare',{...prepared(),extra:1}],['settled',{...status('settled-success'),runtimeGeneration:'wrong'}],['settled',status('settled-failure')]]){
  const control=nativeDetailControl(startup,AbortSignal.timeout(1000),async()=>response(value));await assert.rejects(control[action](),/NATIVE_DETAIL_CONTROL/);
 }
});
test('validates prepared descriptors and binds final check to the full sorted tuple set',async()=>{
 const assetId='00000000-0000-4000-8000-000000000007',descriptor={assetId,url:`/api/v1/publications/${startup.publicationId}/detail-assets/${assetId}`,mime:'image/jpeg'},entry={assetId,sourceBindingSha256:'b'.repeat(64),sha256:'a'.repeat(64),bytes:3,mime:'image/jpeg',featureReportSha256:'c'.repeat(64)},plan={entries:[entry],detailSetSha256:createHash('sha256').update(freezeCanonical([entry])).digest('hex'),totalBytes:3};
 const fetcher=async(url,options)=>{if(url.endsWith('/prepare'))return response({...prepared(),detailAssets:[descriptor]});const sent=JSON.parse(options.body);assert.equal(sent.detailCount,1);assert.equal(sent.detailSetSha256,plan.detailSetSha256);return response(checked());};const control=nativeDetailControl(startup,AbortSignal.timeout(1000),fetcher),items=await control.prepare();assert.deepEqual(items,[descriptor]);assert(Object.isFrozen(items[0]));await control.finalCheck(plan);await assert.rejects(control.finalCheck({...plan,detailSetSha256:'d'.repeat(64)}),/NATIVE_DETAIL_CONTROL/);
});
test('does not retry other failures and aborts a busy loop',async()=>{
 let count=0;const control=nativeDetailControl(startup,AbortSignal.timeout(80),async()=>{count++;return busy();});await assert.rejects(control.prepare());assert.ok(count>1);
 const rejected=nativeDetailControl(startup,AbortSignal.timeout(1000),async()=>Response.json({code:'OTHER'},{status:409}));await assert.rejects(rejected.prepare(),/NATIVE_DETAIL_CONTROL/);
});
test('cleanup can use a separate bounded signal after work aborts',async()=>{
 const controller=new AbortController(),control=nativeDetailControl(startup,controller.signal,async()=>response({version:1,jobId:startup.jobId,state:'closing'}));controller.abort();await control.close(AbortSignal.timeout(1000));
});
test('waits for an aborted response reader to actually cancel',async()=>{
 const controller=new AbortController();let release,started;const cancellation=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let done=false;
 const stream=new ReadableStream({pull(){started();},cancel(){return cancellation;}}),control=nativeDetailControl(startup,controller.signal,async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
 const pending=control.prepare().catch(()=>{done=true;});await entered;controller.abort();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,false);release();await pending;assert.equal(done,true);
});
test('accepts only exact scoped bytes and rejects identity or body mismatch',async()=>{
 const data=Buffer.from('hello'),digest=await import('node:crypto').then(({createHash})=>createHash('sha256').update(data).digest('hex')),entry={assetId:'00000000-0000-4000-8000-000000000007',sourceBindingSha256:'b'.repeat(64),sha256:digest,bytes:data.length,mime:'image/jpeg',featureReportSha256:'c'.repeat(64)};
 const headers={'content-type':entry.mime,'content-length':String(entry.bytes),'x-exhibitos-sha256':digest,'x-exhibitos-publication-revision':startup.revisionSha256,'cache-control':'no-store','x-content-type-options':'nosniff'};
 const factory=(h=headers,body=data)=>async(url,options)=>{assert(url.endsWith('/bytes'));assert.equal(options.headers['accept-encoding'],'identity');const request=JSON.parse(options.body);assert.equal(request.assetId,entry.assetId);assert.equal(request.sourceBindingSha256,entry.sourceBindingSha256);return new Response(body,{headers:h});};
 assert.deepEqual(await nativeDetailControl(startup,AbortSignal.timeout(1000),factory()).readCandidate(entry),data);
 for(const [h,body] of [[{...headers,'content-length':'05'},data],[{...headers,'content-range':'bytes 0-4/5'},data],[{...headers,'content-encoding':'gzip'},data],[{...headers,'x-exhibitos-sha256':'d'.repeat(64)},data],[{...headers,'content-type':'image/png'},data],[headers,Buffer.from('shorter')],[headers,Buffer.from('hey')],[headers,Buffer.from('world')]])await assert.rejects(nativeDetailControl(startup,AbortSignal.timeout(1000),factory(h,body)).readCandidate(entry),/NATIVE_DETAIL_CONTROL/);
 const emptyChunk=new ReadableStream({start(stream){stream.enqueue(new Uint8Array());stream.close();}});await assert.rejects(nativeDetailControl(startup,AbortSignal.timeout(1000),factory(headers,emptyChunk)).readCandidate(entry),/NATIVE_DETAIL_CONTROL/);
});
test('invalid detail headers await actual body cancellation',async()=>{
 const digest='a'.repeat(64),entry={assetId:'00000000-0000-4000-8000-000000000007',sourceBindingSha256:'b'.repeat(64),sha256:digest,bytes:1,mime:'image/jpeg',featureReportSha256:'c'.repeat(64)};let release,called,settled=false;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{called=resolve;}),stream=new ReadableStream({cancel(){called();return gate;}});
 const pending=nativeDetailControl(startup,AbortSignal.timeout(1000),async()=>new Response(stream,{headers:{'content-type':'image/png'}})).readCandidate(entry).catch(()=>{settled=true;});await entered;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await pending;assert.equal(settled,true);
});
