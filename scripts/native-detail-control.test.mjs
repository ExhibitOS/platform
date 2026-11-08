// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDetailControl} from './native-detail-control.mjs';

const startup={origin:'http://127.0.0.1:3000',tenantId:'a',publicationId:'b',jobId:'c',revisionSha256:'d',runtimeGeneration:'e',sessionToken:'private-session',csrfToken:'private-csrf'};
const response=value=>Response.json(value);
const prepared=()=>({version:1,publicationId:'b',revisionSha256:'d',detailAssets:[]});
const checked=()=>({version:1,publicationId:'b',revisionSha256:'d',valid:true});
const status=state=>({version:1,jobId:'c',publicationId:'b',revisionSha256:'d',runtimeGeneration:'e',state});
const busy=()=>Response.json({code:'NATIVE_DETAIL_BUSY',message:'NATIVE_DETAIL_BUSY',fieldErrors:[],requestId:'req-1'},{status:409});

test('retries only busy, fences final scope and observes positive settlement',async()=>{
 const seen=[];let attempts=0,polls=0;
 const fetcher=async(url,options)=>{seen.push([url,options]);assert.equal(options.headers.cookie,'exhibitos_local_session=private-session');assert.equal(options.headers['x-csrf-token'],'private-csrf');if(url.endsWith('/prepare'))return ++attempts===1?busy():response(prepared());if(url.endsWith('/final-check')){assert.equal(JSON.parse(options.body).detailCount,0);return response(checked());}return response(status(++polls===1?'pending':'settled-success'));};
 const control=nativeDetailControl(startup,AbortSignal.timeout(1000),fetcher);await control.prepare();await control.finalCheck();await control.settled();assert.equal(seen.length,5);
});
test('refuses candidates, malformed replies, wrong owner, and failed settlement',async()=>{
 for(const [action,value] of [['prepare',{...prepared(),detailAssets:[{assetId:'not-eligible'}]}],['prepare',{...prepared(),extra:1}],['settled',{...status('settled-success'),runtimeGeneration:'wrong'}],['settled',status('settled-failure')]]){
  const control=nativeDetailControl(startup,AbortSignal.timeout(1000),async()=>response(value));await assert.rejects(control[action](),/NATIVE_DETAIL_CONTROL/);
 }
});
test('does not retry other failures and aborts a busy loop',async()=>{
 let count=0;const control=nativeDetailControl(startup,AbortSignal.timeout(80),async()=>{count++;return busy();});await assert.rejects(control.prepare());assert.ok(count>1);
 const rejected=nativeDetailControl(startup,AbortSignal.timeout(1000),async()=>Response.json({code:'OTHER'},{status:409}));await assert.rejects(rejected.prepare(),/NATIVE_DETAIL_CONTROL/);
});
