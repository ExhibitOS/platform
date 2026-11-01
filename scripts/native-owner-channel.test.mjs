// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {unpackNativeOwnerInput} from './native-owner-channel.mjs';

const id='11111111-1111-4111-8111-111111111111',secret='a'.repeat(64);
const workspace={workspaceId:id,tenantId:id,principalId:id},owner={version:1,runtimeGeneration:id,secret};
test('keeps legacy FD0 input and accepts only the closed opt-in envelope',()=>{
 assert.deepEqual(unpackNativeOwnerInput(workspace),{workspace});
 assert.deepEqual(unpackNativeOwnerInput({workspace,ownerChannel:owner}),{workspace,ownerChannel:{runtimeGeneration:id,secret}});
 assert.deepEqual(unpackNativeOwnerInput({workspace,ownerChannel:{version:2,runtimeGeneration:id,secret,mode:'fresh-oex-test-v1'}}),{workspace,ownerChannel:{runtimeGeneration:id,secret,mode:'fresh-oex-test-v1'}});
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{version:2,runtimeGeneration:id,secret,mode:'other'}}));
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{...owner,mode:'fresh-oex-test-v1'}}));
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{...owner,extra:true}}));
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{...owner,secret:'invalid'}}));
});
async function handshake(mismatch,fragmented=false,duplicate=false){
 const source=`import {openNativeOwnerChannel} from ${JSON.stringify(new URL('./native-owner-channel.mjs',import.meta.url).href)};const w=${JSON.stringify(workspace)},o=${JSON.stringify({runtimeGeneration:id,secret})};try{const channel=await openNativeOwnerChannel('10',w,o);process.stdout.write('OK');channel.close();}catch{process.stdout.write('REFUSED');process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','pipe']});
 const socket=child.stdio[10],out=[],reply=[];let failure,total=0;
 const stop=error=>{failure??=error;child.kill('SIGKILL');};
 socket.on('data',chunk=>{total+=chunk.length;if(total>2052)stop(Error('ACK_LIMIT'));else reply.push(chunk);});socket.on('error',stop);child.stdout.on('data',chunk=>out.push(chunk));child.on('error',error=>{failure??=error;});
 const closed=new Promise(resolve=>child.once('close',resolve)),timer=setTimeout(()=>stop(Error('CHILD_TIMEOUT')),5000);
 const text=JSON.stringify({version:1,kind:'hello',...workspace,runtimeGeneration:id,secret:mismatch?'b'.repeat(64):secret}),hello=Buffer.from(duplicate?text.replace('"version":1','"version":1,"version":1'):text),header=Buffer.alloc(4);header.writeUInt32BE(hello.length);const frame=Buffer.concat([header,hello]);if(fragmented){socket.write(frame.subarray(0,2));socket.write(frame.subarray(2,9));socket.write(frame.subarray(9));}else socket.write(frame);
 const status=await closed;clearTimeout(timer);if(failure)throw failure;
 return {status,output:Buffer.concat(out).toString(),reply:Buffer.concat(reply)};
}
test('accepts matching private inherited socket and acknowledges without the secret',{timeout:15000},async()=>{
 const result=await handshake(false,true);assert.equal(result.status,0);assert.equal(result.output,'OK');assert(result.reply.length>=4);const n=result.reply.readUInt32BE(0);assert.equal(n,result.reply.length-4);const ack=JSON.parse(result.reply.subarray(4).toString());assert.deepEqual(ack,{version:1,kind:'hello-ack',...workspace,runtimeGeneration:id});assert(!result.reply.includes(secret));
});
test('refuses a mismatched session secret without an ACK',{timeout:15000},async()=>{
 const result=await handshake(true);assert.notEqual(result.status,0);assert.equal(result.output,'REFUSED');assert.equal(result.reply.length,0);
});
test('refuses duplicate hello fields without an ACK',{timeout:15000},async()=>{
 const result=await handshake(false,false,true);assert.notEqual(result.status,0);assert.equal(result.output,'REFUSED');assert.equal(result.reply.length,0);
});
test('after hello ACK the same inherited socket carries one bounded frame',{timeout:15000},async()=>{
 const source=`import {openNativeOwnerChannel} from ${JSON.stringify(new URL('./native-owner-channel.mjs',import.meta.url).href)};const w=${JSON.stringify(workspace)},o=${JSON.stringify({runtimeGeneration:id,secret})};try{const c=await openNativeOwnerChannel('10',w,o);const p=await c.receive();await c.send(p);await c.close();}catch{process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','pipe']}),socket=child.stdio[10];let buffer=Buffer.alloc(0),phase=0,failure;
 const stop=error=>{failure??=error;child.kill('SIGKILL');},closed=new Promise(resolve=>child.once('close',resolve)),timer=setTimeout(()=>stop(Error('CHILD_TIMEOUT')),5000);
 socket.on('error',stop);child.on('error',error=>{failure??=error;});
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length<4)return;const length=buffer.readUInt32BE(0);if(length>8192){stop(Error('FRAME_LIMIT'));return;}if(buffer.length<length+4)return;if(buffer.length!==length+4){stop(Error('FRAME_TRAILING'));return;}const body=buffer.subarray(4);if(phase===0){try{assert.equal(JSON.parse(body.toString()).kind,'hello-ack');}catch(error){stop(error);return;}phase=1;buffer=Buffer.alloc(0);const payload=Buffer.from('operation'),head=Buffer.alloc(4);head.writeUInt32BE(payload.length);socket.write(Buffer.concat([head,payload]));}else{if(body.toString()!=='operation')stop(Error('FRAME_CONTENT'));else phase=2;}});
 const hello=Buffer.from(JSON.stringify({version:1,kind:'hello',...workspace,runtimeGeneration:id,secret})),header=Buffer.alloc(4);header.writeUInt32BE(hello.length);socket.write(Buffer.concat([header,hello]));
 const status=await closed;clearTimeout(timer);if(failure)throw failure;assert.equal(status,0);assert.equal(phase,2);
});
