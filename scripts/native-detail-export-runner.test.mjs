// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {runNativeDetailExport} from './native-detail-export-runner.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash='a'.repeat(64),manifest='b'.repeat(64);
const startup=()=>({version:1,jobId:id(1),runtimeGeneration:id(2),workspaceId:id(3),tenantId:id(4),principalId:id(5),publicationId:id(6),revisionSha256:hash,origin:'http://127.0.0.1:3000',sessionToken:'s'.repeat(43),csrfToken:'c'.repeat(43)});
const frame=value=>{const data=Buffer.from(JSON.stringify(value)),buffer=Buffer.alloc(data.length+4);buffer.writeUInt32BE(data.length);data.copy(buffer,4);return buffer;};
test('detail stage requires a literal dot and an absolute runtime root',async()=>{const owner=startup();for(const options of [{output:'/stage',runtimeRoot:'/runtime'},{output:'.',runtimeRoot:'runtime'}])await assert.rejects(runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,...options}),/NATIVE_DETAIL_STAGE/);});

test('stages before ACK, final fence, settlement and ready',async()=>{
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),events=[];let buffered=Buffer.alloc(0);
 stdout.on('data',chunk=>{buffered=Buffer.concat([buffered,chunk]);while(buffered.length>=4&&buffered.length>=4+buffered.readUInt32BE(0)){const size=buffered.readUInt32BE(0),value=JSON.parse(buffered.subarray(4,4+size));buffered=buffered.subarray(4+size);events.push(value.kind);if(value.kind==='staged')input.write(frame({version:1,kind:'verified-staging',jobId:owner.jobId,manifestSha256:manifest}));}});
 const controlFactory=()=>({prepare:async()=>{events.push('prepare');return [];},finalCheck:async()=>events.push('final'),settled:async()=>events.push('settled'),close:async()=>events.push('close')});
 const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,controlFactory,exporter:async()=>{events.push('export');return {publicationId:owner.publicationId,revisionSha256:hash,manifestSha256:manifest};}});input.write(frame(owner));await pending;assert.deepEqual(events,['prepare','export','staged','final','settled','ready']);
});
test('mismatched revision closes the owned operation and never emits ready',async()=>{
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),events=[];stdout.on('data',()=>events.push('frame'));
 const controlFactory=()=>({prepare:async()=>[],close:async()=>events.push('close')});const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,controlFactory,exporter:async()=>({publicationId:owner.publicationId,revisionSha256:'f'.repeat(64),manifestSha256:manifest})});input.write(frame(owner));await assert.rejects(pending,/NATIVE_DETAIL_RECEIPT/);assert.deepEqual(events,['close']);
});
test('runner refuses a candidate when serializer omits its complete plan',async()=>{
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),events=[];stdout.on('data',()=>events.push('frame'));const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,controlFactory:()=>({prepare:async()=>[{assetId:id(9),mime:'image/jpeg'}],close:async()=>events.push('close')}),exporter:async()=>({publicationId:owner.publicationId,revisionSha256:hash,manifestSha256:manifest})});input.write(frame(owner));await assert.rejects(pending,/NATIVE_DETAIL_RECEIPT/);assert.deepEqual(events,['close']);
});
test('parent disconnect cancels in-flight export and waits for it before close',async()=>{
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),events=[];let started,release,observed;const entered=new Promise(resolve=>{started=resolve;}),drain=new Promise(resolve=>{release=resolve;}),aborted=new Promise(resolve=>{observed=resolve;});stdout.on('data',()=>events.push('frame'));
 const controlFactory=()=>({prepare:async()=>[],close:async signal=>{assert.equal(signal.aborted,false);events.push('close');}});const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,controlFactory,exporter:async({signal})=>{signal.addEventListener('abort',observed,{once:true});started();await drain;signal.throwIfAborted();}});input.write(frame(owner));await entered;input.end();await aborted;assert.deepEqual(events,[]);release();await assert.rejects(pending);assert.deepEqual(events,['close']);
});
for(const late of [false,true])test(late?'late stdout error after abort remains handled':'stdout callback failure and later error allow cleanup',async()=>{
 const owner=startup(),input=new PassThrough(),events=[];let writeStarted,completeWrite;const entered=new Promise(resolve=>{writeStarted=resolve;}),stdout=new Writable({write(_chunk,_encoding,callback){writeStarted();if(late)completeWrite=callback;else callback(Error('synthetic output failure'));}});
 const controlFactory=()=>({prepare:async()=>[],close:async()=>events.push('close')});const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,controlFactory,exporter:async()=>({publicationId:owner.publicationId,revisionSha256:hash,manifestSha256:manifest})});input.write(frame(owner));await entered;if(late){input.end();await assert.rejects(pending);completeWrite(Error('late output failure'));}else await assert.rejects(pending);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['close']);
});
test('overall deadline interrupts an ACK wait',async()=>{
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),deadline=new AbortController(),events=[];let staged;const emitted=new Promise(resolve=>{staged=resolve;});stdout.on('data',()=>staged());
 const controlFactory=()=>({prepare:async()=>[],close:async()=>events.push('close')});const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,overallSignal:deadline.signal,controlFactory,exporter:async()=>({publicationId:owner.publicationId,revisionSha256:hash,manifestSha256:manifest})});input.write(frame(owner));await emitted;deadline.abort();await assert.rejects(pending);assert.deepEqual(events,['close']);
});
