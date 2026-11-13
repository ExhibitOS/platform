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

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clockedRun(t,{ack=false,holdFinal=false}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 const owner=startup(),input=new PassThrough(),stdout=new PassThrough(),events=[],external=new AbortController();let release,signal;
 const copied=new Promise(resolve=>{release=resolve;});
 stdout.on('data',chunk=>{const value=JSON.parse(chunk.subarray(4));events.push(value.kind);if(ack&&value.kind==='staged')input.write(frame({version:1,kind:'verified-staging',jobId:owner.jobId,manifestSha256:manifest}));});
 const waitAbort=()=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 const controlFactory=(_startup,s)=>{signal=s;return {prepare:async()=>[],finalCheck:async()=>{events.push('final');if(holdFinal)await waitAbort();},settled:async()=>events.push('settled'),close:async()=>events.push('close')};};
 const pending=runNativeDetailExport({origin:owner.origin,publicationId:owner.publicationId,runtimeRoot:'/runtime',output:'.',input,stdout,overallSignal:external.signal,controlFactory,exporter:async()=>{await Promise.race([copied,waitAbort()]);signal.throwIfAborted();return {publicationId:owner.publicationId,revisionSha256:hash,manifestSha256:manifest};}});
 input.write(frame(owner));return {pending,events,external,release,input,owner,get signal(){return signal;}};
}
test('copy may exceed old120s and finish before finite600s without changing wire sequence',async t=>{
 const r=clockedRun(t,{ack:true});await flush();t.mock.timers.tick(120001);assert.equal(r.signal.aborted,false);assert.deepEqual(r.events,[]);t.mock.timers.tick(479998);assert.equal(r.signal.aborted,false);r.release();await r.pending;assert.deepEqual(r.events,['staged','final','settled','ready']);
});
test('preparation expires at600s even without copy progress and never stages',async t=>{
 const r=clockedRun(t);await flush();t.mock.timers.tick(599999);assert.equal(r.signal.aborted,false);const rejected=assert.rejects(r.pending,/NATIVE_DETAIL_PREPARATION_TIMEOUT/);t.mock.timers.tick(1);await rejected;assert.deepEqual(r.events,['close']);
});
test('STAGED retains the existing30s ACK sublimit within the120s handoff budget',async t=>{
 const r=clockedRun(t);await flush();r.release();await flush();assert.deepEqual(r.events,['staged']);t.mock.timers.tick(29999);assert.equal(r.signal.aborted,false);const rejected=assert.rejects(r.pending);t.mock.timers.tick(1);await rejected;assert.deepEqual(r.events,['staged','close']);
});
test('ACK and final-check progress do not renew the same120s handoff budget',async t=>{
 const r=clockedRun(t,{holdFinal:true});await flush();r.release();await flush();t.mock.timers.tick(20000);r.input.write(frame({version:1,kind:'verified-staging',jobId:r.owner.jobId,manifestSha256:manifest}));await flush();assert.deepEqual(r.events,['staged','final']);t.mock.timers.tick(99999);assert.equal(r.signal.aborted,false);const rejected=assert.rejects(r.pending,/NATIVE_DETAIL_HANDOFF_TIMEOUT/);t.mock.timers.tick(1);await rejected;assert.deepEqual(r.events,['staged','final','close']);
});
test('caller overall cancellation remains hard during the enlarged copy allowance',async t=>{
 const r=clockedRun(t);await flush();const rejected=assert.rejects(r.pending,/caller cancelled/);r.external.abort(Error('caller cancelled'));await rejected;assert.deepEqual(r.events,['close']);
});
