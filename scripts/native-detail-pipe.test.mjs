// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {nativeDetailPipe} from './native-detail-pipe.mjs';

const frame=bytes=>{const b=Buffer.from(bytes),header=Buffer.alloc(4);header.writeUInt32BE(b.length);return Buffer.concat([header,b]);};
const fixture=()=>({version:1,jobId:randomUUID(),runtimeGeneration:randomUUID(),workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),publicationId:randomUUID(),revisionSha256:'a'.repeat(64),origin:'http://127.0.0.1:13200',sessionToken:'a'.repeat(43),csrfToken:'b'.repeat(43)});
test('reads a fragmented private startup and exact acknowledged staging frame',async()=>{
 const value=fixture(),input=new PassThrough(),pipe=nativeDetailPipe(input,{origin:value.origin,publicationId:value.publicationId}),startup=pipe.takeStartup(),start=frame(JSON.stringify(value));
 input.write(start.subarray(0,150));input.write(start.subarray(150));assert.deepEqual(await startup,value);assert(start.every(byte=>byte===0));assert.throws(()=>pipe.takeStartup(),/NATIVE_DETAIL_PIPE/);
 const digest='c'.repeat(64);assert.throws(()=>pipe.finish(),/NATIVE_DETAIL_PIPE/);assert.throws(()=>pipe.expectAck(randomUUID(),digest),/NATIVE_DETAIL_PIPE/);const ack=pipe.expectAck(value.jobId,digest);input.write(frame(JSON.stringify({version:1,kind:'verified-staging',jobId:value.jobId,manifestSha256:digest})));await ack;assert.throws(()=>pipe.expectAck(value.jobId,digest),/NATIVE_DETAIL_PIPE/);assert.equal(pipe.signal.aborted,false);pipe.finish();
});
test('rejects duplicate keys, wrong context, trailing bytes and early EOF',async()=>{
 for(const kind of ['duplicate','origin','trailing','utf8','eof']){
  const value=fixture(),input=new PassThrough(),pipe=nativeDetailPipe(input,{origin:value.origin,publicationId:value.publicationId}),startup=pipe.takeStartup();
  if(kind==='eof')input.end();else if(kind==='utf8')input.write(frame(Buffer.from([0xc3,0x28])));else{
   const json=kind==='duplicate'?JSON.stringify(value).replace('"version":1','"version":1,"version":1'):JSON.stringify(kind==='origin'?{...value,origin:'http://localhost:13200'}:value);
   const rejected=kind==='trailing'?Buffer.concat([frame(json),Buffer.from([0])]):frame(json);input.write(rejected);assert(rejected.every(byte=>byte===0));
  }
  await assert.rejects(startup,/NATIVE_DETAIL_PIPE/);assert.equal(pipe.signal.aborted,true);input.destroy();
 }
});
test('rejects any extra data and a mismatched ACK after startup',async()=>{
 for(const kind of ['extra','ack']){
  const value=fixture(),input=new PassThrough(),pipe=nativeDetailPipe(input,{origin:value.origin,publicationId:value.publicationId}),startup=pipe.takeStartup();input.write(frame(JSON.stringify(value)));await startup;
  if(kind==='extra'){input.write(Buffer.from([1]));assert.equal(pipe.signal.aborted,true);}else{const pending=pipe.expectAck(value.jobId,'c'.repeat(64));input.write(frame(JSON.stringify({version:1,kind:'verified-staging',jobId:randomUUID(),manifestSha256:'c'.repeat(64)})));await assert.rejects(pending,/NATIVE_DETAIL_PIPE/);assert.equal(pipe.signal.aborted,true);}
  input.destroy();
 }
});
