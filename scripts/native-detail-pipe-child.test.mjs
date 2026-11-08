// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const frame=value=>{const data=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);head.writeUInt32BE(data.length);return Buffer.concat([head,data]);};
const input=()=>({version:1,jobId:randomUUID(),runtimeGeneration:randomUUID(),workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),publicationId:randomUUID(),revisionSha256:'a'.repeat(64),origin:'http://127.0.0.1:13200',sessionToken:'a'.repeat(43),csrfToken:'b'.repeat(43)});
test('owned child accepts the private pipe handshake and exits without printing credentials',async t=>{
 const value=input(),moduleUrl=pathToFileURL(resolve('scripts/native-detail-pipe.mjs')).href,digest='c'.repeat(64);
 const source=`import {nativeDetailPipe} from ${JSON.stringify(moduleUrl)};
 const pipe=nativeDetailPipe(process.stdin,{origin:${JSON.stringify(value.origin)},publicationId:${JSON.stringify(value.publicationId)}});
 const owner=await pipe.takeStartup();pipe.signal.throwIfAborted();const job=owner.jobId;owner.sessionToken='';owner.csrfToken='';
 const send=x=>{const b=Buffer.from(JSON.stringify(x)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);process.stdout.write(Buffer.concat([h,b]));};
 const ack=pipe.expectAck(job,${JSON.stringify(digest)});send({version:1,kind:'staged',jobId:job,manifestSha256:${JSON.stringify(digest)}});await ack;pipe.signal.throwIfAborted();
 send({version:1,kind:'ready',jobId:job,manifestSha256:${JSON.stringify(digest)}});pipe.finish();`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']}),chunks=[];let buffer=Buffer.alloc(0),staged=false;t.after(()=>{if(child.exitCode===null)child.kill();});
 child.stdout.on('data',chunk=>{chunks.push(Buffer.from(chunk));buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32BE(0)){const size=buffer.readUInt32BE(0),v=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);if(v.kind==='staged'&&!staged){staged=true;child.stdin.write(frame({version:1,kind:'verified-staging',jobId:value.jobId,manifestSha256:digest}));}}});
 child.stdin.write(frame(value));const [exit,signal]=await once(child,'close');assert.equal(exit,0);assert.equal(signal,null);
 const text=Buffer.concat(chunks).toString();assert(!text.includes(value.sessionToken));assert(!text.includes(value.csrfToken));assert(text.includes('staged'));assert(text.includes('ready'));assert.equal(buffer.length,0);
});
test('owned child aborts and does not report ready if its parent closes the pipe before ACK',async t=>{
 const value=input(),moduleUrl=pathToFileURL(resolve('scripts/native-detail-pipe.mjs')).href,digest='c'.repeat(64);
 const source=`import {nativeDetailPipe} from ${JSON.stringify(moduleUrl)};
 const pipe=nativeDetailPipe(process.stdin,{origin:${JSON.stringify(value.origin)},publicationId:${JSON.stringify(value.publicationId)}});
 try{const owner=await pipe.takeStartup();pipe.signal.throwIfAborted();const ack=pipe.expectAck(owner.jobId,${JSON.stringify(digest)});process.stdout.write('staged');await ack;process.stdout.write('ready');pipe.finish();}catch{process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']}),chunks=[];t.after(()=>{if(child.exitCode===null)child.kill();});
 child.stdout.on('data',chunk=>{chunks.push(Buffer.from(chunk));child.stdin.end();});child.stdin.write(frame(value));const [exit]=await once(child,'close');assert.equal(exit,1);assert.equal(Buffer.concat(chunks).toString(),'staged');
});
