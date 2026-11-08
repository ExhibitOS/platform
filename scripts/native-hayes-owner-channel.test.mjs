// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {unpackNativeOwnerInput} from './native-owner-channel.mjs';
const id='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222',secret='a'.repeat(64),hayesSecret='b'.repeat(64),manifest='c'.repeat(64);
const workspace={workspaceId:id,tenantId:id,principalId:id},ownerChannel={version:3,runtimeGeneration:id,secret,mode:'workspace-furnishing-036-initialize-v1'},hayesOwnerChannel={version:1,runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest};
test('selected envelope accepts only distinct closed same-generation pins and preserves ordinary mode',()=>{
 const value=unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel});assert.deepEqual(value,{workspace,ownerChannel:{runtimeGeneration:id,secret,mode:ownerChannel.mode},hayesOwnerChannel:{runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest}});
 for(const changed of [{secret},{runtimeGeneration:ownerId},{nativeOwnerId:'bad'},{runtimeManifestSha256:'bad'},{extra:true}])assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel:{...hayesOwnerChannel,...changed}}));
 assert.throws(()=>unpackNativeOwnerInput({workspace,hayesOwnerChannel}));assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{...ownerChannel,mode:'normal-oex-027-v3'},hayesOwnerChannel}));
 assert.deepEqual(unpackNativeOwnerInput({workspace,ownerChannel}),{workspace,ownerChannel:{runtimeGeneration:id,secret,mode:ownerChannel.mode}});
});
async function handshake(change={},duplicate=false){
 const pin={runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest};
 const source=`import {openHayesOwnerChannel} from ${JSON.stringify(new URL('./native-hayes-owner-channel.mjs',import.meta.url).href)};try{const c=await openHayesOwnerChannel('10',${JSON.stringify(workspace)},${JSON.stringify(pin)});process.stdout.write('OK');await c.close();}catch{process.stdout.write('REFUSED');process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','pipe']}),socket=child.stdio[10],out=[],reply=[];let failure,total=0;
 const stop=e=>{failure??=e;child.kill('SIGKILL');};socket.on('data',chunk=>{total+=chunk.length;if(total>2052)stop(Error('ACK_LIMIT'));else reply.push(chunk);});socket.on('error',stop);child.stdout.on('data',chunk=>out.push(chunk));child.on('error',e=>{failure??=e;});
 const ended=new Promise(resolve=>child.once('close',resolve)),timer=setTimeout(()=>stop(Error('CHILD_TIMEOUT')),5000);
 const hello={version:1,kind:'hayes-owner-hello',...workspace,runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest,...change};let text=JSON.stringify(hello);if(duplicate)text=text.replace('"version":1','"version":1,"version":1');const bytes=Buffer.from(text),head=Buffer.alloc(4);head.writeUInt32BE(bytes.length);const packet=Buffer.concat([head,bytes]);socket.write(packet.subarray(0,2));socket.write(packet.subarray(2));
 const status=await ended;clearTimeout(timer);if(failure)throw failure;return {status,output:Buffer.concat(out).toString(),reply:Buffer.concat(reply)};
}
test('dedicated inherited socket accepts exact pin and omits secret from ACK',{timeout:15000},async()=>{const r=await handshake();assert.equal(r.status,0);assert.equal(r.output,'OK');const n=r.reply.readUInt32BE(0);assert.equal(n,r.reply.length-4);assert.deepEqual(JSON.parse(r.reply.subarray(4).toString()),{version:1,kind:'hayes-owner-hello-ack',...workspace,runtimeGeneration:id,nativeOwnerId:ownerId,runtimeManifestSha256:manifest});assert(!r.reply.includes(hayesSecret));});
for(const [label,change,duplicate] of [['secret',{secret},false],['owner',{nativeOwnerId:id},false],['manifest',{runtimeManifestSha256:'d'.repeat(64)},false],['duplicate',{},true]])test(`rejects ${label} without ACK`,{timeout:15000},async()=>{const r=await handshake(change,duplicate);assert.notEqual(r.status,0);assert.equal(r.output,'REFUSED');assert.equal(r.reply.length,0);});

test('closing the dedicated owner leaves the ordinary inherited channel open',{timeout:15000},async()=>{
 const pin={runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest};
 const source=`import {openHayesOwnerChannel} from ${JSON.stringify(new URL('./native-hayes-owner-channel.mjs',import.meta.url).href)};import {openNativeOwnerChannel} from ${JSON.stringify(new URL('./native-owner-channel.mjs',import.meta.url).href)};const w=${JSON.stringify(workspace)},p=${JSON.stringify(pin)};try{const [a,b]=await Promise.all([openNativeOwnerChannel('10',w,{runtimeGeneration:p.runtimeGeneration,secret:${JSON.stringify(secret)}}),openHayesOwnerChannel('11',w,p)]);await b.close();process.stdout.write(String(a.isOpen()));await a.close();}catch{process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore','ignore','pipe','pipe']}),ordinary=child.stdio[10],hayes=child.stdio[11],out=[];let failure;
 const stop=e=>{failure??=e;child.kill('SIGKILL');};ordinary.on('error',stop);hayes.on('error',stop);child.on('error',stop);child.stdout.on('data',x=>out.push(x));ordinary.resume();hayes.resume();
 const frame=x=>{const b=Buffer.from(JSON.stringify(x)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);return Buffer.concat([h,b]);};
 const ended=new Promise(resolve=>child.once('close',resolve)),timer=setTimeout(()=>stop(Error('CHILD_TIMEOUT')),5000);
 ordinary.write(frame({version:1,kind:'hello',...workspace,runtimeGeneration:id,secret}));hayes.write(frame({version:1,kind:'hayes-owner-hello',...workspace,runtimeGeneration:id,secret:hayesSecret,nativeOwnerId:ownerId,runtimeManifestSha256:manifest}));
 const status=await ended;clearTimeout(timer);if(failure)throw failure;assert.equal(status,0);assert.equal(Buffer.concat(out).toString(),'true');
});
